// Occlusion culling front end. The visibility tests run in the Rust/WASM core
// (crates/wander-core/src/occlusion.rs); this class feeds it occluders and targets
// and applies the answers to the scene, a slice of the world per frame.
import * as THREE from 'three';
import type { Core } from './wasm';

interface Target { meshes: THREE.Object3D[]; hits: number; hidden: boolean }
const STRIDE = 7, BATCH = 250;

export class OcclusionCuller {
  private ptr: number;
  private targets: Target[] = [];
  private data: number[] = [];
  private buf = 0;
  private out = 0;
  private cursor = 0;
  private last = new THREE.Vector3(Infinity, 0, 0);
  private ahead = new THREE.Vector3();
  occluders = 0;
  hidden = 0;

  constructor(private core: Core, private terrainPtr: number) {
    this.ptr = core.ex.occ_new();
  }

  get count() { return this.targets.length; }

  /** A solid box that blocks the view: centre, half-size and the direction of its local x axis (ax, az). */
  addOccluder(owner: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, ax: number, az: number) {
    this.core.ex.occ_add(this.ptr, owner, cx, cy, cz, hx, hy, hz, ax, az);
    this.occluders++;
  }

  clearOccluders() { this.core.ex.occ_clear(this.ptr); this.occluders = 0; }

  /** Something that may be hidden. `meshes` are switched off together when nothing of `box` can be seen. */
  addTarget(owner: number, box: THREE.Box3, meshes: THREE.Object3D[]) {
    if (box.isEmpty() || !meshes.length) return;
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    if (Math.max(s.x, s.y, s.z) > 150) return;
    this.data.push(c.x, c.y, c.z, Math.max(s.x / 2, 0.05), Math.max(s.y / 2, 0.05), Math.max(s.z / 2, 0.05), owner);
    this.targets.push({ meshes, hits: 0, hidden: false });
  }

  /** Call once after all targets were added. */
  commit() {
    const n = this.targets.length;
    if (!n) return;
    this.buf = this.core.put(new Float32Array(this.data));
    this.out = this.core.alloc(n);
    this.data = [];
  }

  private apply(t: Target, hide: boolean) {
    if (t.hidden === hide) return;
    t.hidden = hide;
    this.hidden += hide ? 1 : -1;
    for (const m of t.meshes) { m.userData.occluded = hide; m.visible = !hide; }
  }

  /** Test the next slice of targets (everything, after the camera jumped). */
  update(eye: THREE.Vector3, dt: number) {
    const n = this.targets.length;
    if (!n || !this.buf) return;
    const moved = eye.distanceTo(this.last), jumped = moved > 2.5;
    // Look ahead along the direction of travel so objects are revealed before they pop into view.
    this.ahead.copy(eye);
    if (!jumped && moved > 1e-4 && dt > 0) this.ahead.addScaledVector(this.last.clone().sub(eye).negate().normalize(), Math.min((moved / dt) * 0.35, 2.5));
    this.last.copy(eye);
    let left = jumped ? n : Math.min(n, BATCH);
    while (left > 0) {
      const count = Math.min(left, n - this.cursor);
      this.core.ex.occ_test(this.ptr, this.terrainPtr, eye.x, eye.y, eye.z, this.ahead.x, this.ahead.y, this.ahead.z, this.buf + this.cursor * STRIDE * 4, count, this.out);
      const res = this.core.u8(this.out, count);
      for (let i = 0; i < count; i++) {
        const t = this.targets[this.cursor + i];
        if (!res[i]) { t.hits = 0; this.apply(t, false); }
        else if (++t.hits >= 2 || jumped) this.apply(t, true); // two agreeing tests before hiding avoids flicker at edges
      }
      this.cursor = (this.cursor + count) % n;
      left -= count;
    }
  }

  dispose() {
    for (const t of this.targets) this.apply(t, false);
    if (this.buf) this.core.free(this.buf, this.targets.length * STRIDE * 4);
    if (this.out) this.core.free(this.out, this.targets.length);
    this.core.ex.occ_free(this.ptr);
    this.targets = [];
    this.buf = this.out = this.ptr = 0;
  }
}
