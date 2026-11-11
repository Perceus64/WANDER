// Chunked, streamed terrain. Height/material data lives inside the WASM core;
// this class turns it into LOD chunk meshes around the camera.
import * as THREE from 'three';
import type { Core } from './wasm';
import type { TerrainMeta } from './types';

export const CHUNK = 32; // cells per chunk side
const LAYERS = 8;

interface ChunkRec { ci: number; cj: number; mesh: THREE.Mesh | null; lod: number; dirty: boolean; cx: number; cz: number }
export interface TerrainData { heights?: Float32Array; splat?: Uint8Array; original?: Float32Array | null }

/** Round a sample count to the nearest valid terrain size (k*32+1). */
export const validSize = (n: number) => Math.max(1, Math.round((n - 1) / CHUNK)) * CHUNK + 1;

export class TerrainSystem {
  group = new THREE.Group();
  ptr: number;
  chunks: ChunkRec[] = [];
  material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  stats = { active: 0, total: 0, triangles: 0 };
  private palPtr: number;
  readonly nx: number;
  readonly nz: number;

  constructor(public core: Core, public meta: TerrainMeta, data: TerrainData = {}) {
    const { w, h, cell } = meta;
    if ((w - 1) % CHUNK || (h - 1) % CHUNK) throw new Error(`Terrain size must be a multiple of ${CHUNK} cells plus one`);
    this.ptr = core.ex.terrain_new(w, h, cell);
    if (data.heights && data.heights.length === w * h) core.f32(core.ex.terrain_heights(this.ptr), w * h).set(data.heights);
    if (data.splat && data.splat.length === w * h * LAYERS) core.u8(core.ex.terrain_splat(this.ptr), w * h * LAYERS).set(data.splat);
    if (data.original && data.original.length === w * h) {
      core.f32(core.ex.terrain_alloc_original(this.ptr), w * h).set(data.original);
      meta.hasOriginal = true;
    }
    core.ex.terrain_set_exag(this.ptr, meta.exaggeration);
    this.palPtr = core.alloc(LAYERS * 3 * 4);
    this.setPalette();
    this.nx = (w - 1) / CHUNK;
    this.nz = (h - 1) / CHUNK;
    const cw = CHUNK * cell;
    for (let cj = 0; cj < this.nz; cj++)
      for (let ci = 0; ci < this.nx; ci++)
        this.chunks.push({ ci, cj, mesh: null, lod: 0, dirty: false, cx: (ci + 0.5) * cw - this.width / 2, cz: (cj + 0.5) * cw - this.depth / 2 });
    this.stats.total = this.chunks.length;
    this.group.name = 'terrain';
  }

  get width() { return (this.meta.w - 1) * this.meta.cell; }
  get depth() { return (this.meta.h - 1) * this.meta.cell; }

  setPalette() {
    const pal = this.core.f32(this.palPtr, LAYERS * 3);
    const c = new THREE.Color();
    this.meta.layers.forEach((l, i) => {
      c.set(l.color);
      pal.set([c.r, c.g, c.b], i * 3);
    });
    this.markAllDirty();
  }

  setExaggeration(e: number) {
    this.meta.exaggeration = e;
    this.core.ex.terrain_set_exag(this.ptr, e);
    this.markAllDirty();
  }

  copyHeights() { return this.core.f32(this.core.ex.terrain_heights(this.ptr), this.meta.w * this.meta.h).slice(); }
  copySplat() { return this.core.u8(this.core.ex.terrain_splat(this.ptr), this.meta.w * this.meta.h * LAYERS).slice(); }
  copyOriginal() {
    const p = this.core.ex.terrain_original(this.ptr);
    return p ? this.core.f32(p, this.meta.w * this.meta.h).slice() : null;
  }
  setHeights(h: Float32Array) { this.core.f32(this.core.ex.terrain_heights(this.ptr), h.length).set(h); this.markAllDirty(); }
  setSplat(s: Uint8Array) { this.core.u8(this.core.ex.terrain_splat(this.ptr), s.length).set(s); this.markAllDirty(); }
  snapshotOriginal() { this.core.ex.terrain_snapshot_original(this.ptr); this.meta.hasOriginal = true; }
  restoreOriginal() { const ok = !!this.core.ex.terrain_restore_original(this.ptr); if (ok) this.markAllDirty(); return ok; }
  generate(seed: number, amplitude: number, frequency: number, octaves = 6) { this.core.ex.terrain_generate(this.ptr, seed >>> 0, amplitude, frequency, octaves); this.markAllDirty(); }
  autoPaint(rockSlope: number, snowH: number, sandH: number) { this.core.ex.terrain_auto_paint(this.ptr, rockSlope, snowH, sandH); this.markAllDirty(); }
  minMax(): [number, number] { return [this.core.ex.terrain_min(this.ptr), this.core.ex.terrain_max(this.ptr)]; }

