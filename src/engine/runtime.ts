// WANDER runtime: plays a project. Used by the editor's Play mode and by
// published standalone builds (src/player.ts), so both behave identically.
import * as THREE from 'three';
import type { Action, AssetProvider, Cinematic, EventRule, Obj, Project, Scene } from './types';
import { ENV_PRESETS } from './types';
import type { Core } from './wasm';
import { TerrainSystem, type TerrainData } from './terrain';
import { Environment } from './environment';
import { buildNode, type BuildCtx, type ColliderDesc } from './build';
import { prefabCollider } from './prefabs';
import { sampleCinematic } from './cinematic';
import { Hud, el, richText } from './hud';

export interface RuntimeOptions {
  container: HTMLElement;
  project: Project;
  assets: AssetProvider;
  core: Core;
  terrain?: TerrainData;
  /** Set in the editor: adds an "Exit preview" button. */
  onExit?: () => void;
}

interface Col { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; ax: number; az: number; dx: number; dz: number; desc: ColliderDesc | null; id: string; on: boolean }
interface DoorState { open: number; target: number; locked: boolean; hold: number }
interface ElevState { y: number; floor: number; target: number; door: number; doorTarget: number; phase: 'idle' | 'open' | 'closing' | 'moving' | 'opening'; timer: number }
interface PlatState { t: number; dir: number; wait: number; running: boolean }

const STEP = 0.45, RADIUS = 0.33, GRAVITY = 22, CELL = 8;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), box3 = new THREE.Box3();
const cellKey = (ix: number, iz: number) => ix * 73856093 + iz * 19349663;

