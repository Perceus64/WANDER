// Mesh editor: pick vertices, edges or faces of an editable mesh and move, rotate, scale,
// extrude, inset, subdivide, delete, flip, merge or paint them. Lives inside the viewport and
// reuses its transform gizmo.
import * as THREE from 'three';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import * as MD from '../engine/meshdata';
import type { MeshData } from '../engine/meshdata';
import type { Editor } from './editor';

export type ElementMode = 'vertex' | 'edge' | 'face';
interface Host { scene: THREE.Scene; camera: THREE.PerspectiveCamera; gizmo: TransformControls; nodes: Map<string, THREE.Group>; renderer: THREE.WebGLRenderer; rebuildNode(id: string): void }

const ORANGE = 0xffa726;

export class MeshEdit {
  id: string | null = null;
  mode: ElementMode = 'face';
  gizmoMode: 'translate' | 'rotate' | 'scale' = 'translate';
  /** Selected elements: vertex index, face index, or "a_b" for an edge. */
  sel = new Set<string>();
  private overlay = new THREE.Group();
  private pivot = new THREE.Object3D();
  private drag: { idx: number[]; start: THREE.Vector3[]; inv: THREE.Matrix4; mesh: MeshData } | null = null;
  private ray = new THREE.Raycaster();

  constructor(private ed: Editor, private vp: Host) {
    this.overlay.renderOrder = 997;
    vp.scene.add(this.overlay, this.pivot);
  }

  get mesh(): MeshData | null { const o = this.ed.obj(this.id); return o?.kind === 'mesh' ? (o.props as MeshData) : null; }
  private get node() { return this.id ? this.vp.nodes.get(this.id) : undefined; }
  private renderMesh() { return this.node?.children.find((c: any) => c.isMesh && c.geometry?.userData.triFace) as THREE.Mesh | undefined; }

  enter(id: string) { this.id = id; this.mode = 'face'; this.sel.clear(); this.refresh(); }
  exit() { this.id = null; this.sel.clear(); this.drag = null; this.clearOverlay(); if (this.vp.gizmo.object === this.pivot) this.vp.gizmo.detach(); }
  setMode(m: ElementMode) { this.mode = m; this.sel.clear(); this.refresh(); this.ed.emit(); }
  setGizmo(m: 'translate' | 'rotate' | 'scale') { this.gizmoMode = m; this.refresh(); this.ed.emit(); }

  // ------------------------------------------------------------ selection

  selectedFaces(): number[] { return this.mode === 'face' ? [...this.sel].map(Number).filter((f) => f < (this.mesh?.faces.length ?? 0)) : []; }

  selectedVerts(): number[] {
    const m = this.mesh;
    if (!m) return [];
    if (this.mode === 'vertex') return [...this.sel].map(Number).filter((v) => v < m.verts.length / 3);
    if (this.mode === 'face') return MD.vertsOfFaces(m, this.selectedFaces());
    const s = new Set<number>();
    for (const k of this.sel) k.split('_').forEach((v) => s.add(+v));
    return [...s];
  }

  selectAll() {
    const m = this.mesh;
    if (!m) return;
    this.sel = new Set(this.mode === 'face' ? m.faces.map((_, i) => String(i)) : this.mode === 'vertex' ? Array.from({ length: m.verts.length / 3 }, (_, i) => String(i)) : MD.edgesOf(m).map(([a, b]) => MD.edgeKey(a, b)));
    this.refresh(); this.ed.emit();
  }

  /** Grow the face selection to the whole flat area each selected face lies in. */
  growFlat() {
    const m = this.mesh;
    if (!m || this.mode !== 'face') return;
    for (const f of this.selectedFaces()) for (const g of MD.coplanarIsland(m, f)) this.sel.add(String(g));
    this.refresh(); this.ed.emit();
  }