  heightAt(x: number, z: number): number { return this.core.ex.terrain_height_at(this.ptr, x, z); }
  inside(x: number, z: number) { return Math.abs(x) <= this.width / 2 && Math.abs(z) <= this.depth / 2; }

  raycast(ray: THREE.Ray, maxDist = 20000): THREE.Vector3 | null {
    const { origin: o, direction: d } = ray;
    const t = this.core.ex.terrain_raycast(this.ptr, o.x, o.y, o.z, d.x, d.y, d.z, maxDist);
    return t >= 0 ? ray.at(t, new THREE.Vector3()) : null;
  }

  /** mode: 0 raise, 1 lower, 2 smooth, 3 flatten */
  brush(mode: number, x: number, z: number, radius: number, strength: number, target = 0) {
    this.core.ex.terrain_brush(this.ptr, mode, x, z, radius, strength, target);
    return this.dirtyFromCore();
  }
  paint(layer: number, x: number, z: number, radius: number, strength: number) {
    this.core.ex.terrain_paint(this.ptr, layer, x, z, radius, strength);
    return this.dirtyFromCore();
  }
  private dirtyFromCore(): [number, number, number, number] {
    const r: [number, number, number, number] = [0, 1, 2, 3].map((k) => this.core.ex.terrain_dirty(this.ptr, k)) as any;
    this.markDirtyRect(...r);
    return r;
  }
  markDirtyRect(i0: number, j0: number, i1: number, j1: number) {
    const a0 = Math.max(0, Math.floor((i0 - 2) / CHUNK)), a1 = Math.min(this.nx - 1, Math.floor((i1 + 2) / CHUNK));
    const b0 = Math.max(0, Math.floor((j0 - 2) / CHUNK)), b1 = Math.min(this.nz - 1, Math.floor((j1 + 2) / CHUNK));
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) this.chunks[b * this.nx + a].dirty = true;
  }
  markAllDirty() { for (const c of this.chunks) c.dirty = true; }

  /** Stream chunks around the camera: build/re-LOD the nearest few per frame, unload the far ones. */
  update(cam: THREE.Vector3, budget = 3) {
    const cw = CHUNK * this.meta.cell;
    const view = this.meta.viewDistance;
    const todo: { c: ChunkRec; d: number; lod: number }[] = [];
    let active = 0;
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - cam.x, c.cz - cam.z);
      if (d > view * 1.25 + cw) {
        if (c.mesh) this.drop(c);
        continue;
      }
      if (d > view + cw && !c.mesh) continue;
      const r = d / cw;
      const lod = r < 2.5 ? 1 : r < 5 ? 2 : r < 10 ? 4 : 8;
      if (c.mesh) active++;
      if (!c.mesh || c.dirty || c.lod !== lod) todo.push({ c, d: c.dirty && c.mesh ? d * 0.1 : d, lod });
    }
    if (todo.length) {
      todo.sort((a, b) => a.d - b.d);
      const n = Math.min(todo.length, budget);
      for (let k = 0; k < n; k++) {
        if (!todo[k].c.mesh) active++;
        this.build(todo[k].c, todo[k].lod);
      }
    }
    this.stats.active = active;
    return todo.length;
  }

  private build(c: ChunkRec, lod: number) {
    const { core, ptr } = this;
    core.ex.terrain_chunk(ptr, c.ci * CHUNK, c.cj * CHUNK, CHUNK, CHUNK, lod, this.palPtr);
    const vc = core.ex.terrain_mesh_vcount(ptr), ic = core.ex.terrain_mesh_icount(ptr);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(core.f32(core.ex.terrain_mesh_pos(ptr), vc * 3).slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(core.f32(core.ex.terrain_mesh_nor(ptr), vc * 3).slice(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(core.f32(core.ex.terrain_mesh_col(ptr), vc * 3).slice(), 3));
    g.setIndex(new THREE.BufferAttribute(core.u32(core.ex.terrain_mesh_idx(ptr), ic).slice(), 1));
    g.computeBoundingSphere();
    if (c.mesh) {
      this.stats.triangles -= c.mesh.geometry.index!.count / 3;
      c.mesh.geometry.dispose();
      c.mesh.geometry = g;
    } else {
      c.mesh = new THREE.Mesh(g, this.material);
      c.mesh.receiveShadow = true;
      c.mesh.userData.terrain = true;
      this.group.add(c.mesh);
    }
    this.stats.triangles += ic / 3;
    c.lod = lod;
    c.dirty = false;
  }

  private drop(c: ChunkRec) {
    if (!c.mesh) return;
    this.stats.triangles -= c.mesh.geometry.index!.count / 3;
    this.group.remove(c.mesh);
    c.mesh.geometry.dispose();
    c.mesh = null;
    c.lod = 0;
  }

  dispose() {
    for (const c of this.chunks) this.drop(c);
    this.material.dispose();
    this.core.free(this.palPtr, LAYERS * 3 * 4);
    this.core.ex.terrain_free(this.ptr);
    this.ptr = 0;
  }
}