export class Runtime {
  renderer: THREE.WebGLRenderer;
  scene3 = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, 1, 0.08, 12000);
  env: Environment;
  terrain: TerrainSystem | null = null;
  hud: Hud;
  nodes = new Map<string, THREE.Group>();
  private scene: Scene;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private started = false;
  private paused = true;
  private keys = new Set<string>();
  private player = { x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, yawS: 0, pitchS: 0, grounded: false, ground: null as Col | null, walked: 0, bob: 0 };
  private checkpoint = { x: 0, y: 0, z: 0, yaw: 0 };
  private avatar: THREE.Mesh;
  private statics = new Map<number, Col[]>();
  private dynamics: Col[] = [];
  private colsById = new Map<string, Col[]>();
  private doors = new Map<string, DoorState>();
  private elevs = new Map<string, ElevState>();
  private plats = new Map<string, PlatState>();
  private centers = new Map<string, THREE.Vector3>();
  private vars: Record<string, number> = {};
  private fired = new Set<string>();
  private disabledRules = new Set<string>();
  private inside = new Set<string>();
  private near = new Set<string>();
  private timersDone = new Set<string>();
  private time = 0;
  private aimed: { id: string; label: string; key: string } | null = null;
  private infoOpen: { id: string; focus: boolean } | null = null;
  private infoSeen = new Set<string>();
  private journal: { title: string; body: string }[] = [];
  private cine: { c: Cinematic; t: number; fov: number } | null = null;
  private listener = new THREE.AudioListener();
  private sounds = new Map<string, THREE.Audio | THREE.PositionalAudio>();
  private elevPanel: string | null = null;
  private ro: ResizeObserver;
  private cleanup: (() => void)[] = [];
  private dragLook = false;
  private touchMove = new THREE.Vector2();
  private ended = false;

  constructor(private opts: RuntimeOptions) {
    this.scene = opts.project.scene;
    this.hud = new Hud(opts.container);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.hud.root.prepend(this.renderer.domElement);
    this.env = new Environment(this.scene3);
    this.camera.add(this.listener);
    this.scene3.add(this.camera);
    this.avatar = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 12), new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.6 }));
    this.avatar.castShadow = true;
    this.avatar.visible = false;
    this.scene3.add(this.avatar);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(opts.container);
    this.resize();
  }

  // ------------------------------------------------------------ lifecycle

  async start() {
    const { project, core, assets } = this.opts;
    this.hud.overlayScreen((o) => {
      el('h1', '', o, project.name);
      el('div', 'wr-load', o).appendChild(el('i', ''));
      el('p', '', o, 'Loading world…');
    });
    this.renderer.render(this.scene3, this.camera);
    await new Promise((r) => setTimeout(r, 30));

    const tm = this.scene.terrain;
    if (tm) {
      let data = this.opts.terrain;
      if (!data) {
        const [h, s] = await Promise.all([assets.bin('terrain/heights'), assets.bin('terrain/splat')]);
        data = { heights: h ? new Float32Array(h) : undefined, splat: s ? new Uint8Array(s) : undefined };
      }
      this.terrain = new TerrainSystem(core, { ...tm }, data);
      this.scene3.add(this.terrain.group);
    }
    const ctx: BuildCtx = { editor: false, assets, scene: this.scene, heightAt: (x, z) => this.terrain?.heightAt(x, z) ?? 0 };
    const ready: Promise<unknown>[] = [];
    const add = (id: string, parent: THREE.Object3D) => {
      const o = this.scene.objects[id];
      if (!o) return;
      const node = buildNode(o, ctx);
      this.nodes.set(id, node);
      parent.add(node);
      if (node.userData.ready) ready.push(node.userData.ready);
      o.children.forEach((c) => add(c, node));
    };
    this.scene.roots.forEach((id) => add(id, this.scene3));
    await Promise.race([Promise.all(ready), new Promise((r) => setTimeout(r, 20000))]);
    if (this.disposed) return;

    this.env.dayCycle = true;
    this.env.apply(this.scene.env, this.renderer);
    this.scene3.updateMatrixWorld(true);
    this.initState();
    this.collectColliders();
    this.loadAudio();
    this.spawn();
    if (this.terrain) for (let i = 0; i < 40 && this.terrain.update(this.camera.position, 24) > 0; i++);
    this.bind();
    this.started = true;
    this.showStart(false);
    this.clock.start();
    this.loop();
  }

  private showStart(pausedNow: boolean) {
    const { project, onExit } = this.opts;
    this.paused = true;
    this.hud.overlayScreen((o) => {
      el('h1', '', o, project.name);
      if (project.description && !pausedNow) el('p', '', o, project.description);
      const row = el('div', 'wr-row', o);
      const go = el('button', 'wr-btn', row, pausedNow ? 'Resume' : 'Click to explore');
      go.onclick = () => this.resume();
      if (onExit) el('button', 'wr-btn ghost', row, 'Exit preview').onclick = () => onExit();
      const geo = this.scene.terrain?.geo;
      if (geo?.attribution && !pausedNow) el('div', 'wr-keys', o, geo.attribution);
      el('div', 'wr-keys', o, `WASD move · Mouse look · Shift run${this.scene.player.jump ? ' · Space jump' : ''} · E interact · J journal · V camera · Esc pause`);
    });
  }

  /** Pause from outside (editor toolbar). */
  pause() {
    if (!this.started || this.paused) return;
    document.exitPointerLock?.();
    this.showStart(true);
  }

  private resume() {
    this.hud.show(this.hud.overlay, false);
    this.paused = false;
    this.clock.getDelta();
    this.listener.context.resume?.();
    this.lock();
    if (!this.fired.has('__start')) {
      this.fired.add('__start');
      for (const n of this.nodes.values()) { const sc = n.userData.screen; if (sc?.video) { sc.video.muted = !sc.sound; sc.video.play().catch(() => {}); } }
      for (const [id, s] of this.sounds) if (this.scene.objects[id]?.props.autoplay) this.playSound(id, s);
      this.fire('start');
    }
  }

  private lock() {
    try {
      const p: any = this.renderer.domElement.requestPointerLock();
      p?.catch?.(() => {});
    } catch { /* pointer lock unavailable: drag-to-look still works */ }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.ro.disconnect();
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    for (const s of this.sounds.values()) { try { if (s.isPlaying) s.stop(); } catch { /* not started */ } }
    for (const n of this.nodes.values()) n.userData.dispose?.();
    this.terrain?.dispose();
    this.env.dispose();
    this.scene3.traverse((m: any) => { m.geometry?.userData?.shared || m.geometry?.dispose?.(); });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.hud.dispose();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.opts.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private bind() {
    const on = <K extends keyof DocumentEventMap>(t: EventTarget, type: K | string, fn: (e: any) => void) => {
      t.addEventListener(type, fn);
      this.cleanup.push(() => t.removeEventListener(type, fn));
    };
    const canvas = this.renderer.domElement;
    on(document, 'keydown', (e: KeyboardEvent) => {
      if (this.paused && e.code !== 'Escape') return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyJ') this.toggleJournal();
      else if (e.code === 'KeyV') this.scene.player.mode = this.scene.player.mode === 'first' ? 'third' : 'first';
      else if (e.code === 'Enter' && this.cine) this.cine.t = this.cine.c.duration;
      else if (e.code === 'Escape') { if (this.closePanels()) this.lock(); }
      else this.onKey(e.code);
    });
    on(document, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
    on(document, 'mousemove', (e: MouseEvent) => {
      if (this.paused || this.cine) return;
      if (document.pointerLockElement !== canvas && !this.dragLook) return;
      const s = 0.0022 * this.scene.player.sensitivity;
      this.player.yaw -= e.movementX * s;
      this.player.pitch = THREE.MathUtils.clamp(this.player.pitch - e.movementY * s, -1.5, 1.5);
    });
    on(canvas, 'mousedown', (e: MouseEvent) => {
      if (this.paused) return;
      if (document.pointerLockElement !== canvas) { this.dragLook = true; if (!this.panelOpen()) this.lock(); return; }
      if (e.button === 0 && this.aimed && this.scene.objects[this.aimed.id]?.props.activation === 'click') this.interact();
    });
    on(document, 'mouseup', () => (this.dragLook = false));
    // Touch screens: drag on the left half to walk, on the right half to look, tap to interact.
    canvas.style.touchAction = 'none';
    const touches = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; move: boolean }>();
    on(canvas, 'touchstart', (e: TouchEvent) => {
      if (this.paused) return;
      const r = canvas.getBoundingClientRect();
      for (const t of Array.from(e.changedTouches)) touches.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now(), move: t.clientX - r.left < r.width / 2 });
    });
    on(canvas, 'touchmove', (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const st = touches.get(t.identifier);
        if (!st || this.paused || this.cine) continue;
        if (st.move) this.touchMove.set(THREE.MathUtils.clamp((t.clientX - st.sx) / 60, -1, 1), THREE.MathUtils.clamp((t.clientY - st.sy) / 60, -1, 1));
        else {
          const k = 0.005 * this.scene.player.sensitivity;
          this.player.yaw -= (t.clientX - st.x) * k;
          this.player.pitch = THREE.MathUtils.clamp(this.player.pitch - (t.clientY - st.y) * k, -1.5, 1.5);
        }
        st.x = t.clientX; st.y = t.clientY;
      }
    });
    const touchEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const st = touches.get(t.identifier);
        if (!st) continue;
        touches.delete(t.identifier);
        if (st.move) this.touchMove.set(0, 0);
        if (!this.paused && performance.now() - st.t < 260 && Math.hypot(t.clientX - st.sx, t.clientY - st.sy) < 12 && this.aimed) this.interact();
      }
    };
    on(canvas, 'touchend', touchEnd);
    on(canvas, 'touchcancel', touchEnd);
    on(document, 'pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.started && !this.paused && !this.panelOpen() && !this.ended) this.showStart(true);
    });
  }

  private panelOpen() { return !!this.elevPanel || !!this.infoOpen?.focus || this.hud.visible(this.hud.journal); }

  private closePanels(): boolean {
    let closed = false;
    if (this.elevPanel) { this.elevPanel = null; this.hud.show(this.hud.elev, false); closed = true; }
    if (this.infoOpen?.focus) { this.closeInfo(); closed = true; }
    if (this.hud.visible(this.hud.journal)) { this.hud.show(this.hud.journal, false); closed = true; }
    return closed;
  }

  // ------------------------------------------------------------ world state

  private initState() {
    this.vars = { collected: 0, ...this.scene.variables };
    for (const [id, o] of Object.entries(this.scene.objects)) {
      const node = this.nodes.get(id);
      if (!node) continue;
      if (o.kind === 'door') this.doors.set(id, { open: 0, target: 0, locked: !!o.props.locked, hold: 0 });
      if (o.kind === 'elevator') {
        const f = THREE.MathUtils.clamp(o.props.startFloor | 0, 0, o.props.floors.length - 1);
        this.elevs.set(id, { y: o.props.floors[f].y, floor: f, target: f, door: 0, doorTarget: 0, phase: 'idle', timer: 0 });
      }
      if (o.kind === 'platform') this.plats.set(id, { t: 0, dir: 1, wait: 0, running: o.props.mode === 'loop' });
      if (o.kind !== 'group') {
        box3.setFromObject(node);
        this.centers.set(id, box3.isEmpty() ? node.getWorldPosition(new THREE.Vector3()) : box3.getCenter(new THREE.Vector3()));
      }
    }
  }

  private makeCol(desc: ColliderDesc, id: string): Col {
    const c: Col = { cx: 0, cy: 0, cz: 0, hx: 0, hy: 0, hz: 0, ax: 1, az: 0, dx: 0, dz: 0, desc, id, on: true };
    this.updateCol(c);
    c.dx = c.dz = 0;
    return c;
  }

  private updateCol(c: Col) {
    const d = c.desc!, b = d.box;
    d.ref.updateWorldMatrix(true, false);
    const m = d.ref.matrixWorld, e = m.elements;
    const sx = Math.hypot(e[0], e[1], e[2]) || 1, sy = Math.hypot(e[4], e[5], e[6]) || 1, sz = Math.hypot(e[8], e[9], e[10]) || 1;
    const px = c.cx, pz = c.cz;
    if (Math.abs(e[1]) / sx > 0.25 || e[5] / sy < 0.9) {
      box3.min.set(b[0], b[1], b[2]); box3.max.set(b[3], b[4], b[5]); box3.applyMatrix4(m);
      box3.getCenter(v1); box3.getSize(v2);
      c.cx = v1.x; c.cy = v1.y; c.cz = v1.z; c.hx = v2.x / 2; c.hy = v2.y / 2; c.hz = v2.z / 2; c.ax = 1; c.az = 0;
    } else {
      v1.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2).applyMatrix4(m);
      c.cx = v1.x; c.cy = v1.y; c.cz = v1.z;
      c.hx = ((b[3] - b[0]) / 2) * sx; c.hy = ((b[4] - b[1]) / 2) * sy; c.hz = ((b[5] - b[2]) / 2) * sz;
      const l = Math.hypot(e[0], e[2]) || 1;
      c.ax = e[0] / l; c.az = e[2] / l;
    }
    c.dx = c.cx - px; c.dz = c.cz - pz;
  }

  private addStatic(c: Col) {
    const r = Math.hypot(c.hx, c.hz);
    for (let ix = Math.floor((c.cx - r) / CELL); ix <= Math.floor((c.cx + r) / CELL); ix++)
      for (let iz = Math.floor((c.cz - r) / CELL); iz <= Math.floor((c.cz + r) / CELL); iz++) {
        const k = cellKey(ix, iz);
        let a = this.statics.get(k);
        if (!a) this.statics.set(k, (a = []));
        a.push(c);
      }
  }

  private collectColliders() {
    const isDynamic = (id: string): boolean => {
      for (let o: Obj | undefined = this.scene.objects[id]; o; o = o.parent ? this.scene.objects[o.parent] : undefined)
        if (o.kind === 'elevator' || o.kind === 'platform') return true;
      return false;
    };
    for (const [id, node] of this.nodes) {
      const o = this.scene.objects[id];
      const list: Col[] = [];
      for (const d of node.userData.colliders as ColliderDesc[]) {
        const c = this.makeCol(d, id);
        list.push(c);
        if (d.dynamic || isDynamic(id)) this.dynamics.push(c); else this.addStatic(c);
      }
      if (o.kind === 'scatter' && o.props.solid !== false) {
        const b = prefabCollider(o.props.prefab), it: number[] = o.props.items ?? [];
        if (b)
          for (let i = 0; i < it.length; i += 4) {
            const s = it[i + 2], x = it[i] + o.pos[0], z = it[i + 1] + o.pos[2], y = this.terrain?.heightAt(x, z) ?? 0;
            const c: Col = { cx: x, cy: y + ((b[1] + b[4]) / 2) * s, cz: z, hx: ((b[3] - b[0]) / 2) * s, hy: ((b[4] - b[1]) / 2) * s, hz: ((b[5] - b[2]) / 2) * s, ax: 1, az: 0, dx: 0, dz: 0, desc: null, id, on: true };
            list.push(c);
            this.addStatic(c);
          }
      }
      if (list.length) this.colsById.set(id, list);
      if (!this.effectiveVisible(id)) list.forEach((c) => (c.on = false));
    }
  }

  private effectiveVisible(id: string) {
    for (let o: Obj | undefined = this.scene.objects[id]; o; o = o.parent ? this.scene.objects[o.parent] : undefined) if (!this.nodes.get(o.id)?.visible) return false;
    return true;
  }

  private setVisible(id: string, vis: boolean) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.visible = vis;
    const walk = (i: string) => {
      this.colsById.get(i)?.forEach((c) => (c.on = this.effectiveVisible(i)));
      this.scene.objects[i]?.children.forEach(walk);
    };
    walk(id);
  }

  private spawn() {
    const sp = Object.values(this.scene.objects).find((o) => o.kind === 'spawn' && o.visible);
    const P = this.player;
    if (sp) {
      const n = this.nodes.get(sp.id)!;
      n.getWorldPosition(v1);
      P.x = v1.x; P.y = v1.y; P.z = v1.z;
      P.yaw = P.yawS = new THREE.Euler().setFromQuaternion(n.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    } else P.y = (this.terrain?.heightAt(0, 0) ?? 0) + 0.1;
    P.y = Math.max(P.y, this.groundAt(P.x, P.z, P.y + 0.3).y);
    this.checkpoint = { x: P.x, y: P.y, z: P.z, yaw: P.yaw };
    this.placeCamera(0);
  }

  // ------------------------------------------------------------ audio

  private loadAudio() {
    const loader = new THREE.AudioLoader();
    for (const o of Object.values(this.scene.objects)) {
      if (o.kind !== 'audio' || !o.props.asset) continue;
      const p = o.props;
      const s = p.positional ? new THREE.PositionalAudio(this.listener) : new THREE.Audio(this.listener);
      if (p.positional) { (s as THREE.PositionalAudio).setRefDistance(p.refDistance); (s as THREE.PositionalAudio).setMaxDistance(p.maxDistance); (s as THREE.PositionalAudio).setDistanceModel('linear'); }
      s.setLoop(!!p.loop);
      s.setVolume(p.volume);
      this.nodes.get(o.id)?.add(s);
      this.sounds.set(o.id, s);
      this.opts.assets.url(p.asset).then((u) => (u ? loader.loadAsync(u) : null)).then((buf) => {
        if (!buf || this.disposed) return;
        s.setBuffer(buf);
        if (p.autoplay && this.fired.has('__start')) this.playSound(o.id, s);
      }).catch((e) => console.warn('Audio failed to load', o.name, e));
    }
  }

  private playSound(id: string, s = this.sounds.get(id)) {
    if (!s || !s.buffer || s.isPlaying) return;
    const p = this.scene.objects[id].props, ctx = this.listener.context;
    s.play();
    if (p.fade > 0) { s.gain.gain.setValueAtTime(0.0001, ctx.currentTime); s.gain.gain.linearRampToValueAtTime(p.volume, ctx.currentTime + p.fade); }
  }

  private stopSound(id: string) {
    const s = this.sounds.get(id);
    if (!s?.isPlaying) return;
    const fade = this.scene.objects[id].props.fade ?? 0, ctx = this.listener.context;
    if (fade > 0) { s.gain.gain.cancelScheduledValues(ctx.currentTime); s.gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + fade); setTimeout(() => { try { s.stop(); s.setVolume(this.scene.objects[id].props.volume); } catch { /* already stopped */ } }, fade * 1000); }
    else s.stop();
  }

  /** Small synthesised effects (footsteps, doors, elevator chime) – no asset files needed. */
  private blip(kind: 'step' | 'door' | 'ding' | 'pick') {
    const ctx = this.listener.context;
    if (ctx.state !== 'running') return;
    const t = ctx.currentTime, g = ctx.createGain();
    g.connect(this.listener.getInput());
    if (kind === 'ding' || kind === 'pick') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(kind === 'ding' ? 880 : 660, t);
      if (kind === 'pick') o.frequency.exponentialRampToValueAtTime(1320, t + 0.15);
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'ding' ? 1.2 : 0.3));
      o.connect(g); o.start(t); o.stop(t + 1.3);
      return;
    }
    const len = kind === 'step' ? 0.09 : 0.3, buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, kind === 'step' ? 2.5 : 1.5);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = kind === 'step' ? 700 + Math.random() * 300 : 320;
    g.gain.value = kind === 'step' ? 0.16 : 0.3;
    src.connect(f); f.connect(g); src.start(t);
  }

  // ------------------------------------------------------------ collision

  private nearby(x: number, z: number, fn: (c: Col) => void) {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = this.statics.get(cellKey(ix + a, iz + b)); if (l) for (const c of l) if (c.on) fn(c); }
    for (const c of this.dynamics) if (c.on && c.desc!.enabled) fn(c);
  }

  private groundAt(x: number, z: number, feet: number): { y: number; col: Col | null } {
    let y = this.terrain ? this.terrain.heightAt(x, z) : 0, col: Col | null = null;
    this.nearby(x, z, (c) => {
      const top = c.cy + c.hy;
      if (top > feet + STEP || top <= y) return;
      const dx = x - c.cx, dz = z - c.cz, lx = dx * c.ax + dz * c.az, lz = -dx * c.az + dz * c.ax;
      if (Math.abs(lx) <= c.hx + 0.12 && Math.abs(lz) <= c.hz + 0.12) { y = top; col = c; }
    });
    return { y, col };
  }

  private resolve(feet: number) {
    const P = this.player, head = feet + this.scene.player.eyeHeight + 0.1;
    for (let pass = 0; pass < 2; pass++)
      this.nearby(P.x, P.z, (c) => {
        if (c.cy + c.hy <= feet + STEP || c.cy - c.hy >= head) return;
        const dx = P.x - c.cx, dz = P.z - c.cz;
        let lx = dx * c.ax + dz * c.az, lz = -dx * c.az + dz * c.ax;
        const qx = THREE.MathUtils.clamp(lx, -c.hx, c.hx), qz = THREE.MathUtils.clamp(lz, -c.hz, c.hz);
        const ex = lx - qx, ez = lz - qz, d2 = ex * ex + ez * ez;
        if (d2 >= RADIUS * RADIUS) return;
        if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (RADIUS - d) / d; lx += ex * k; lz += ez * k; }
        else if (c.hx - Math.abs(lx) < c.hz - Math.abs(lz)) lx = Math.sign(lx || 1) * (c.hx + RADIUS);
        else lz = Math.sign(lz || 1) * (c.hz + RADIUS);
        P.x = c.cx + lx * c.ax - lz * c.az;
        P.z = c.cz + lx * c.az + lz * c.ax;
      });
  }

  // ------------------------------------------------------------ frame

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.paused) {
      this.time += dt;
      this.updateMachines(dt);
      for (const c of this.dynamics) this.updateCol(c);
      if (this.cine) this.updateCinematic(dt);
      else { this.updatePlayer(dt); this.placeCamera(dt); }
      this.updateTriggers();
      if (!this.cine) this.updateAim();
    }
    this.env.update(this.paused ? 0 : dt, this.camera.position);
    this.terrain?.update(this.camera.position, 3);
    this.env.render(this.renderer, this.scene3, this.camera);
  };

  private updatePlayer(dt: number) {
    const P = this.player, S = this.scene.player, K = this.keys;
    if (P.ground && (P.ground.dx || P.ground.dz)) { P.x += P.ground.dx; P.z += P.ground.dz; }
    let f = 0, s = 0;
    if (!this.panelOpen()) {
      f = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
      s = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
      if (!f && !s) { f = -this.touchMove.y; s = this.touchMove.x; }
    }
    const len = Math.hypot(f, s);
    if (len > 0.05) {
      const speed = (K.has('ShiftLeft') || K.has('ShiftRight') || len > 0.95 && this.touchMove.lengthSq() > 0.9 ? S.runSpeed : S.walkSpeed) / Math.max(len, 1);
      const sin = Math.sin(P.yaw), cos = Math.cos(P.yaw);
      const mx = (-sin * f + cos * s) * speed * dt, mz = (-cos * f - sin * s) * speed * dt;
      const steps = Math.max(1, Math.ceil(Math.hypot(mx, mz) / 0.2));
      for (let i = 0; i < steps; i++) { P.x += mx / steps; P.z += mz / steps; this.resolve(P.y); }
      if (P.grounded) {
        P.walked += Math.hypot(mx, mz);
        P.bob += Math.hypot(mx, mz);
        if (P.walked > 1.5) { P.walked = 0; if (S.footsteps) this.blip('step'); }
      }
    } else this.resolve(P.y);
    if (this.terrain) {
      const hw = this.terrain.width / 2 - 1, hd = this.terrain.depth / 2 - 1;
      P.x = THREE.MathUtils.clamp(P.x, -hw, hw); P.z = THREE.MathUtils.clamp(P.z, -hd, hd);
    }
    const g = this.groundAt(P.x, P.z, P.y);
    if (P.grounded) {
      if (S.jump && K.has('Space') && !this.panelOpen()) { P.vy = Math.sqrt(2 * GRAVITY * S.jumpHeight); P.grounded = false; P.ground = null; }
      else if (g.y >= P.y - 0.4) { P.y = g.y; P.vy = 0; P.ground = g.col; }
      else { P.grounded = false; P.ground = null; }
    }
    if (!P.grounded) {
      P.vy -= GRAVITY * dt;
      const ny = P.y + P.vy * dt;
      if (P.vy > 0) {
        const head = ny + S.eyeHeight + 0.15;
        this.nearby(P.x, P.z, (c) => {
          const bottom = c.cy - c.hy;
          if (bottom < P.y + 1 || bottom > head) return;
          const dx = P.x - c.cx, dz = P.z - c.cz;
          if (Math.abs(dx * c.ax + dz * c.az) <= c.hx && Math.abs(-dx * c.az + dz * c.ax) <= c.hz) P.vy = 0;
        });
      }
      if (ny <= g.y && P.vy <= 0) { P.y = g.y; P.vy = 0; P.grounded = true; P.ground = g.col; }
      else if (P.vy !== 0 || ny > g.y) P.y = Math.max(ny, g.y);
    }
    if (P.y < (this.terrain ? this.terrain.minMax()[0] : 0) - 60) this.teleport(this.checkpoint.x, this.checkpoint.y, this.checkpoint.z, this.checkpoint.yaw);
  }

  private placeCamera(dt: number) {
    const P = this.player, S = this.scene.player;
    const k = dt > 0 && S.smoothing > 0 ? 1 - Math.exp(-dt / (0.004 + S.smoothing * 0.09)) : 1;
    P.yawS += (P.yaw - P.yawS) * k;
    P.pitchS += (P.pitch - P.pitchS) * k;
    const bob = S.headBob && P.grounded ? Math.sin(P.bob * 4.2) * 0.035 : 0;
    this.camera.rotation.set(P.pitchS, P.yawS, 0, 'YXZ');
    const third = S.mode === 'third';
    this.avatar.visible = third;
    this.avatar.position.set(P.x, P.y + 0.85, P.z);
    if (third) {
      this.camera.getWorldDirection(v1);
      this.camera.position.set(P.x - v1.x * 4.2, P.y + S.eyeHeight + 0.5 - v1.y * 4.2, P.z - v1.z * 4.2);
      const floor = (this.terrain?.heightAt(this.camera.position.x, this.camera.position.z) ?? -1e9) + 0.3;
      if (this.camera.position.y < floor) this.camera.position.y = floor;
    } else this.camera.position.set(P.x, P.y + S.eyeHeight + bob, P.z);
    if (Math.abs(this.camera.fov - S.fov) > 0.01) { this.camera.fov = S.fov; this.camera.updateProjectionMatrix(); }
  }

  private teleport(x: number, y: number, z: number, yaw?: number) {
    const P = this.player;
    P.x = x; P.y = y; P.z = z; P.vy = 0; P.grounded = false; P.ground = null;
    if (yaw !== undefined) P.yaw = P.yawS = yaw;
  }

  // ------------------------------------------------------------ machines

  private updateMachines(dt: number) {
    const P = this.player;
    for (const [id, st] of this.doors) {
      const o = this.scene.objects[id], node = this.nodes.get(id)!, d = node.userData.door;
      if (o.props.auto && !st.locked) {
        const c = this.centers.get(id)!;
        const close = Math.hypot(c.x - P.x, c.z - P.z) < 2.6 && Math.abs(c.y - P.y - 1) < 2.5;
        if (close) { if (st.target === 0 && o.props.sound) this.blip('door'); st.target = 1; st.hold = 1.2; }
        else if ((st.hold -= dt) <= 0) st.target = 0;
      }
      if (st.open !== st.target) {
        st.open = THREE.MathUtils.clamp(st.open + Math.sign(st.target - st.open) * dt * 1.6, 0, 1);
        const e = st.open * st.open * (3 - 2 * st.open), p = o.props;
        d.pivot.position.copy(d.base); d.pivot.rotation.set(0, 0, 0);
        if (p.style === 'sliding') d.pivot.position.x = d.base.x - e * p.width * 0.96;
        else if (p.style === 'garage') d.pivot.position.y = d.base.y + e * p.height * 0.94;
        else if (p.style === 'rotating') d.pivot.rotation.y = e * Math.PI;
        else d.pivot.rotation.y = -e * 1.75;
        for (const c of this.colsById.get(id) ?? []) if (c.desc?.tag === 'door') c.desc.enabled = st.open < 0.5;
      }
    }
    for (const [id, st] of this.elevs) {
      const o = this.scene.objects[id], p = o.props, node = this.nodes.get(id)!, E = node.userData.elevator;
      const local = node.worldToLocal(v1.set(P.x, P.y, P.z));
      const inX = Math.abs(local.x) < p.width / 2, atLevel = Math.abs(local.y - st.y) < 1.2;
      const inside = inX && Math.abs(local.z) < p.depth / 2 && atLevel;
      const inDoorway = inX && Math.abs(local.z - p.depth / 2) < 0.6 && atLevel;
      const approaching = atLevel && Math.hypot(local.x, local.z - p.depth / 2) < 2.4;
      if (st.phase === 'idle' && approaching && !inside) { st.phase = 'opening'; st.doorTarget = 1; if (p.sound) this.blip('door'); }
      if (st.phase === 'opening' && st.door >= 1) { st.phase = 'open'; st.timer = p.doorTime; }
      if (st.phase === 'open') { if (inDoorway) st.timer = Math.max(st.timer, 1); if ((st.timer -= dt) <= 0) { st.phase = 'closing'; st.doorTarget = 0; } }
      if (st.phase === 'closing') {
        if (inDoorway) { st.phase = 'opening'; st.doorTarget = 1; }
        else if (st.door <= 0) st.phase = st.target !== st.floor ? 'moving' : 'idle';
      }
      if (st.phase === 'moving') {
        const ty = p.floors[st.target].y, step = p.speed * dt;
        if (Math.abs(ty - st.y) <= step) {
          st.y = ty; st.floor = st.target; st.phase = 'opening'; st.doorTarget = 1;
          E.setLabel(p.floors[st.floor].name);
          if (p.sound) this.blip('ding');
          this.fire('elevatorArrive', id);
        } else st.y += Math.sign(ty - st.y) * step;
        E.cabin.position.y = st.y;
      }
      if (st.door !== st.doorTarget) {
        st.door = THREE.MathUtils.clamp(st.door + Math.sign(st.doorTarget - st.door) * dt * 1.1, 0, 1);
        E.doorL.position.x = -p.width / 4 - st.door * p.width * 0.47;
        E.doorR.position.x = p.width / 4 + st.door * p.width * 0.47;
        for (const c of this.colsById.get(id) ?? []) if (c.desc?.tag === 'edoor') c.desc.enabled = st.door < 0.6;
      }
    }
    for (const [id, st] of this.plats) {
      if (!st.running) continue;
      const p = this.scene.objects[id].props, mover = this.nodes.get(id)!.userData.platform.mover as THREE.Object3D;
      if (st.wait > 0) { st.wait -= dt; continue; }
      const dist = Math.hypot(p.offset[0], p.offset[1], p.offset[2]) || 1;
      st.t += (st.dir * p.speed * dt) / dist;
      if (st.t >= 1 || st.t <= 0) {
        st.t = THREE.MathUtils.clamp(st.t, 0, 1); st.dir *= -1; st.wait = p.pause;
        if (p.mode !== 'loop') st.running = false;
      }
      const e = st.t * st.t * (3 - 2 * st.t);
      mover.position.set(p.offset[0] * e, p.offset[1] * e, p.offset[2] * e);
    }
  }

  private callElevator(id: string, floor: number) {
    const st = this.elevs.get(id)!, p = this.scene.objects[id].props;
    floor = THREE.MathUtils.clamp(floor | 0, 0, p.floors.length - 1);
    if (st.phase === 'moving') return;
    st.target = floor;
    if (floor === st.floor) { if (st.phase === 'idle' || st.phase === 'closing') { st.phase = 'opening'; st.doorTarget = 1; } }
    else { st.phase = 'closing'; st.doorTarget = 0; }
  }

  private setDoor(id: string, mode: string) {
    const st = this.doors.get(id), o = this.scene.objects[id];
    if (!st) return;
    if (mode === 'lock') st.locked = true;
    else if (mode === 'unlock') st.locked = false;
    else {
      const t = mode === 'open' ? 1 : mode === 'close' ? 0 : st.target ? 0 : 1;
      if (t !== st.target && o.props.sound) this.blip('door');
      st.target = t;
    }
  }

  // ------------------------------------------------------------ interaction

  private updateAim() {
    const P = this.player, S = this.scene.player;
    this.camera.getWorldDirection(v2);
    const eye = v1.set(P.x, P.y + S.eyeHeight, P.z);
    let best: typeof this.aimed = null, bestScore = Infinity;
    const consider = (id: string, pos: THREE.Vector3, label: string, key = 'E', maxD = S.interactDistance) => {
      const dx = pos.x - eye.x, dy = pos.y - eye.y, dz = pos.z - eye.z, d = Math.hypot(dx, dy, dz);
      if (d > maxD) return;
      const dot = d < 0.6 ? 1 : (dx * v2.x + dy * v2.y + dz * v2.z) / d;
      if (dot < 0.55) return;
      const score = d * (2 - dot);
      if (score < bestScore) { bestScore = score; best = { id, label, key }; }
    };
    for (const [id, c] of this.centers) {
      const o = this.scene.objects[id], p = o.props;
      if (!this.effectiveVisible(id)) continue;
      if (o.kind === 'door') { if (!p.auto) { const st = this.doors.get(id)!; consider(id, c, st.locked ? 'Locked' : st.target ? 'Close door' : 'Open door'); } }
      else if (o.kind === 'info') {
        if (p.activation === 'proximity') {
          const d = Math.hypot(c.x - P.x, c.y - eye.y, c.z - P.z);
          if (d < p.distance) { if (!this.infoOpen && !this.near.has('i' + id)) { this.near.add('i' + id); this.openInfo(id, false); } }
          else { this.near.delete('i' + id); if (this.infoOpen?.id === id && !this.infoOpen.focus) this.closeInfo(); }
          if (this.infoOpen?.id === id && !this.infoOpen.focus && (p.link || p.video || p.audio)) consider(id, c, 'Open details', 'E', p.distance + 1);
        }
        if (p.activation !== 'proximity' && this.infoOpen?.id === id && !this.infoOpen.focus && Math.hypot(c.x - P.x, c.z - P.z) > Math.max(p.distance ?? 4, 3) + 2.5) this.closeInfo(); // shown by an event: closes when the visitor walks away
        if (p.activation === 'proximity') { /* handled above */ }
        else if (p.activation === 'key') consider(id, c, p.title || 'Read', (p.key || 'E').toUpperCase(), p.distance);
        else if (p.activation === 'click') consider(id, c, p.title || 'Read', 'Click', p.distance);
      } else if (o.kind === 'elevator') {
        const st = this.elevs.get(id)!, node = this.nodes.get(id)!;
        const l = node.worldToLocal(new THREE.Vector3(P.x, P.y, P.z));
        if (Math.abs(l.x) < p.width / 2 && Math.abs(l.z) < p.depth / 2 && Math.abs(l.y - st.y) < 1.2) { if (st.phase !== 'moving') { best = { id, label: 'Select floor', key: 'E' }; bestScore = -1; } }
        else if (Math.hypot(l.x, l.z - p.depth / 2) < 3) {
          const f = (p.floors as any[]).findIndex((fl) => Math.abs(l.y - fl.y) < 1.2);
          if (f >= 0 && !(f === st.floor && st.phase !== 'idle')) consider(id, node.localToWorld(new THREE.Vector3(0, p.floors[f].y + 1.2, p.depth / 2)), 'Call elevator', 'E', 4);
        }
      } else if (p.collectible) consider(id, c, `Collect ${o.name}`);
      else if (p.interactable) consider(id, c, p.prompt || `Use ${o.name}`);
    }
    this.aimed = best;
    const a = best as { id: string; label: string; key: string } | null;
    if (a && !this.panelOpen()) this.hud.setPrompt(a.key, a.label); else this.hud.setPrompt(null);
  }

  private onKey(code: string) {
    if (this.cine) return;
    const a = this.aimed;
    if (this.infoOpen?.focus && (code === 'KeyE' || code === 'Escape')) { this.closeInfo(); this.lock(); return; }
    if (!a) return;
    const want = a.key === 'Click' ? '' : a.key.length === 1 ? 'Key' + a.key : a.key;
    if (code === want || (code === 'KeyE' && a.key === 'E')) this.interact();
  }

  private interact() {
    const a = this.aimed;
    if (!a || this.panelOpen()) return;
    const o = this.scene.objects[a.id];
    if (o.kind === 'door') {
      if (this.doors.get(a.id)!.locked) this.hud.toast('The door is locked.', 2.5);
      else this.setDoor(a.id, 'toggle');
    } else if (o.kind === 'info') this.openInfo(a.id, true);
    else if (o.kind === 'elevator') {
      const st = this.elevs.get(a.id)!;
      if (a.label === 'Select floor') return this.openElevPanel(a.id);
      const l = this.nodes.get(a.id)!.worldToLocal(new THREE.Vector3(this.player.x, this.player.y, this.player.z));
      const f = (o.props.floors as any[]).findIndex((fl) => Math.abs(l.y - fl.y) < 1.2);
      if (f >= 0) { this.callElevator(a.id, f); if (st.floor !== f) this.hud.toast('Elevator called.', 2); }
    } else if (o.props.collectible) {
      this.setVisible(a.id, false);
      this.vars.collected = (this.vars.collected ?? 0) + 1;
      this.journal.push({ title: o.name, body: o.props.note || 'Collected.' });
      this.hud.toast(`Collected: ${o.name}`);
      this.blip('pick');
      this.fire('collect', a.id);
      this.fire('variable', undefined, 'collected');
    }
    this.fire('interact', a.id);
  }

  private openElevPanel(id: string) {
    const p = this.scene.objects[id].props, st = this.elevs.get(id)!, e = this.hud.elev;
    e.textContent = '';
    el('h3', '', e, 'Select floor');
    (p.floors as any[]).forEach((f, i) => {
      const b = el('button', i === st.floor ? 'cur' : '', e, f.name);
      b.onclick = () => { this.callElevator(id, i); this.closePanels(); this.lock(); };
    });
    this.elevPanel = id;
    this.hud.show(e, true);
    document.exitPointerLock?.();
  }

  private async openInfo(id: string, focus: boolean) {
    const o = this.scene.objects[id];
    if (!o) return;
    const p = o.props, box = this.hud.info;
    this.infoOpen = { id, focus };
    box.textContent = '';
    box.className = `wr-info ${p.font === 'serif' ? 'serif' : p.font === 'mono' ? 'mono' : ''} ${focus ? 'focus' : ''} ${p.animation === 'slide' && !focus ? 'wr-slide' : ''}`;
    if (p.animation === 'none') box.style.animation = 'none'; else box.style.animation = '';
    box.style.background = p.background; box.style.color = p.text; box.style.borderTopColor = p.color;
    const tag = ({ museum: 'Exhibit', history: 'Historical note', education: 'Did you know?', object: '' } as Record<string, string>)[p.template];
    if (tag) el('div', 'wr-tag', box, tag);
    el('h2', '', box, p.title);
    if (p.image) { const u = await this.opts.assets.url(p.image); if (u && this.infoOpen?.id === id) { const img = el('img', '', box); img.src = u; img.alt = p.title; } }
    richText(box, p.body);
    if (focus) {
      if (p.video) { const u = /^https?:/.test(p.video) ? p.video : await this.opts.assets.url(p.video); if (u) { const v = el('video', '', box); v.src = u; v.controls = true; } }
      if (p.audio) { const u = await this.opts.assets.url(p.audio); if (u) { const a = el('audio', '', box); a.src = u; a.controls = true; a.autoplay = true; } }
      if (p.link && /^https?:\/\//.test(p.link)) { const a = el('a', '', el('p', '', box), p.linkLabel || p.link); a.href = p.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      el('button', 'wr-btn', box, 'Close').onclick = () => { this.closeInfo(); this.lock(); };
      document.exitPointerLock?.();
    } else if (p.activation !== 'proximity') el('div', 'wr-hint', box, 'Walk away to close');
    this.hud.show(box, true);
    if (!this.infoSeen.has(id)) { this.infoSeen.add(id); this.journal.push({ title: p.title, body: p.body }); }
  }

  private closeInfo() {
    this.hud.info.querySelectorAll('audio,video').forEach((m) => (m as HTMLMediaElement).pause());
    this.hud.show(this.hud.info, false);
    this.infoOpen = null;
  }

  private toggleJournal() {
    const j = this.hud.journal;
    if (this.hud.visible(j)) { this.hud.show(j, false); this.lock(); return; }
    j.textContent = '';
    el('h2', '', j, 'Journal');
    if (!this.journal.length) el('p', '', j, 'Nothing discovered yet. Explore the world to fill these pages.');
    for (const e of this.journal) { el('h4', '', j, e.title); el('p', '', j, e.body); }
    this.hud.show(j, true);
    document.exitPointerLock?.();
  }

  // ------------------------------------------------------------ events

  private updateTriggers() {
    const P = this.player;
    for (const r of this.scene.events) {
      if (!r.enabled || this.disabledRules.has(r.id)) continue;
      const t = r.trigger, node = t.target ? this.nodes.get(t.target) : undefined;
      if ((t.type === 'enterZone' || t.type === 'leaveZone') && node) {
        const size = this.scene.objects[t.target!].props.size ?? [4, 3, 4];
        const l = node.worldToLocal(v1.set(P.x, P.y + 0.9, P.z));
        const inside = Math.abs(l.x) <= size[0] / 2 && l.y >= 0 && l.y <= size[1] && Math.abs(l.z) <= size[2] / 2;
        const k = r.id, was = this.inside.has(k);
        if (inside && !was) { this.inside.add(k); if (t.type === 'enterZone') this.run(r); }
        else if (!inside && was) { this.inside.delete(k); if (t.type === 'leaveZone') this.run(r); }
      } else if (t.type === 'near' && t.target) {
        const c = this.centers.get(t.target) ?? node?.getWorldPosition(new THREE.Vector3());
        if (!c) continue;
        const close = Math.hypot(c.x - P.x, c.y - (P.y + 1), c.z - P.z) < (t.value ?? 4);
        const was = this.near.has(r.id);
        if (close && !was) { this.near.add(r.id); this.run(r); } else if (!close && was) this.near.delete(r.id);
      } else if (t.type === 'timer' && !this.timersDone.has(r.id) && this.time >= (t.value ?? 0)) { this.timersDone.add(r.id); this.run(r); }
    }
  }

  /** Dispatch a discrete trigger (start, interact, collect, variable, cinematicEnd, elevatorArrive). */
  private fire(type: string, target?: string, name?: string) {
    for (const r of this.scene.events) {
      if (!r.enabled || this.disabledRules.has(r.id) || r.trigger.type !== type) continue;
      if (type === 'variable') { if (r.trigger.name !== name) continue; }
      else if (r.trigger.target && r.trigger.target !== target) continue;
      this.run(r);
    }
  }

  private test(r: EventRule) {
    return r.conditions.every((c) => {
      const v = this.vars[c.name] ?? 0;
      return c.op === '=' ? v === c.value : c.op === '!=' ? v !== c.value : c.op === '>' ? v > c.value : c.op === '<' ? v < c.value : c.op === '>=' ? v >= c.value : v <= c.value;
    });
  }

  private async run(r: EventRule) {
    if (r.once && this.fired.has(r.id)) return;
    if (!this.test(r)) return;
    this.fired.add(r.id);
    for (const a of r.actions) {
      if (this.disposed) return;
      if (a.type === 'wait') await this.sleep(a.seconds ?? 1);
      else this.act(a);
    }
  }

  /** Game-time sleep: pausing the experience pauses event sequences too. */
  private sleep(seconds: number) {
    const until = this.time + seconds;
    return new Promise<void>((res) => { const tick = () => (this.disposed || this.time >= until ? res() : setTimeout(tick, 50)); tick(); });
  }

  private act(a: Action) {
    const H = this.hud;
    switch (a.type) {
      case 'message': H.toast(a.text ?? '', a.seconds ?? 4); break;
      case 'dialogue': H.say(a.speaker ?? '', a.text ?? '', a.seconds ?? 5); break;
      case 'subtitle': H.subtitle(a.text ?? '', a.seconds ?? 4); break;
      case 'info': this.openInfo(a.target, false); break;
      case 'playAudio': this.playSound(a.target); break;
      case 'stopAudio': this.stopSound(a.target); break;
      case 'door': this.setDoor(a.target, a.mode ?? 'toggle'); break;
      case 'setVar': {
        const v = this.vars[a.name] ?? 0;
        this.vars[a.name] = a.op === 'add' ? v + (a.value ?? 1) : a.value ?? 0;
        this.fire('variable', undefined, a.name);
        break;
      }
      case 'teleport': { const n = this.nodes.get(a.target); if (n) { n.getWorldPosition(v1); this.teleport(v1.x, v1.y, v1.z); } break; }
      case 'cinematic': this.playCinematic(a.id); break;
      case 'show': this.setVisible(a.target, true); break;
      case 'hide': this.setVisible(a.target, false); break;
      case 'elevator': if (this.elevs.has(a.target)) this.callElevator(a.target, a.floor ?? 0); break;
      case 'platform': { const s = this.plats.get(a.target); if (s) s.running = a.mode !== 'stop'; break; }
      case 'environment': { const e = this.opts.project.envPresets[a.preset] ?? ENV_PRESETS[a.preset]; if (e) this.env.apply(e, this.renderer); break; }
      case 'objective': H.setObjective(a.text ?? ''); break;
      case 'checkpoint': this.checkpoint = { x: this.player.x, y: this.player.y, z: this.player.z, yaw: this.player.yaw }; H.toast('Checkpoint reached', 2.5); break;
      case 'enableRule': this.disabledRules.delete(a.rule); break;
      case 'disableRule': this.disabledRules.add(a.rule); break;
      case 'end':
        this.ended = true; this.paused = true; document.exitPointerLock?.();
        H.overlayScreen((o) => {
          el('h1', '', o, a.title || 'The End');
          if (a.text) el('p', '', o, a.text);
          const row = el('div', 'wr-row', o);
          el('button', 'wr-btn', row, 'Keep exploring').onclick = () => { this.ended = false; this.resume(); };
          if (this.opts.onExit) el('button', 'wr-btn ghost', row, 'Exit preview').onclick = () => this.opts.onExit!();
        });
        break;
    }
  }

  // ------------------------------------------------------------ cinematics

  private playCinematic(id: string) {
    const c = this.scene.cinematics.find((x) => x.id === id);
    if (!c || c.keys.length < 1 || this.cine) return;
    this.closePanels();
    this.cine = { c, t: 0, fov: this.camera.fov };
    this.hud.root.classList.toggle('cine', c.letterbox);
    this.avatar.visible = false;
    if (c.title) this.hud.showTitle(c.title, Math.min(4, c.duration * 0.6));
    if (c.audio) this.playSound(c.audio);
  }

  private updateCinematic(dt: number) {
    const s = this.cine!, c = s.c;
    s.t += dt;
    sampleCinematic(c, s.t, this.camera);
    let fade = 0;
    if (c.fadeIn > 0 && s.t < c.fadeIn) fade = 1 - s.t / c.fadeIn;
    if (c.fadeOut > 0 && s.t > c.duration - c.fadeOut) fade = Math.max(fade, 1 - (c.duration - s.t) / c.fadeOut);
    this.hud.fade.style.opacity = String(THREE.MathUtils.clamp(fade, 0, 1));
    const sub = c.subtitles.find((x) => s.t >= x.t && s.t < x.t + x.d);
    this.hud.subtitle(sub?.text ?? '');
    if (s.t >= c.duration) {
      this.cine = null;
      this.hud.root.classList.remove('cine');
      this.hud.fade.style.opacity = '0';
      this.hud.subtitle('');
      this.camera.fov = s.fov; this.camera.updateProjectionMatrix();
      if (c.audio && !this.scene.objects[c.audio]?.props.loop) this.stopSound(c.audio);
      this.fire('cinematicEnd', c.id);
    }
  }
}