  /** Pick the element under the pointer. Shift adds to / removes from the selection. */
  click(e: { clientX: number; clientY: number; shiftKey: boolean }) {
    const m = this.mesh, node = this.node;
    if (!m || !node) return;
    const rect = this.vp.renderer.domElement.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let hit: string | null = null;
    if (this.mode === 'face') {
      const rm = this.renderMesh();
      this.ray.setFromCamera(new THREE.Vector2((mx / rect.width) * 2 - 1, -(my / rect.height) * 2 + 1), this.vp.camera);
      const h = rm ? this.ray.intersectObject(rm, false)[0] : undefined;
      if (h?.faceIndex != null) hit = String((rm!.geometry.userData.triFace as Uint32Array)[h.faceIndex]);
    } else {
      node.updateWorldMatrix(true, false);
      const scr = (i: number) => { const p = new THREE.Vector3(m.verts[i * 3], m.verts[i * 3 + 1], m.verts[i * 3 + 2]).applyMatrix4(node.matrixWorld).project(this.vp.camera); return { x: (p.x * 0.5 + 0.5) * rect.width, y: (-p.y * 0.5 + 0.5) * rect.height, z: p.z }; };
      let best = this.mode === 'vertex' ? 13 : 10;
      if (this.mode === 'vertex') {
        for (let i = 0; i < m.verts.length / 3; i++) { const s = scr(i); if (s.z > 1 || s.z < -1) continue; const d = Math.hypot(s.x - mx, s.y - my) + s.z * 2; if (d < best) { best = d; hit = String(i); } }
      } else {
        for (const [a, b] of MD.edgesOf(m)) {
          const p = scr(a), q = scr(b);
          if (p.z > 1 || q.z > 1 || p.z < -1 || q.z < -1) continue;
          const dx = q.x - p.x, dy = q.y - p.y, t = THREE.MathUtils.clamp(((mx - p.x) * dx + (my - p.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
          const d = Math.hypot(p.x + dx * t - mx, p.y + dy * t - my) + (p.z + q.z);
          if (d < best) { best = d; hit = MD.edgeKey(a, b); }
        }
      }
    }
    if (!hit) { if (!e.shiftKey) this.sel.clear(); }
    else if (e.shiftKey) { if (!this.sel.delete(hit)) this.sel.add(hit); }
    else this.sel = new Set([hit]);
    this.refresh(); this.ed.emit();
  }

  // ------------------------------------------------------------ overlay and gizmo

  private clearOverlay() {
    for (const c of [...this.overlay.children] as any[]) { c.geometry?.dispose(); c.material?.dispose(); }
    this.overlay.clear();
  }

  /** Redraw the wireframe, handles and selection highlight, and place the gizmo on the selection. */
  refresh() {
    this.clearOverlay();
    const m = this.mesh, node = this.node;
    if (!m || !node) { if (this.vp.gizmo.object === this.pivot) this.vp.gizmo.detach(); return; }
    node.updateWorldMatrix(true, false);
    const W = node.matrixWorld, pt = (i: number) => new THREE.Vector3(m.verts[i * 3], m.verts[i * 3 + 1], m.verts[i * 3 + 2]).applyMatrix4(W);
    const lines = (pairs: [number, number][], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry().setFromPoints(pairs.flatMap(([a, b]) => [pt(a), pt(b)]));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, fog: false }));
      l.renderOrder = 997; l.frustumCulled = false;
      this.overlay.add(l);
    };
    const points = (idx: number[], color: number, size: number) => {
      const p = new THREE.Points(new THREE.BufferGeometry().setFromPoints(idx.map(pt)), new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, fog: false }));
      p.renderOrder = 998; p.frustumCulled = false;
      this.overlay.add(p);
    };
    lines(MD.edgesOf(m), 0xffffff, 0.42);
    if (this.mode === 'vertex') points(Array.from({ length: m.verts.length / 3 }, (_, i) => i), 0x9fd0ff, 6);
    const verts = this.selectedVerts();
    if (this.mode === 'face' && this.sel.size) {
      const pos: THREE.Vector3[] = [];
      for (const f of this.selectedFaces()) { const face = m.faces[f]; for (let k = 1; k < face.length - 1; k++) pos.push(pt(face[0]), pt(face[k]), pt(face[k + 1])); }
      const hl = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(pos), new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.45, depthTest: false, side: THREE.DoubleSide, fog: false }));
      hl.renderOrder = 996; hl.frustumCulled = false;
      this.overlay.add(hl);
    } else if (this.mode === 'edge' && this.sel.size) lines([...this.sel].map((k) => k.split('_').map(Number) as [number, number]), ORANGE, 1);
    if (this.mode !== 'face' && verts.length) points(verts, ORANGE, 10);
    if (this.drag) return; // keep the gizmo where the user is dragging it
    if (!verts.length) { if (this.vp.gizmo.object === this.pivot) this.vp.gizmo.detach(); return; }
    const c = new THREE.Vector3();
    verts.forEach((v) => c.add(pt(v)));
    this.pivot.position.copy(c.multiplyScalar(1 / verts.length));
    node.getWorldQuaternion(this.pivot.quaternion);
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
    this.vp.gizmo.setMode(this.gizmoMode);
    this.vp.gizmo.attach(this.pivot);
  }

  /** Called by the viewport when the gizmo is grabbed or released. Holding Shift while grabbing extrudes first. */
  gizmoDrag(dragging: boolean, shift: boolean) {
    const o = this.ed.obj(this.id), node = this.node;
    if (!o || !node) return;
    if (dragging) {
      this.ed.checkpoint();
      if (shift && this.mode === 'face' && this.selectedFaces().length) Object.assign(o.props, MD.extrude(this.mesh!, this.selectedFaces(), 0));
      const m = this.mesh!, idx = this.selectedVerts();
      node.updateWorldMatrix(true, false);
      this.pivot.updateMatrixWorld(true);
      this.drag = { idx, start: idx.map((i) => new THREE.Vector3(m.verts[i * 3], m.verts[i * 3 + 1], m.verts[i * 3 + 2]).applyMatrix4(node.matrixWorld)), inv: this.pivot.matrixWorld.clone().invert(), mesh: m };
    } else if (this.drag) {
      this.drag = null;
      this.vp.rebuildNode(this.id!); // proper rebuild: colliders and bounds follow the new shape
      this.refresh();
      this.ed.touch();
    }
  }

  gizmoChange() {
    const d = this.drag, node = this.node, rm = this.renderMesh();
    if (!d || !node || !rm) return;
    this.pivot.updateMatrixWorld(true);
    const M = this.pivot.matrixWorld.clone().multiply(d.inv), toLocal = node.matrixWorld.clone().invert();
    MD.setVerts(d.mesh, d.idx, d.start.map((p) => p.clone().applyMatrix4(M).applyMatrix4(toLocal)));
    const old = rm.geometry;
    rm.geometry = MD.buildGeometry(d.mesh);
    old.dispose();
    this.refresh();
  }

  // ------------------------------------------------------------ operations

  private apply(next: MeshData, sel?: Iterable<string>) {
    const o = this.ed.obj(this.id);
    if (!o) return;
    this.ed.checkpoint();
    Object.assign(o.props, next);
    if (sel) this.sel = new Set(sel);
    this.vp.rebuildNode(o.id);
    this.refresh();
    this.ed.touch();
  }
  private needFaces(): number[] | null {
    const f = this.selectedFaces();
    if (!f.length) { this.ed.toast('Switch to Face mode and select one or more faces first.'); return null; }
    return f;
  }

  extrude(dist: number) { const f = this.needFaces(); if (f) this.apply(MD.extrude(this.mesh!, f, dist)); }
  inset(amount: number) { const f = this.needFaces(); if (f) this.apply(MD.inset(this.mesh!, f, THREE.MathUtils.clamp(amount, 0.02, 0.95))); }
  subdivide() { const f = this.needFaces(); if (f) { const r = MD.subdivide(this.mesh!, f); this.apply(r.mesh, r.faces.map(String)); } }
  flip() { const f = this.needFaces(); if (f) this.apply(MD.flip(this.mesh!, f)); }
  paint(color: string) { const f = this.needFaces(); if (f) this.apply(MD.paint(this.mesh!, f, color)); }
  remove() {
    const f = this.needFaces();
    if (!f) return;
    if (f.length >= this.mesh!.faces.length) { this.ed.toast('That would delete the whole mesh. Leave the mesh editor and delete the object instead.'); return; }
    this.apply(MD.deleteFaces(this.mesh!, f), []);
  }
  merge() {
    const v = this.selectedVerts();
    if (v.length < 2) { this.ed.toast('Select two or more vertices (or an edge or face) to merge into one point.'); return; }
    this.apply(MD.mergeVerts(this.mesh!, v), []);
  }
  originToBase() {
    const o = this.ed.obj(this.id), node = this.node;
    if (!o || !node) return;
    const r = MD.originToBase(this.mesh!), back = r.shift.clone().negate().multiply(node.scale).applyQuaternion(node.quaternion);
    this.ed.checkpoint();
    Object.assign(o.props, r.mesh);
    o.pos = [o.pos[0] + back.x, o.pos[1] + back.y, o.pos[2] + back.z].map((v) => Math.round(v * 1000) / 1000) as any;
    this.vp.rebuildNode(o.id);
    this.refresh();
    this.ed.touch();
  }
}
