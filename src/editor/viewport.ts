// The editor's 3D viewport: camera navigation, picking, gizmos and the
// interactive tools (terrain brushes, scatter, wall/room/road drawing).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { applyTransform, buildNode, disposeNode, updateAnimations, type BuildCtx } from '../engine/build';
import { cullByDistance } from '../engine/cull';
import { MeshEdit } from './meshedit';
import { Environment } from '../engine/environment';
import { sampleCinematic } from '../engine/cinematic';
import { PREFAB_MAP } from '../engine/prefabs';
import type { TerrainSystem } from '../engine/terrain';
import type { Cinematic, Kind, Obj, Vec3 } from '../engine/types';
import type { Editor } from './editor';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const deg = THREE.MathUtils.radToDeg;

export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 30000);
  orbit: OrbitControls;
  gizmo: TransformControls;
  mesh!: MeshEdit;
  env: Environment;
  root = new THREE.Group();
  nodes = new Map<string, THREE.Group>();
  stats = { fps: 60, ms: 16, calls: 0, tris: 0, geometries: 0, textures: 0, inView: 0, chunks: 0, chunkTotal: 0, pending: 0 };
  paused = false;
  cine: { c: Cinematic; t: number; playing: boolean } | null = null;
  onCineTick: ((t: number) => void) | null = null;
  private grid: THREE.GridHelper;
  private boxes: THREE.BoxHelper[] = [];
  private ring: THREE.Mesh;
  private preview: THREE.Line;
  private ray = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private raf = 0;
  private ro: ResizeObserver;
  private down: { x: number; y: number; button: number } | null = null;
  private pointer = { x: 0, y: 0, shift: false, inside: false };
  private stroking = false;
  private scattering: Obj | null = null;
  private scatterAcc = 0;
  private fly: { yaw: number; pitch: number; dist: number } | null = null;
  private keys = new Set<string>();
  private chain: THREE.Vector3[] = [];
  private chainGroup: string | null = null;
  private roomStart: THREE.Vector3 | null = null;
  private dragStart = new Map<string, THREE.Vector3>();
  private needEmit = false;
  private frames = 0;
  private cleanup: (() => void)[] = [];
  private savedFov = 55;

  constructor(private ed: Editor, private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const canvas = this.renderer.domElement;
    canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none';
    container.appendChild(canvas);

    this.env = new Environment(this.scene);
    this.camera.position.set(16, 12, 18);
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null as any };
    this.orbit.maxDistance = 15000;
    this.orbit.zoomToCursor = true;

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener('dragging-changed', (e: any) => this.onGizmoDrag(!!e.value));
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    this.scene.add(this.gizmo.getHelper());
    this.mesh = new MeshEdit(ed, this);

    this.grid = new THREE.GridHelper(400, 400, 0x5d6672, 0x343a43);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.55;
    this.scene.add(this.grid, this.root);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc24d, depthTest: false, transparent: true, opacity: 0.9, fog: false }));
    this.ring.renderOrder = 999;
    this.ring.visible = false;
    this.preview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffc24d, depthTest: false, fog: false }));
    this.preview.renderOrder = 999;
    this.preview.frustumCulled = false;
    this.scene.add(this.ring, this.preview);

    const on = (t: EventTarget, type: string, fn: (e: any) => void, opt?: any) => { t.addEventListener(type, fn, opt); this.cleanup.push(() => t.removeEventListener(type, fn, opt)); };
    on(canvas, 'pointerdown', (e) => this.onDown(e));
    on(canvas, 'pointermove', (e) => this.onMove(e));
    on(canvas, 'pointerup', (e) => this.onUp(e));
    on(canvas, 'pointerleave', () => { this.pointer.inside = false; this.ring.visible = false; });
    on(canvas, 'dblclick', () => (this.ed.tool === 'mesh' ? this.mesh.growFlat() : this.finishTool()));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e: KeyboardEvent) => { if (this.fly) { this.keys.add(e.code); e.preventDefault(); } });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    ed.viewport = this;
    this.reset();
    this.frame();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.ro.disconnect();
    this.orbit.dispose();
    this.gizmo.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (this.ed.viewport === this) this.ed.viewport = null;
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ scene sync

  private ctx(): BuildCtx {
    return { editor: true, assets: this.ed.assets, heightAt: this.ed.heightAt, scene: this.ed.scene };
  }

  reset() {
    this.cancelTool();
    this.setTerrain(this.ed.terrain);
    this.rebuildAll();
    this.frameAll();
  }

  rebuildAll() {
    this.gizmo.detach();
    for (const n of this.nodes.values()) disposeNode(n);
    this.root.clear();
    this.nodes.clear();
    this.ed.scene.roots.forEach((id) => this.addNode(id));
    this.applyEnv();
    if (this.mesh?.id) this.mesh.sel.clear(); // undo/redo may have changed the mesh: old picks no longer apply
    this.onSelection();
  }

  addNode(id: string) {
    const o = this.ed.obj(id);
    if (!o || this.nodes.has(id)) return;
    const node = buildNode(o, this.ctx());
    this.nodes.set(id, node);
    (o.parent ? this.nodes.get(o.parent) ?? this.root : this.root).add(node);
    o.children.forEach((c) => this.addNode(c));
  }

  removeNode(id: string) {
    const node = this.nodes.get(id);
    if (!node) return;
    if (this.gizmo.object === node) this.gizmo.detach();
    node.traverse((n) => { if (n.userData.id) this.nodes.delete(n.userData.id); });
    node.parent?.remove(node);
    disposeNode(node);
  }

  rebuildNode(id: string) {
    const o = this.ed.obj(id), old = this.nodes.get(id);
    if (!o || !old) return;
    const node = buildNode(o, this.ctx());
    for (const c of [...old.children]) if (c.userData.id) node.add(c);
    const parent = old.parent;
    parent?.remove(old);
    parent?.add(node);
    disposeNode(old);
    this.nodes.set(id, node);
    if (this.gizmo.object === old) this.gizmo.attach(node);
    if (this.ed.selection.includes(id)) this.onSelection();
  }

  rebuildKinds(kinds: Kind[]) {
    for (const o of Object.values(this.ed.scene.objects)) if (kinds.includes(o.kind)) this.rebuildNode(o.id);
  }

  syncTransform(id: string) {
    const o = this.ed.obj(id), node = this.nodes.get(id);
    if (o && node) { applyTransform(node, o); node.name = o.name; }
  }

  attach(id: string, parent: string | null) {
    const node = this.nodes.get(id), o = this.ed.obj(id);
    if (!node || !o) return;
    ((parent && this.nodes.get(parent)) || this.root).attach(node);
    this.readBack(o, node);
  }

  private readBack(o: Obj, node: THREE.Object3D) {
    o.pos = [r3(node.position.x), r3(node.position.y), r3(node.position.z)];
    o.rot = [r3(deg(node.rotation.x)), r3(deg(node.rotation.y)), r3(deg(node.rotation.z))];
    o.scale = [r3(node.scale.x), r3(node.scale.y), r3(node.scale.z)];
  }

  worldPos(id: string) { return this.nodes.get(id)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(); }
  toLocal(id: string, v: THREE.Vector3) { const n = this.nodes.get(id); n?.updateWorldMatrix(true, false); return n ? n.worldToLocal(v.clone()) : v.clone(); }

  setTerrain(t: TerrainSystem | null) {
    for (const c of [...this.scene.children]) if (c.name === 'terrain') this.scene.remove(c);
    if (t) this.scene.add(t.group);
    this.grid.visible = !t;
  }

  applyEnv() { this.env.apply(this.ed.scene.env, this.renderer); }

  onSelection() {
    this.boxes.forEach((b) => { this.scene.remove(b); b.geometry.dispose(); });
    this.boxes = [];
    for (const id of this.ed.selection) {
      const n = this.nodes.get(id);
      if (!n) continue;
      const b = new THREE.BoxHelper(n, 0xffc24d);
      (b.material as THREE.LineBasicMaterial).depthTest = false;
      b.renderOrder = 998;
      this.scene.add(b);
      this.boxes.push(b);
    }
    this.onToolChange();
  }

  onToolChange() {
    if (this.ed.tool === 'mesh') {
      if (!this.mesh.id || !this.ed.obj(this.mesh.id)) { this.mesh.exit(); this.ed.tool = 'select'; }
      else {
        const sn = this.ed.opts;
        this.gizmo.setTranslationSnap(sn.snap ? sn.grid : null); this.gizmo.setRotationSnap(sn.snap ? THREE.MathUtils.degToRad(15) : null); this.gizmo.setScaleSnap(sn.snap ? 0.1 : null);
        this.ring.visible = false;
        this.renderer.domElement.style.cursor = 'default';
        this.mesh.refresh();
        return;
      }
    } else if (this.mesh.id) this.mesh.exit();
    const t = this.ed.tool, id = this.ed.selection[this.ed.selection.length - 1], o = this.ed.obj(id), node = id ? this.nodes.get(id) : undefined;
    if ((t === 'move' || t === 'rotate' || t === 'scale') && node && o && !o.locked) {
      this.gizmo.setMode(t === 'move' ? 'translate' : t);
      this.gizmo.attach(node);
    } else this.gizmo.detach();
    const s = this.ed.opts;
    this.gizmo.setTranslationSnap(s.snap ? s.grid : null);
    this.gizmo.setRotationSnap(s.snap ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(s.snap ? 0.1 : null);
    if (t !== 'wall' && t !== 'road' && this.chain.length) this.finishTool();
    if (!['sculpt', 'paint', 'scatter'].includes(t)) this.ring.visible = false;
    this.renderer.domElement.style.cursor = ['sculpt', 'paint', 'scatter', 'wall', 'room', 'road'].includes(t) ? 'crosshair' : 'default';
  }

  // ------------------------------------------------------------ gizmo

  private onGizmoDrag(dragging: boolean) {
    this.orbit.enabled = !dragging;
    if (this.ed.tool === 'mesh') return this.mesh.gizmoDrag(dragging, this.pointer.shift);
    const ids = this.ed.topLevel(this.ed.selection);
    if (dragging) {
      this.ed.checkpoint();
      this.dragStart.clear();
      for (const id of ids) { const n = this.nodes.get(id); if (n) this.dragStart.set(id, n.position.clone()); }
    } else {
      ids.forEach((id) => this.ed.afterTransform(id));
      this.ed.touch();
    }
  }

  private onGizmoChange() {
    if (this.ed.tool === 'mesh') return this.mesh.gizmoChange();
    const node = this.gizmo.object as THREE.Object3D | undefined, id = node?.userData.id, o = this.ed.obj(id);
    if (!node || !o) return;
    if (this.gizmo.mode === 'translate' && this.dragStart.has(id)) {
      const d = node.position.clone().sub(this.dragStart.get(id)!);
      for (const [oid, start] of this.dragStart) {
        if (oid === id) continue;
        const n = this.nodes.get(oid), oo = this.ed.obj(oid);
        if (n && oo && !oo.locked && n.parent === node.parent) { n.position.copy(start).add(d); this.readBack(oo, n); }
      }
    }
    this.readBack(o, node);
    this.needEmit = true;
  }

  // ------------------------------------------------------------ picking

  private setRay(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    return this.ray.ray;
  }

  private objectHit(): { point: THREE.Vector3; id: string; distance: number } | null {
    for (const h of this.ray.intersectObject(this.root, true)) {
      let vis = true, id: string | undefined;
      for (let n: THREE.Object3D | null = h.object; n && n !== this.root; n = n.parent) { if (!n.visible) vis = false; id ??= n.userData.id; }
      if (!vis || !id || this.ed.obj(id)?.locked) continue;
      return { point: h.point, id, distance: h.distance };
    }
    return null;
  }

  private groundHit(ray: THREE.Ray, level = 0): THREE.Vector3 | null {
    const t = this.ed.terrain?.raycast(ray);
    if (t) return t;
    return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -level), new THREE.Vector3());
  }

  /** World point under the cursor: nearest of terrain, objects (optional) and the ground plane. */
  pickPoint(clientX: number, clientY: number, objects: boolean): { point: THREE.Vector3; id?: string } | null {
    const ray = this.setRay(clientX, clientY);
    const g = this.groundHit(ray);
    const o = objects && this.ed.opts.surfaceSnap ? this.objectHit() : null;
    if (o && (!g || o.distance < g.distanceTo(ray.origin))) return { point: o.point, id: o.id };
    return g ? { point: g } : null;
  }

  private buildPoint(e: PointerEvent | MouseEvent): THREE.Vector3 | null {
    const ray = this.setRay(e.clientX, e.clientY), lvl = this.ed.opts.build.level;
    const p = lvl !== 0 ? ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -lvl), new THREE.Vector3()) : this.groundHit(ray);
    if (!p) return null;
    const g = this.ed.opts.snap ? this.ed.opts.grid : 0.1;
    p.x = Math.round(p.x / g) * g; p.z = Math.round(p.z / g) * g;
    if (lvl !== 0) p.y = lvl;
    return p;
  }

  private pickSelect(e: PointerEvent) {
    this.setRay(e.clientX, e.clientY);
    const hit = this.objectHit();
    if (!hit) { if (!e.shiftKey) this.ed.select([]); return; }
    const path: string[] = [];
    for (let o = this.ed.obj(hit.id); o; o = this.ed.obj(o.parent)) if (o.id === hit.id || !o.props.folder) path.unshift(o.id);
    let idx = -1;
    path.forEach((id, i) => { if (this.ed.selection.includes(id)) idx = i; });
    const pick = idx >= 0 && idx < path.length - 1 ? path[idx + 1] : idx === path.length - 1 ? path[idx] : path[0];
    if (e.shiftKey) this.ed.toggleSelect(pick); else this.ed.select([pick]);
  }

  // ------------------------------------------------------------ pointer

  private onDown(e: PointerEvent) {
    if (this.cine) this.endPreview();
    const canvas = this.renderer.domElement;
    this.down = { x: e.clientX, y: e.clientY, button: e.button };
    if (e.button === 2) {
      const eu = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.fly = { yaw: eu.y, pitch: eu.x, dist: Math.max(4, this.camera.position.distanceTo(this.orbit.target)) };
      this.orbit.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 || e.altKey || this.gizmo.dragging || this.gizmo.axis) return;
    const tool = this.ed.tool;
    if (tool === 'sculpt' || tool === 'paint') {
      const p = this.ed.terrain?.raycast(this.setRay(e.clientX, e.clientY));
      if (!p) { if (!this.ed.terrain) this.ed.toast('Create a terrain first (World tab → Terrain).'); return; }
      this.ed.beginStroke(p.x, p.z);
      this.stroking = true;
    } else if (tool === 'scatter') {
      this.ed.checkpoint();
      this.scattering = this.scatterTarget();
      this.scatterAcc = 1;
    } else if (tool === 'room') this.roomStart = this.buildPoint(e);
    else return;
    this.orbit.enabled = false;
    canvas.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent) {
    this.pointer = { x: e.clientX, y: e.clientY, shift: e.shiftKey, inside: true };
    if (this.fly) {
      this.fly.yaw -= e.movementX * 0.0032;
      this.fly.pitch = THREE.MathUtils.clamp(this.fly.pitch - e.movementY * 0.0032, -1.55, 1.55);
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.fly.pitch, this.fly.yaw, 0, 'YXZ'));
      return;
    }
    const tool = this.ed.tool;
    if ((tool === 'wall' || tool === 'road') && this.chain.length) {
      const p = this.buildPoint(e);
      if (p) this.setPreview([...this.chain, p]);
    } else if (tool === 'room' && this.roomStart) {
      const p = this.buildPoint(e), a = this.roomStart;
      if (p) this.setPreview([a, new THREE.Vector3(p.x, a.y, a.z), new THREE.Vector3(p.x, a.y, p.z), new THREE.Vector3(a.x, a.y, p.z), a]);
    }
  }

  private onUp(e: PointerEvent) {
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    const d = this.down;
    this.down = null;
    if (this.fly) {
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      this.orbit.target.copy(this.camera.position).addScaledVector(dir, this.fly.dist);
      this.fly = null;
      this.keys.clear();
      this.orbit.enabled = true;
      return;
    }
    if (this.stroking) { this.stroking = false; this.orbit.enabled = true; this.ed.endStroke(); return; }
    if (this.scattering) {
      const o = this.scattering;
      this.scattering = null;
      this.orbit.enabled = true;
      if (!o.props.items.length) this.ed.remove([o.id]);
      this.ed.touch();
      return;
    }
    if (this.roomStart) {
      const a = this.roomStart, b = this.buildPoint(e);
      this.roomStart = null;
      this.orbit.enabled = true;
      this.setPreview([]);
      if (b && Math.abs(b.x - a.x) > 0.6 && Math.abs(b.z - a.z) > 0.6) this.makeRoom(a, b);
      return;
    }
    if (!d || d.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || this.gizmo.dragging || this.gizmo.axis || e.altKey) return;
    const tool = this.ed.tool;
    if (tool === 'wall' || tool === 'road') {
      const p = this.buildPoint(e);
      if (!p) return;
      const last = this.chain[this.chain.length - 1];
      if (last && last.distanceTo(p) < 0.15) return;
      if (tool === 'wall' && last) this.makeWall(last, p);
      this.chain.push(p);
      this.setPreview(this.chain);
    } else if (tool === 'mesh') this.mesh.click(e);
    else if (['select', 'move', 'rotate', 'scale'].includes(tool)) this.pickSelect(e);
  }

  private setPreview(pts: THREE.Vector3[]) {
    this.preview.geometry.dispose();
    this.preview.geometry = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y + 0.08, p.z)));
    this.preview.visible = pts.length > 1;
  }

  /** Finish the wall run / road being drawn (double-click or Enter). */
  finishTool() {
    if (this.ed.tool === 'road' && this.chain.length >= 2) {
      const a = this.chain[0], r = this.ed.opts.road;
      const water = r.kindOf === 'river';
      this.ed.create('road', water ? 'River' : r.width <= 2.5 ? 'Path' : 'Road', { points: this.chain.map((p) => [r3(p.x - a.x), r3(p.z - a.z)]), width: r.width, sidewalks: r.sidewalks && !water, kindOf: r.kindOf, color: water ? '#3b78a8' : r.color }, [r3(a.x), 0, r3(a.z)]);
    }
    if (this.ed.tool === 'wall' && this.chainGroup) { this.ed.select([this.chainGroup]); this.ed.touch(); }
    this.cancelTool();
  }

  cancelTool() {
    this.chain = [];
    this.chainGroup = null;
    this.roomStart = null;
    this.setPreview([]);
  }

  get drawing() { return this.chain.length > 0; }
  get flying() { return !!this.fly; }

  // ------------------------------------------------------------ building tools

  private makeWall(a: THREE.Vector3, b: THREE.Vector3) {
    const B = this.ed.opts.build, dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), t = B.thickness;
    if (!this.chainGroup || !this.ed.obj(this.chainGroup)) {
      this.ed.checkpoint();
      this.chainGroup = this.ed.spawn('group', 'Walls', { folder: false }, [0, 0, 0]).id;
    }
    const ux = dx / len, uz = dz / len;
    this.ed.spawn('wall', 'Wall', { length: r3(len + t), height: B.height, thickness: t, color: B.color }, [r3(a.x - (ux * t) / 2), r3(a.y), r3(a.z - (uz * t) / 2)], this.chainGroup, { rot: [0, r3(deg(Math.atan2(-dz, dx))), 0] });
    this.ed.touch();
  }

  private makeRoom(a: THREE.Vector3, b: THREE.Vector3) {
    const B = this.ed.opts.build, t = B.thickness, H = B.height;
    const w = Math.abs(b.x - a.x), d = Math.abs(b.z - a.z), cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    this.ed.checkpoint();
    const g = this.ed.spawn('group', 'Room', { room: true, height: H }, [r3(cx), r3(a.y), r3(cz)]);
    const wall = (name: string, pos: Vec3, rotY: number, length: number) => this.ed.spawn('wall', name, { length: r3(length), height: H, thickness: t, color: B.color }, pos, g.id, { rot: [0, rotY, 0] });
    wall('Wall north', [-w / 2 - t / 2, 0, -d / 2], 0, w + t);
    wall('Wall south', [-w / 2 - t / 2, 0, d / 2], 0, w + t);
    wall('Wall west', [-w / 2, 0, -d / 2 + t / 2], -90, d - t);
    wall('Wall east', [w / 2, 0, -d / 2 + t / 2], -90, d - t);
    this.ed.spawn('floor', 'Floor', { width: r3(w + t), depth: r3(d + t), thickness: 0.2 }, [0, 0.05, 0], g.id);
    if (B.ceiling) this.ed.spawn('floor', 'Ceiling', { width: r3(w + t), depth: r3(d + t), thickness: 0.2, color: '#e8e6e0' }, [0, H + 0.2, 0], g.id);
    this.ed.select([g.id]);
    this.ed.touch();
  }

  private scatterTarget(): Obj {
    const key = this.ed.opts.scatter.prefab, sel = this.ed.obj(this.ed.selection[0]);
    if (sel?.kind === 'scatter' && sel.props.prefab === key) return sel;
    const found = Object.values(this.ed.scene.objects).find((o) => o.kind === 'scatter' && o.props.prefab === key && !o.locked);
    if (found) return found;
    return this.ed.spawn('scatter', `${PREFAB_MAP[key]?.name ?? 'Object'} field`, { prefab: key, items: [] });
  }

  private scatterStep(p: THREE.Vector3, dt: number, erase: boolean) {
    const o = this.scattering!, S = this.ed.opts.scatter, R = this.ed.opts.brush.radius, items: number[] = o.props.items;
    const lx = p.x - o.pos[0], lz = p.z - o.pos[2];
    if (erase) {
      const keep: number[] = [];
      for (let i = 0; i < items.length; i += 4) if (Math.hypot(items[i] - lx, items[i + 1] - lz) > R) keep.push(items[i], items[i + 1], items[i + 2], items[i + 3]);
      if (keep.length === items.length) return;
      o.props.items = keep;
    } else {
      this.scatterAcc += S.density * R * R * 0.25 * dt + S.density * 2 * dt;
      let n = Math.floor(this.scatterAcc);
      this.scatterAcc -= n;
      if (!n || items.length > 4 * 60000) return;
      while (n-- > 0) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
        const x = lx + Math.cos(a) * r, z = lz + Math.sin(a) * r;
        if (this.ed.terrain && !this.ed.terrain.inside(x + o.pos[0], z + o.pos[2])) continue;
        const s = THREE.MathUtils.lerp(1, THREE.MathUtils.lerp(S.minScale, S.maxScale, Math.random()), S.random);
        items.push(r3(x), r3(z), r3(s), r3(Math.random() * Math.PI * 2 * Math.max(S.random, 0.05)));
      }
    }
    this.rebuildNode(o.id);
    this.needEmit = true;
  }

  // ------------------------------------------------------------ camera helpers

  frameAll() {
    const t = this.ed.terrain;
    const sp = Object.values(this.ed.scene.objects).find((o) => o.kind === 'spawn');
    if (sp && this.nodes.get(sp.id)) {
      const p = this.worldPos(sp.id);
      this.orbit.target.set(p.x, p.y + 1, p.z - 6);
      this.camera.position.set(p.x + 16, p.y + 13, p.z + 20);
      this.orbit.update();
      return;
    }
    const box = new THREE.Box3().setFromObject(this.root);
    if (!box.isEmpty() && box.getSize(new THREE.Vector3()).length() < 400) return this.frameBox(box);
    if (t) {
      const s = Math.min(Math.max(t.width, t.depth), 900), y = t.heightAt(0, 0);
      this.orbit.target.set(0, y, 0);
      this.camera.position.set(s * 0.32, y + s * 0.3, s * 0.45);
    } else if (!box.isEmpty()) return this.frameBox(box);
    else { this.orbit.target.set(0, 0, 0); this.camera.position.set(16, 12, 18); }
    this.orbit.update();
  }

  private frameBox(box: THREE.Box3) {
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1.5);
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    if (dir.y < 0.25) dir.set(dir.x, 0.45, dir.z).normalize();
    this.orbit.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dir, r * 2.4);
    this.orbit.update();
  }

  focus(ids: string[] = this.ed.selection) {
    const box = new THREE.Box3();
    ids.forEach((id) => { const n = this.nodes.get(id); if (n) box.expandByObject(n); });
    if (box.isEmpty()) { const p = ids.length ? this.worldPos(ids[0]) : null; if (!p) return; box.setFromCenterAndSize(p, new THREE.Vector3(2, 2, 2)); }
    this.frameBox(box);
  }

  viewKey() {
    return { pos: this.camera.position.toArray().map(r3) as Vec3, quat: this.camera.quaternion.toArray().map((n) => Math.round(n * 1e5) / 1e5) as [number, number, number, number], fov: this.cine ? this.camera.fov : 55 };
  }

  previewCinematic(c: Cinematic, t: number, playing: boolean) {
    if (!this.cine) this.savedFov = this.camera.fov;
    this.cine = { c, t, playing };
    this.orbit.enabled = false;
    sampleCinematic(c, t, this.camera);
  }

  endPreview() {
    if (!this.cine) return;
    this.cine = null;
    this.camera.fov = this.savedFov;
    this.camera.updateProjectionMatrix();
    this.orbit.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), 12);
    this.orbit.enabled = true;
    this.onCineTick?.(-1);
  }

  thumbnail(): string | undefined {
    try {
      this.env.render(this.renderer, this.scene, this.camera);
      const c = document.createElement('canvas');
      c.width = 320; c.height = 180;
      const src = this.renderer.domElement, sa = src.width / src.height, da = 320 / 180;
      const sw = sa > da ? src.height * da : src.width, sh = sa > da ? src.height : src.width / da;
      c.getContext('2d')!.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, 320, 180);
      return c.toDataURL('image/jpeg', 0.7);
    } catch { return undefined; }
  }

  // ------------------------------------------------------------ frame

  private frame = () => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.paused || document.hidden) return;
    const ed = this.ed, tool = ed.tool;

    if (this.fly) {
      const K = this.keys, sp = (K.has('ShiftLeft') ? 60 : 14) * dt;
      const f = (K.has('KeyW') ? 1 : 0) - (K.has('KeyS') ? 1 : 0), s = (K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0), u = (K.has('KeyE') ? 1 : 0) - (K.has('KeyQ') ? 1 : 0);
      if (f || s || u) { this.camera.translateZ(-f * sp); this.camera.translateX(s * sp); this.camera.position.y += u * sp; }
    } else if (this.cine) {
      if (this.cine.playing) {
        this.cine.t += dt;
        if (this.cine.t >= this.cine.c.duration) { this.cine.t = this.cine.c.duration; this.cine.playing = false; }
        this.onCineTick?.(this.cine.t);
      }
      sampleCinematic(this.cine.c, this.cine.t, this.camera);
    } else this.orbit.update();

    if (this.pointer.inside && (tool === 'sculpt' || tool === 'paint' || tool === 'scatter')) {
      const ray = this.setRay(this.pointer.x, this.pointer.y);
      const p = tool === 'scatter' ? this.groundHit(ray) : ed.terrain?.raycast(ray) ?? null;
      this.ring.visible = !!p;
      if (p) {
        this.ring.position.set(p.x, p.y + 0.15, p.z);
        this.ring.scale.setScalar(ed.opts.brush.radius);
        if (this.stroking) ed.strokeAt(p.x, p.z, dt, this.pointer.shift);
        if (this.scattering) this.scatterStep(p, dt, this.pointer.shift);
      }
    }

    const pending = ed.terrain?.update(this.camera.position, this.stroking ? 10 : 5) ?? 0;
    this.env.update(dt, this.camera.position);
    // Keep the world readable while editing from far away: fog is capped by the viewing distance.
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = Math.min(ed.scene.env.fogDensity, 0.8 / Math.max(this.camera.position.distanceTo(this.orbit.target), 1));
    for (const b of this.boxes) b.update();
    if (this.frames % 8 === 0) cullByDistance(this.scene, this.camera.position, 3);
    updateAnimations(dt);
    this.env.render(this.renderer, this.scene, this.camera);

    if (this.needEmit) { this.needEmit = false; ed.emit(); }
    const st = this.stats, info = this.renderer.info;
    st.ms += (dt * 1000 - st.ms) * 0.08; st.fps = 1000 / Math.max(st.ms, 0.01);
    if (++this.frames % 20 === 0) {
      st.calls = info.render.calls; st.tris = info.render.triangles; st.geometries = info.memory.geometries; st.textures = info.memory.textures;
      st.chunks = ed.terrain?.stats.active ?? 0; st.chunkTotal = ed.terrain?.stats.total ?? 0; st.pending = pending;
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)), v = new THREE.Vector3();
      let n = 0;
      for (const node of this.nodes.values()) if (node.visible && fr.containsPoint(node.getWorldPosition(v))) n++;
      st.inView = n;
    }
  };
}
