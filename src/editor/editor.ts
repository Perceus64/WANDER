// Editor core: owns the open project, selection, tools, undo history and
// persistence. The React UI and the 3D viewport both talk to this class.
import * as THREE from 'three';
import type { Core } from '../engine/wasm';
import { TerrainSystem, validSize, type TerrainData } from '../engine/terrain';
import { clearAssetCaches } from '../engine/build';
import { PREFAB_MAP } from '../engine/prefabs';
import { DEFAULT_LAYERS, ENV_PRESETS, KIND_DEFAULTS, makeObj, newProject, uid, type Asset, type AssetProvider, type Env, type Kind, type Obj, type Project, type Scene, type TerrainMeta, type Vec3 } from '../engine/types';
import * as store from './storage';
import type { Viewport } from './viewport';

export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'sculpt' | 'paint' | 'scatter' | 'wall' | 'room' | 'road';
export interface DropPayload { type: 'prefab' | 'kind' | 'asset' | 'userPrefab'; key: string; props?: Record<string, any>; name?: string }
type Hist =
  | { kind: 'scene'; scene: Scene; sel: string[] }
  | { kind: 'terrain'; rect: number[]; bh: Float32Array; ah: Float32Array; bs: Uint8Array; as: Uint8Array };

const TERRAIN_KINDS: Kind[] = ['road', 'poly', 'scatter'];
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export class Editor {
  project: Project = newProject('Untitled world');
  blobs = new Map<string, Blob>();
  terrain: TerrainSystem | null = null;
  selection: string[] = [];
  tool: Tool = 'select';
  opts = {
    snap: false, grid: 0.5, surfaceSnap: true,
    brush: { mode: 0, radius: 14, strength: 0.5, layer: 1 },
    scatter: { prefab: 'tree_pine', density: 0.35, random: 0.6, minScale: 0.8, maxScale: 1.4 },
    build: { height: 3, thickness: 0.2, level: 0, ceiling: true, color: '#d9d5cc' },
    road: { width: 6, sidewalks: false, kindOf: 'road', color: '#3c3d40' },
  };
  viewport: Viewport | null = null;
  dirty = false;
  saving = false;
  savedAt = 0;
  version = 0;
  toasts: { id: number; text: string; kind: 'info' | 'error' | 'ok' }[] = [];
  private subs = new Set<() => void>();
  private undoStack: Hist[] = [];
  private redoStack: Hist[] = [];
  private lastKey = '';
  private lastKeyTime = 0;
  private urls = new Map<string, string>();
  private blobDirty = new Set<string>();
  private terrainDirty = false;
  private clipboard: { objects: Record<string, Obj>; roots: string[] } | null = null;
  private stroke: { h: Float32Array; s: Uint8Array; rect: number[] | null; target: number } | null = null;
  private toastId = 0;

  constructor(public core: Core) {
    setInterval(() => { if (this.dirty && !this.saving) this.save().catch(() => {}); }, 20000);
  }

  get scene() { return this.project.scene; }

  assets: AssetProvider = {
    url: async (key) => {
      if (!key) return null;
      let u = this.urls.get(key);
      const b = this.blobs.get(key);
      if (!u && b) this.urls.set(key, (u = URL.createObjectURL(b)));
      return u ?? null;
    },
    bin: async (key) => (await this.blobs.get(key)?.arrayBuffer()) ?? null,
  };

  // ------------------------------------------------------------ plumbing

  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  emit() { this.version++; this.subs.forEach((f) => f()); }
  touch() { this.dirty = true; this.project.modified = Date.now(); this.emit(); }

  toast(text: string, kind: 'info' | 'error' | 'ok' = 'info') {
    const id = ++this.toastId;
    this.toasts.push({ id, text, kind });
    this.emit();
    setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); this.emit(); }, kind === 'error' ? 7000 : 3500);
  }

  setTool(t: Tool) { this.tool = t; this.viewport?.onToolChange(); this.emit(); }
  obj(id: string | undefined | null): Obj | undefined { return id ? this.scene.objects[id] : undefined; }
  heightAt = (x: number, z: number) => this.terrain?.heightAt(x, z) ?? 0;

  // ------------------------------------------------------------ history

  checkpoint(key?: string) {
    const now = performance.now();
    if (key && key === this.lastKey && now - this.lastKeyTime < 1200) { this.lastKeyTime = now; return; }
    this.lastKey = key ?? ''; this.lastKeyTime = now;
    this.undoStack.push({ kind: 'scene', scene: structuredClone(this.scene), sel: [...this.selection] });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() { this.step(this.undoStack, this.redoStack, true); }
  redo() { this.step(this.redoStack, this.undoStack, false); }

  private step(from: Hist[], to: Hist[], isUndo: boolean) {
    const h = from.pop();
    if (!h) return;
    this.lastKey = '';
    if (h.kind === 'scene') {
      to.push({ kind: 'scene', scene: structuredClone(this.scene), sel: [...this.selection] });
      const assets = this.scene.assets;
      this.project.scene = h.scene;
      this.scene.assets = assets;
      if (this.terrain && this.scene.terrain) {
        this.terrain.meta = this.scene.terrain;
        this.terrain.setExaggeration(this.scene.terrain.exaggeration);
        this.terrain.setPalette();
      }
      this.selection = h.sel.filter((id) => this.scene.objects[id]);
      this.viewport?.rebuildAll();
    } else if (this.terrain) {
      this.applyPatch(h.rect, isUndo ? h.bh : h.ah, isUndo ? h.bs : h.as);
      to.push(h);
      this.viewport?.rebuildKinds(TERRAIN_KINDS);
    }
    this.touch();
  }

  private clearHistory() { this.undoStack = []; this.redoStack = []; this.lastKey = ''; }

  // ------------------------------------------------------------ objects

  /** Insert an object without touching history/selection (bulk operations). */
  add(o: Obj, parent: string | null = null): Obj {
    this.scene.objects[o.id] = o;
    o.parent = parent && this.scene.objects[parent] ? parent : null;
    (o.parent ? this.scene.objects[o.parent].children : this.scene.roots).push(o.id);
    this.viewport?.addNode(o.id);
    return o;
  }

  spawn(kind: Kind, name: string, props: Record<string, any> = {}, pos: Vec3 = [0, 0, 0], parent: string | null = null, extra: Partial<Obj> = {}): Obj {
    const o = makeObj(kind, name, { ...structuredClone(KIND_DEFAULTS[kind]), ...props }, pos);
    Object.assign(o, extra);
    return this.add(o, parent);
  }

  create(kind: Kind, name: string, props: Record<string, any> = {}, pos: Vec3 = [0, 0, 0], parent: string | null = null): Obj {
    this.checkpoint();
    const o = this.spawn(kind, name, props, pos, parent);
    this.select([o.id]);
    this.touch();
    return o;
  }

  topLevel(ids: string[]) {
    const set = new Set(ids);
    return ids.filter((id) => {
      for (let p = this.obj(id)?.parent; p; p = this.obj(p)?.parent) if (set.has(p)) return false;
      return !!this.obj(id);
    });
  }

  private removeRec(id: string) {
    const o = this.obj(id);
    if (!o) return;
    [...o.children].forEach((c) => this.removeRec(c));
    const par = this.obj(o.parent);
    if (par) {
      par.children = par.children.filter((c) => c !== id);
      if (par.kind === 'wall' && par.props.openings?.some((op: any) => op.id === id)) {
        par.props.openings = par.props.openings.filter((op: any) => op.id !== id);
        this.viewport?.removeNode(id);
        delete this.scene.objects[id];
        this.viewport?.rebuildNode(par.id);
        return;
      }
    } else this.scene.roots = this.scene.roots.filter((c) => c !== id);
    this.viewport?.removeNode(id);
    delete this.scene.objects[id];
  }

  remove(ids: string[] = this.selection) {
    const top = this.topLevel(ids).filter((id) => !this.obj(id)!.locked);
    if (!top.length) return;
    this.checkpoint();
    top.forEach((id) => this.removeRec(id));
    this.selection = this.selection.filter((id) => this.obj(id));
    this.viewport?.onSelection();
    this.touch();
  }

  /** Deep-copy a subtree with fresh ids. */
  private cloneTree(src: Record<string, Obj>, rootId: string): Obj[] {
    const out: Obj[] = [];
    const walk = (id: string, parent: string | null): string => {
      const s = src[id], c: Obj = structuredClone(s);
      c.id = uid(); c.parent = parent; c.children = [];
      out.push(c);
      c.children = s.children.filter((k) => src[k]).map((k) => walk(k, c.id));
      if (c.kind === 'wall' && c.props.openings) c.props.openings.forEach((op: any) => { const i = s.children.indexOf(op.id); if (i >= 0) op.id = c.children[i]; });
      return c.id;
    };
    walk(rootId, null);
    return out;
  }

  private instantiate(src: Record<string, Obj>, rootId: string, parent: string | null, offset: Vec3 = [0, 0, 0]): Obj {
    const objs = this.cloneTree(src, rootId), root = objs[0];
    root.pos = [root.pos[0] + offset[0], root.pos[1] + offset[1], root.pos[2] + offset[2]];
    for (const o of objs) this.scene.objects[o.id] = o;
    root.parent = parent && this.obj(parent) ? parent : null;
    (root.parent ? this.obj(root.parent)!.children : this.scene.roots).push(root.id);
    this.viewport?.addNode(root.id);
    return root;
  }

  duplicate(ids: string[] = this.selection) {
    const top = this.topLevel(ids);
    if (!top.length) return;
    this.checkpoint();
    const made: string[] = [];
    for (const id of top) {
      const o = this.obj(id)!, par = this.obj(o.parent);
      const inWall = par?.kind === 'wall' && (o.kind === 'door' || o.kind === 'window');
      const c = this.instantiate(this.scene.objects, id, o.parent, inWall ? [o.props.width + 0.3, 0, 0] : [this.opts.snap ? this.opts.grid * 2 : 1, 0, 0]);
      c.name = o.name.replace(/ copy( \d+)?$/, '') + ' copy';
      if (inWall) {
        const op = par!.props.openings.find((q: any) => q.id === id);
        if (op) { par!.props.openings.push({ ...op, id: c.id, offset: op.offset + o.props.width + 0.3 }); this.viewport?.rebuildNode(par!.id); }
      }
      this.viewport?.syncTransform(c.id);
      made.push(c.id);
    }
    this.select(made);
    this.touch();
  }

  copy() {
    const roots = this.topLevel(this.selection);
    if (!roots.length) return;
    const objects: Record<string, Obj> = {};
    const walk = (id: string) => { objects[id] = structuredClone(this.obj(id)!); objects[id].children.forEach(walk); };
    roots.forEach(walk);
    this.clipboard = { objects, roots };
    this.toast(`Copied ${roots.length} object${roots.length > 1 ? 's' : ''}`);
  }

  paste() {
    if (!this.clipboard) return;
    this.checkpoint();
    const made = this.clipboard.roots.map((r) => this.instantiate(this.clipboard!.objects, r, null, [1.5, 0, 1.5]).id);
    this.select(made);
    this.touch();
  }

  group(ids: string[] = this.selection) {
    const top = this.topLevel(ids);
    if (top.length < 1 || !this.viewport) return;
    this.checkpoint();
    const c = new THREE.Vector3();
    top.forEach((id) => c.add(this.viewport!.worldPos(id)));
    c.divideScalar(top.length);
    const g = this.spawn('group', 'Group', {}, [round(c.x), round(c.y), round(c.z)], null);
    top.forEach((id) => this.reparent(id, g.id, false));
    this.select([g.id]);
    this.touch();
  }

  ungroup(id = this.selection[0]) {
    const g = this.obj(id);
    if (!g || g.kind !== 'group') return;
    this.checkpoint();
    const kids = [...g.children];
    kids.forEach((k) => this.reparent(k, g.parent, false));
    this.removeRec(id);
    this.select(kids);
    this.touch();
  }

  /** Move an object under a new parent while keeping its world transform. */
  reparent(id: string, parent: string | null, record = true) {
    const o = this.obj(id);
    if (!o || id === parent || o.parent === parent) return;
    for (let p = parent; p; p = this.obj(p)?.parent ?? null) if (p === id) return; // no cycles
    if (record) this.checkpoint();
    const old = this.obj(o.parent);
    if (old) old.children = old.children.filter((c) => c !== id); else this.scene.roots = this.scene.roots.filter((c) => c !== id);
    o.parent = parent && this.obj(parent) ? parent : null;
    (o.parent ? this.obj(o.parent)!.children : this.scene.roots).push(id);
    this.viewport?.attach(id, o.parent);
    if (record) this.touch();
  }

  setField(id: string, key: 'name' | 'visible' | 'locked', value: any) {
    const o = this.obj(id);
    if (!o) return;
    this.checkpoint(`f:${id}:${key}`);
    (o as any)[key] = value;
    this.viewport?.syncTransform(id);
    this.touch();
  }

  setProps(id: string, patch: Record<string, any>) {
    const o = this.obj(id);
    if (!o) return;
    this.checkpoint(`p:${id}:${Object.keys(patch).join()}`);
    Object.assign(o.props, patch);
    const par = this.obj(o.parent);
    if (par?.kind === 'wall' && (o.kind === 'door' || o.kind === 'window')) this.syncOpening(o, par);
    this.viewport?.rebuildNode(id);
    this.touch();
  }

  setTransform(id: string, t: Partial<Pick<Obj, 'pos' | 'rot' | 'scale'>>) {
    const o = this.obj(id);
    if (!o) return;
    this.checkpoint(`t:${id}`);
    Object.assign(o, t);
    this.afterTransform(id);
    this.touch();
  }

  /** Called when a transform is final (inspector edit or gizmo release). */
  afterTransform(id: string) {
    const o = this.obj(id);
    if (!o) return;
    const par = this.obj(o.parent);
    if (par?.kind === 'wall' && (o.kind === 'door' || o.kind === 'window')) this.syncOpening(o, par);
    this.viewport?.syncTransform(id);
    const needs = (q: Obj): boolean => TERRAIN_KINDS.includes(q.kind) || q.children.some((c) => needs(this.obj(c)!));
    if (needs(o)) this.viewport?.rebuildKinds(TERRAIN_KINDS);
  }

  private syncOpening(o: Obj, wall: Obj) {
    const op = wall.props.openings?.find((q: any) => q.id === o.id);
    if (!op) return;
    const w = o.props.width;
    op.width = w; op.height = o.props.height;
    op.offset = THREE.MathUtils.clamp(o.pos[0] - w / 2, 0.05, Math.max(0.05, wall.props.length - w - 0.05));
    op.sill = THREE.MathUtils.clamp(o.pos[1], 0, Math.max(0, wall.props.height - op.height));
    o.pos = [op.offset + w / 2, op.sill, 0];
    o.rot = [0, 0, 0];
    this.viewport?.rebuildNode(wall.id);
  }

  insertOpening(wallId: string, kind: 'door' | 'window', worldPoint?: THREE.Vector3, props: Record<string, any> = {}): Obj | null {
    const wall = this.obj(wallId);
    if (!wall || wall.kind !== 'wall') return null;
    const p = { ...structuredClone(KIND_DEFAULTS[kind]), ...props };
    const w = Math.min(p.width, wall.props.length - 0.2), h = Math.min(p.height, wall.props.height - (kind === 'window' ? 0.3 : 0));
    if (w < 0.3) { this.toast('This wall is too short for an opening.', 'error'); return null; }
    p.width = w; p.height = h;
    let cx = wall.props.length / 2;
    if (worldPoint && this.viewport) cx = this.viewport.toLocal(wallId, worldPoint).x;
    const sill = kind === 'window' ? Math.min(0.9, wall.props.height - h) : 0;
    const offset = THREE.MathUtils.clamp(cx - w / 2, 0.05, wall.props.length - w - 0.05);
    this.checkpoint();
    const o = makeObj(kind, kind === 'door' ? 'Door' : 'Window', p, [offset + w / 2, sill, 0]);
    wall.props.openings = [...(wall.props.openings ?? []), { id: o.id, offset, width: w, sill, height: h }];
    this.add(o, wallId);
    this.viewport?.rebuildNode(wallId);
    this.select([o.id]);
    this.touch();
    return o;
  }

  select(ids: string[]) { this.selection = ids.filter((id) => this.obj(id)); this.viewport?.onSelection(); this.emit(); }
  toggleSelect(id: string) { this.select(this.selection.includes(id) ? this.selection.filter((s) => s !== id) : [...this.selection, id]); }

  /** Generic recorded mutation for events, cinematics, variables, player settings… */
  mutate(key: string, fn: (s: Scene) => void) { this.checkpoint(key); fn(this.scene); this.touch(); }

  setEnv(patch: Partial<Env>) { this.checkpoint('env'); Object.assign(this.scene.env, patch); this.viewport?.applyEnv(); this.touch(); }
  applyEnvPreset(name: string) { const e = this.project.envPresets[name] ?? ENV_PRESETS[name]; if (e) this.setEnv(structuredClone(e)); }

  // ------------------------------------------------------------ drag & drop

  dropAsset(d: DropPayload, clientX: number, clientY: number) {
    const vp = this.viewport;
    if (!vp) return;
    const hit = vp.pickPoint(clientX, clientY, true);
    const p = hit?.point ?? new THREE.Vector3();
    const pos = (dy = 0): Vec3 => [round(this.snapV(p.x)), round(p.y + dy), round(this.snapV(p.z))];
    const hitObj = this.obj(hit?.id);
    if (d.type === 'kind' && (d.key === 'door' || d.key === 'window')) {
      const wall = hitObj?.kind === 'wall' ? hitObj : this.obj(hitObj?.parent)?.kind === 'wall' ? this.obj(hitObj!.parent)! : null;
      if (wall) { this.insertOpening(wall.id, d.key, p, d.props); return; }
    }
    if (d.type === 'prefab') this.create('prefab', PREFAB_MAP[d.key]?.name ?? 'Object', { prefab: d.key }, pos(d.key === 'ceiling_light' ? 2.8 : 0));
    else if (d.type === 'kind') {
      const k = d.key as Kind;
      const lift = k === 'primitive' ? (d.props?.shape === 'plane' ? 0.02 : 0.5) : k === 'info' ? 1.5 : k === 'light' ? 2.6 : k === 'audio' ? 1.5 : k === 'water' ? 0.3 : 0;
      this.create(k, d.name ?? k[0].toUpperCase() + k.slice(1), d.props ?? {}, pos(lift));
    } else if (d.type === 'asset') {
      const a = this.scene.assets[d.key];
      if (!a) return;
      if (a.type === 'model') {
        const o = this.create('model', a.name, { asset: a.id, ground: true }, pos()), big = a.meta ? Math.max(...a.meta.size) : 1;
        if (big > 60 || (big > 0 && big < 0.05)) { const k = round(3 / big, 5); this.setTransform(o.id, { scale: [k, k, k] }); this.toast(`“${a.name}” is ${big > 60 ? 'very large' : 'very small'} (${big.toFixed(big < 1 ? 3 : 0)} m), so it was scaled to about 3 m. Adjust Scale in the Inspector.`); }
      }
      else if (a.type === 'audio') this.create('audio', a.name, { asset: a.id }, pos(1.5));
      else if (a.type === 'image') this.create('screen', a.name, { media: a.id }, pos(0.8));
      else this.create('screen', a.name, { media: a.id }, pos());
    } else if (d.type === 'userPrefab') {
      const up = this.project.prefabs.find((x) => x.id === d.key);
      if (!up) return;
      this.checkpoint();
      const root = this.instantiate(up.objects, up.root, null);
      root.pos = pos();
      this.viewport?.syncTransform(root.id);
      this.select([root.id]);
      this.touch();
    }
  }

  snapV(v: number) { return this.opts.snap ? Math.round(v / this.opts.grid) * this.opts.grid : v; }

  saveAsPrefab(name: string) {
    const id = this.selection[0];
    if (!id) return;
    const objects: Record<string, Obj> = {};
    const walk = (i: string) => { objects[i] = structuredClone(this.obj(i)!); objects[i].children.forEach(walk); };
    walk(id);
    objects[id].parent = null; objects[id].pos = [0, 0, 0];
    this.project.prefabs.push({ id: uid('u'), name, root: id, objects });
    this.touch();
    this.toast(`Saved prefab “${name}” to My prefabs`, 'ok');
  }

  // ------------------------------------------------------------ terrain

  private disposeTerrain() {
    this.viewport?.setTerrain(null);
    this.terrain?.dispose();
    this.terrain = null;
    this.scene.terrain = null;
  }

  private installTerrain(meta: TerrainMeta, data: TerrainData) {
    this.disposeTerrain();
    this.scene.terrain = meta;
    this.terrain = new TerrainSystem(this.core, meta, data);
    this.viewport?.setTerrain(this.terrain);
    this.terrainDirty = true;
    this.clearHistory();
  }

  /** Keep objects sitting on the ground when the terrain underneath them is created or replaced. */
  private groundOffsets(): Map<string, number> {
    const m = new Map<string, number>();
    for (const id of this.scene.roots) {
      const o = this.obj(id)!;
      if (!TERRAIN_KINDS.includes(o.kind)) m.set(id, o.pos[1] - (this.terrain?.heightAt(o.pos[0], o.pos[2]) ?? 0));
    }
    return m;
  }
  private reseat(offsets: Map<string, number>) {
    for (const [id, dy] of offsets) {
      const o = this.obj(id);
      if (!o || !this.terrain) continue;
      o.pos = [o.pos[0], round(this.terrain.heightAt(o.pos[0], o.pos[2]) + dy), o.pos[2]];
      this.viewport?.syncTransform(id);
    }
  }

  createTerrain(p: { size: number; cell: number; seed: number; amplitude: number; frequency: number; flat: boolean }) {
    const n = validSize(p.size);
    const meta: TerrainMeta = { w: n, h: n, cell: p.cell, exaggeration: 1, layers: structuredClone(DEFAULT_LAYERS), hasOriginal: false, viewDistance: Math.max(600, n * p.cell * 0.75) };
    const seats = this.groundOffsets();
    this.installTerrain(meta, {});
    if (!p.flat) {
      this.terrain!.generate(p.seed, p.amplitude, p.frequency);
      this.terrain!.autoPaint(34, p.amplitude * 0.42, p.amplitude * 0.012);
    }
    this.reseat(seats);
    this.viewport?.rebuildKinds(TERRAIN_KINDS);
    this.viewport?.frameAll();
    this.touch();
  }

  /** Install terrain from external data (heightmaps, geo import). Keeps a pristine copy for "restore original". */
  setTerrainData(meta: TerrainMeta, heights: Float32Array, keepOriginal = true) {
    const seats = this.groundOffsets();
    this.installTerrain(meta, { heights });
    if (keepOriginal) this.terrain!.snapshotOriginal();
    this.reseat(seats);
    const [mn, mx] = this.terrain!.minMax();
    this.terrain!.autoPaint(36, mn + (mx - mn) * 0.8, mn - 1);
    this.viewport?.rebuildKinds(TERRAIN_KINDS);
    this.viewport?.frameAll();
    this.touch();
  }

  removeTerrain() { this.disposeTerrain(); this.terrainDirty = true; this.clearHistory(); this.viewport?.rebuildKinds(TERRAIN_KINDS); this.touch(); }

  terrainChanged(full = true) {
    this.terrainDirty = true;
    if (full) { this.clearHistory(); this.viewport?.rebuildKinds(TERRAIN_KINDS); }
    this.touch();
  }

  beginStroke(x: number, z: number) {
    if (!this.terrain) return;
    this.stroke = { h: this.terrain.copyHeights(), s: this.terrain.copySplat(), rect: null, target: this.terrain.heightAt(x, z) };
  }

  strokeAt(x: number, z: number, dt: number, invert: boolean) {
    const t = this.terrain, st = this.stroke, b = this.opts.brush;
    if (!t || !st) return;
    let r: number[];
    if (this.tool === 'paint') r = t.paint(b.layer, x, z, b.radius, b.strength * 7 * dt);
    else {
      let mode = b.mode;
      if (invert && mode < 2) mode = 1 - mode;
      const amount = mode < 2 ? b.strength * b.radius * 0.7 * dt : b.strength * 9 * dt;
      r = t.brush(mode, x, z, b.radius, amount, st.target);
    }
    st.rect = st.rect ? [Math.min(st.rect[0], r[0]), Math.min(st.rect[1], r[1]), Math.max(st.rect[2], r[2]), Math.max(st.rect[3], r[3])] : r;
  }

  endStroke() {
    const t = this.terrain, st = this.stroke;
    this.stroke = null;
    if (!t || !st || !st.rect) return;
    const [i0, j0, i1, j1] = st.rect, w = i1 - i0 + 1, h = j1 - j0 + 1, W = t.meta.w;
    if (w <= 0 || h <= 0) return;
    const ah = t.copyHeights(), as = t.copySplat();
    const cut = (src: Float32Array | Uint8Array, k: number) => {
      const out = new (src.constructor as any)(w * h * k);
      for (let j = 0; j < h; j++) out.set(src.subarray(((j0 + j) * W + i0) * k, ((j0 + j) * W + i0 + w) * k), j * w * k);
      return out;
    };
    this.undoStack.push({ kind: 'terrain', rect: st.rect, bh: cut(st.h, 1), ah: cut(ah, 1), bs: cut(st.s, 8), as: cut(as, 8) });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this.terrainDirty = true;
    this.viewport?.rebuildKinds(TERRAIN_KINDS);
    this.touch();
  }

  private applyPatch(rect: number[], h: Float32Array, s: Uint8Array) {
    const t = this.terrain!, [i0, j0, i1, j1] = rect, w = i1 - i0 + 1, hh = j1 - j0 + 1, W = t.meta.w;
    const H = this.core.f32(this.core.ex.terrain_heights(t.ptr), W * t.meta.h), S = this.core.u8(this.core.ex.terrain_splat(t.ptr), W * t.meta.h * 8);
    for (let j = 0; j < hh; j++) {
      H.set(h.subarray(j * w, (j + 1) * w), (j0 + j) * W + i0);
      S.set(s.subarray(j * w * 8, (j + 1) * w * 8), ((j0 + j) * W + i0) * 8);
    }
    t.markDirtyRect(i0, j0, i1, j1);
    this.terrainDirty = true;
  }

  // ------------------------------------------------------------ assets

  /** Add one file to the project's assets straight away and return its id (used by templates that generate their own media). */
  addAsset(f: File, type: Asset['type']): string {
    const id = uid('a');
    this.scene.assets[id] = { id, name: f.name.replace(/\.[^.]+$/, ''), type, mime: f.type || 'application/octet-stream', size: f.size, file: f.name };
    this.blobs.set(id, f);
    this.blobDirty.add(id);
    return id;
  }

  /**
   * Import files into the project. Models may arrive as one file, as a multi-file selection
   * (model + textures/.bin/.mtl) or inside a zip; they are analysed and stored as GLB.
   */
  async importFiles(input: FileList | File[]) {
    const picked = Array.from(input); // copy now: file inputs are cleared right after the change event
    const imp = await import('./importer');
    let files: File[];
    try { files = await imp.expandArchives(picked); } catch { this.toast('That zip archive could not be read.', 'error'); return; }
    const models = files.filter((f) => imp.MODEL_EXT.includes(imp.ext(f.name)));
    const needsSiblings = models.some((f) => ['gltf', 'obj', 'fbx', 'dae'].includes(imp.ext(f.name)));
    let n = 0;
    for (const f of models) {
      this.toast(`Importing ${f.name}…`);
      await new Promise((r) => setTimeout(r, 30));
      try {
        const r = await imp.importModel(f, files.filter((x) => x !== f && imp.isResource(x.name)));
        const id = this.addAsset(new File([r.blob], r.fileName, { type: 'model/gltf-binary' }), 'model');
        this.scene.assets[id].meta = r.meta;
        const m = r.meta;
        this.toast(`${f.name}: ${m.tris.toLocaleString()} triangles, ${m.textures} texture(s)${m.animations ? `, ${m.animations} animation(s)` : ''}${r.notes.length ? ` – ${r.notes.join(', ')}` : ''}.`, 'ok');
        if (m.tris > 150000 || m.maxTexture > 2048) this.toast(`${f.name} is heavy for the web. Select it in the world and use Optimise in the Inspector.`);
        n++;
      } catch (e: any) {
        console.warn(e);
        this.toast(`${f.name} could not be imported: ${e?.message ?? e}`, 'error');
      }
    }
    for (const f of files) {
      const x = imp.ext(f.name);
      if (imp.MODEL_EXT.includes(x) || (needsSiblings && imp.isResource(f.name))) continue;
      const type: Asset['type'] | null = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(x) ? 'image' : ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(x) ? 'audio' : ['mp4', 'webm'].includes(x) ? 'video' : null;
      if (!type) { if (!imp.isResource(f.name)) this.toast(`${f.name}: unsupported file type. Models: GLB, GLTF, OBJ, FBX, STL, PLY, DAE (or a zip of them). Media: PNG/JPG/WebP/GIF, MP3/WAV/OGG, MP4/WebM.`, 'error'); continue; }
      const mime = f.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm' } as Record<string, string>)[x] || '';
      this.addAsset(new File([f], f.name, { type: mime }), type);
      n++;
    }
    if (n) { this.touch(); if (n > models.length) this.toast(`Imported ${n} file${n > 1 ? 's' : ''}`, 'ok'); }
  }

  /** Swap the stored file of an asset (used by the optimiser) and rebuild everything that shows it. */
  replaceAsset(id: string, blob: Blob, patch: Partial<Asset>) {
    const a = this.scene.assets[id];
    if (!a) return;
    Object.assign(a, patch, { size: blob.size });
    this.blobs.set(id, blob);
    this.blobDirty.add(id);
    const u = this.urls.get(id);
    if (u) { URL.revokeObjectURL(u); this.urls.delete(id); }
    clearAssetCaches();
    this.viewport?.rebuildKinds(['model']);
    this.touch();
  }

  /** Shrink a model: cap texture size and reduce triangles. Returns a before/after summary. */
  async optimiseAsset(id: string, o: { maxTexture: number; detail: number }) {
    const a = this.scene.assets[id], blob = this.blobs.get(id);
    if (!a || !blob) throw new Error('The model file is missing.');
    const imp = await import('./importer');
    const l = await imp.loadModel(new File([blob], (a.file ?? 'model.glb').replace(/\.[^.]+$/, '') + '.glb'));
    const before = a.meta ?? imp.analyse(l, false), sizeBefore = a.size;
    const notes = await imp.optimise(l, o);
    const out = await imp.toGLB(l);
    const meta = imp.analyse(await imp.loadModel(new File([out], 'model.glb')));
    this.replaceAsset(id, out, { meta, mime: 'model/gltf-binary', file: (a.file ?? a.name).replace(/\.[^.]+$/, '') + '.glb' });
    return { before, after: meta, sizeBefore, sizeAfter: out.size, notes };
  }

  removeAsset(id: string) {
    delete this.scene.assets[id];
    this.blobs.delete(id);
    const u = this.urls.get(id);
    if (u) { URL.revokeObjectURL(u); this.urls.delete(id); }
    this.touch();
  }

  assetUsage(id: string) {
    return Object.values(this.scene.objects).filter((o) => Object.values(o.props).includes(id)).length;
  }

  // ------------------------------------------------------------ persistence

  private terrainBlobs(): Map<string, Blob> {
    const m = new Map<string, Blob>();
    if (this.terrain) {
      m.set('terrain/heights', new Blob([this.terrain.copyHeights()]));
      m.set('terrain/splat', new Blob([this.terrain.copySplat()]));
      const o = this.terrain.copyOriginal();
      if (o) m.set('terrain/original', new Blob([o]));
    }
    return m;
  }

  /** Every binary the project needs (user assets + terrain data). */
  allBlobs(includeOriginal = true): Map<string, Blob> {
    const m = new Map(this.blobs);
    for (const [k, b] of this.terrainBlobs()) if (includeOriginal || k !== 'terrain/original') m.set(k, b);
    return m;
  }

  async save(versionLabel?: string) {
    this.saving = true;
    this.emit();
    try {
      const write = new Map<string, Blob>();
      for (const id of this.blobDirty) { const b = this.blobs.get(id); if (b) write.set(id, b); }
      const keep = new Set(this.blobs.keys());
      if (this.terrain) ['terrain/heights', 'terrain/splat', 'terrain/original'].forEach((k) => keep.add(k));
      if (this.terrainDirty) for (const [k, b] of this.terrainBlobs()) write.set(k, b);
      const thumb = this.viewport?.thumbnail();
      if (thumb) this.project.thumbnail = thumb;
      // Flags are cleared before the asynchronous write: anything changed while it runs is marked dirty again and kept for the next save.
      const hadTerrain = this.terrainDirty;
      this.blobDirty.clear();
      this.terrainDirty = false;
      this.dirty = false;
      try {
        await store.putProject(this.project, write, keep);
      } catch (e) {
        for (const id of write.keys()) if (!id.startsWith('terrain/')) this.blobDirty.add(id);
        this.terrainDirty ||= hadTerrain;
        this.dirty = true;
        throw e;
      }
      if (versionLabel) await store.addVersion(this.project, versionLabel);
      await store.setMeta('last', this.project.id);
      this.savedAt = Date.now();
    } catch (e: any) {
      this.toast(`Saving failed: ${e?.message ?? e}. Export the project to keep a copy.`, 'error');
      throw e;
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  async load(project: Project, blobs: Map<string, Blob>) {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls.clear();
    clearAssetCaches();
    this.disposeTerrain();
    this.project = project;
    this.blobs = new Map([...blobs].filter(([k]) => !k.startsWith('terrain/')));
    this.selection = [];
    this.clearHistory();
    const meta = project.scene.terrain;
    if (meta) {
      const get = async (k: string) => (blobs.get(k) ? await blobs.get(k)!.arrayBuffer() : null);
      const [h, s, o] = await Promise.all([get('terrain/heights'), get('terrain/splat'), get('terrain/original')]);
      try {
        this.terrain = new TerrainSystem(this.core, meta, { heights: h ? new Float32Array(h) : undefined, splat: s ? new Uint8Array(s) : undefined, original: o ? new Float32Array(o) : null });
      } catch (e: any) {
        this.toast(`Terrain data could not be loaded: ${e?.message ?? e}`, 'error');
        project.scene.terrain = null;
      }
    }
    this.blobDirty = new Set(this.blobs.keys());
    this.terrainDirty = !!this.terrain;
    this.dirty = false;
    this.viewport?.reset();
    this.emit();
  }

  async open(id: string) {
    const r = await store.getProject(id);
    if (!r) { this.toast('That project no longer exists in this browser.', 'error'); return false; }
    await this.load(r.project, r.blobs);
    this.blobDirty.clear();
    this.terrainDirty = false;
    await store.setMeta('last', id);
    return true;
  }

  async exportProject() {
    const blob = await store.packProject(this.project, this.allBlobs());
    store.download(blob, `${this.project.name.replace(/[^\w-]+/g, '_') || 'world'}.wander.zip`);
  }

  async importProject(file: Blob) {
    const r = await store.unpackProject(file);
    r.project.id = uid('p');
    r.project.modified = Date.now();
    await this.load(r.project, r.blobs);
    await this.save();
    this.toast(`Imported “${r.project.name}”`, 'ok');
  }

  async restoreVersion(key: string) {
    const v = await store.getVersion(key);
    if (!v) return;
    const cur = this.scene.terrain;
    const same = !!cur === !!v.scene.terrain && (!cur || (cur.w === v.scene.terrain!.w && cur.h === v.scene.terrain!.h));
    if (!same) { v.scene.terrain = cur; this.toast('Terrain size changed since that version – objects were restored, the current terrain was kept.'); }
    v.scene.assets = { ...v.scene.assets, ...this.scene.assets };
    const blobs = this.allBlobs();
    v.id = this.project.id;
    await this.load(v, blobs);
    this.touch();
  }

  playData() {
    return { project: structuredClone(this.project), terrain: this.terrain ? { heights: this.terrain.copyHeights(), splat: this.terrain.copySplat() } : undefined };
  }
}
