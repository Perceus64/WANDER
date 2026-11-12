// Editable polygon meshes (the data behind the Mesh editor): vertices, polygon faces and a
// colour per face, plus the modelling operations that work on them. Pure data in, pure data
// out, so every operation is easy to undo and to test.
import * as THREE from 'three';

export interface MeshData { verts: number[]; faces: number[][]; colors: string[] }

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const P = (m: MeshData, i: number, out = new THREE.Vector3()) => out.set(m.verts[i * 3], m.verts[i * 3 + 1], m.verts[i * 3 + 2]);
const push = (m: MeshData, v: THREE.Vector3) => { m.verts.push(r4(v.x), r4(v.y), r4(v.z)); return m.verts.length / 3 - 1; };
export const cloneMesh = (m: MeshData): MeshData => ({ verts: [...m.verts], faces: m.faces.map((f) => [...f]), colors: [...m.colors] });
export const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

export function faceNormal(m: MeshData, f: number, out = new THREE.Vector3()): THREE.Vector3 {
  // Newell's method: robust for any planar polygon.
  const face = m.faces[f], a = new THREE.Vector3(), b = new THREE.Vector3();
  out.set(0, 0, 0);
  for (let i = 0; i < face.length; i++) {
    P(m, face[i], a); P(m, face[(i + 1) % face.length], b);
    out.x += (a.y - b.y) * (a.z + b.z); out.y += (a.z - b.z) * (a.x + b.x); out.z += (a.x - b.x) * (a.y + b.y);
  }
  return out.lengthSq() > 1e-16 ? out.normalize() : out.set(0, 1, 0);
}

export function faceCenter(m: MeshData, f: number, out = new THREE.Vector3()): THREE.Vector3 {
  const face = m.faces[f], t = new THREE.Vector3();
  out.set(0, 0, 0);
  for (const i of face) out.add(P(m, i, t));
  return out.multiplyScalar(1 / face.length);
}

/** Unique edges as vertex index pairs. */
export function edgesOf(m: MeshData): [number, number][] {
  const seen = new Set<string>(), out: [number, number][] = [];
  for (const f of m.faces) for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length], k = edgeKey(a, b); if (!seen.has(k)) { seen.add(k); out.push([a, b]); } }
  return out;
}

/** Render geometry: flat shaded, one colour per face. `triFace` maps each triangle back to its face. */
export function buildGeometry(m: MeshData): THREE.BufferGeometry {
  let tris = 0;
  for (const f of m.faces) tris += Math.max(0, f.length - 2);
  const pos = new Float32Array(tris * 9), nor = new Float32Array(tris * 9), col = new Float32Array(tris * 9), triFace = new Uint32Array(tris);
  const n = new THREE.Vector3(), c = new THREE.Color();
  let t = 0;
  m.faces.forEach((f, fi) => {
    faceNormal(m, fi, n);
    c.set(m.colors[fi] ?? '#b8bcc4');
    for (let k = 1; k < f.length - 1; k++) {
      for (const [slot, vi] of [[0, f[0]], [1, f[k]], [2, f[k + 1]]]) {
        const o = t * 9 + slot * 3;
        pos[o] = m.verts[vi * 3]; pos[o + 1] = m.verts[vi * 3 + 1]; pos[o + 2] = m.verts[vi * 3 + 2];
        nor[o] = n.x; nor[o + 1] = n.y; nor[o + 2] = n.z;
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      }
      triFace[t++] = fi;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.userData.triFace = triFace;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function bounds(m: MeshData): THREE.Box3 {
  const b = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = 0; i < m.verts.length / 3; i++) b.expandByPoint(P(m, i, v));
  return b;
}

// ---------------------------------------------------------------- shapes

const quadBox = (w: number, h: number, d: number, x = 0, y = 0, z = 0, color = '#b8bcc4'): MeshData => {
  const a = w / 2, c = d / 2;
  return {
    verts: [x - a, y, z - c, x + a, y, z - c, x + a, y, z + c, x - a, y, z + c, x - a, y + h, z - c, x + a, y + h, z - c, x + a, y + h, z + c, x - a, y + h, z + c],
    faces: [[0, 1, 2, 3], [4, 7, 6, 5], [3, 2, 6, 7], [2, 1, 5, 6], [1, 0, 4, 5], [0, 3, 7, 4]],
    colors: Array(6).fill(color),
  };
};

export function combine(parts: MeshData[]): MeshData {
  const out: MeshData = { verts: [], faces: [], colors: [] };
  for (const p of parts) { const base = out.verts.length / 3; out.verts.push(...p.verts); out.faces.push(...p.faces.map((f) => f.map((i) => i + base))); out.colors.push(...p.colors); }
  return out;
}

const ring = (r: number, y: number, n: number, a0 = 0) => Array.from({ length: n }, (_, i) => [r4(Math.cos(a0 + (i * 2 * Math.PI) / n) * r), y, r4(Math.sin(a0 + (i * 2 * Math.PI) / n) * r)]).flat();

export const SHAPES: Record<string, { label: string; make(): MeshData }> = {
  cube: { label: 'Cube', make: () => quadBox(1, 1, 1) },
  plane: { label: 'Plane', make: () => ({ verts: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], faces: [[0, 3, 2, 1]], colors: ['#b8bcc4'] }) },
  cylinder: {
    label: 'Cylinder', make: () => {
      const n = 12, idx = [...Array(n).keys()];
      return { verts: [...ring(0.5, 0, n), ...ring(0.5, 1, n)], faces: [idx, idx.map((i) => n + i).reverse(), ...idx.map((i) => [i, n + i, n + ((i + 1) % n), (i + 1) % n])], colors: Array(n + 2).fill('#b8bcc4') };
    },
  },
  cone: { label: 'Cone', make: () => { const n = 12, idx = [...Array(n).keys()]; return { verts: [...ring(0.5, 0, n), 0, 1, 0], faces: [idx, ...idx.map((i) => [i, n, (i + 1) % n])], colors: Array(n + 1).fill('#b8bcc4') }; } },
  pyramid: { label: 'Pyramid', make: () => { const idx = [0, 1, 2, 3]; return { verts: [...ring(Math.SQRT1_2, 0, 4, Math.PI / 4), 0, 1, 0], faces: [idx, ...idx.map((i) => [i, 4, (i + 1) % 4])], colors: Array(5).fill('#b8bcc4') }; } },
  prism: { label: 'Prism', make: () => { const n = 3, idx = [0, 1, 2]; return { verts: [...ring(0.6, 0, n, Math.PI / 6), ...ring(0.6, 1, n, Math.PI / 6)], faces: [idx, idx.map((i) => n + i).reverse(), ...idx.map((i) => [i, n + i, n + ((i + 1) % n), (i + 1) % n])], colors: Array(5).fill('#b8bcc4') }; } },
  ramp: { label: 'Ramp', make: () => ({ verts: [-0.5, 0, -1, 0.5, 0, -1, 0.5, 0, 1, -0.5, 0, 1, -0.5, 1, -1, 0.5, 1, -1], faces: [[0, 1, 2, 3], [1, 0, 4, 5], [4, 3, 2, 5], [0, 3, 4], [2, 1, 5]], colors: Array(5).fill('#b8bcc4') }) },
  stairs: { label: 'Stairs', make: () => combine(Array.from({ length: 6 }, (_, i) => quadBox(1.2, (i + 1) * 0.18, 0.3, 0, 0, 0.75 - i * 0.3, '#a9a59c'))) },
  sphere: { label: 'Sphere', make: () => { const g = new THREE.IcosahedronGeometry(0.5, 1); g.translate(0, 0.5, 0); const m = fromGeometry(g, undefined, '#b8bcc4', false); g.dispose(); return m; } },
};

// ---------------------------------------------------------------- conversion

/** Turn render geometry into an editable mesh. Coincident corners are welded; triangle pairs forming flat quads are merged. */
export function fromGeometry(g: THREE.BufferGeometry, matrix?: THREE.Matrix4, baseColor = '#b8bcc4', quads = true): MeshData {
  const pos = g.attributes.position, col = g.attributes.color as THREE.BufferAttribute | undefined, idx = g.index;
  const m: MeshData = { verts: [], faces: [], colors: [] }, map = new Map<string, number>(), v = new THREE.Vector3(), c = new THREE.Color(), base = new THREE.Color(baseColor);
  const vert = (i: number) => {
    v.fromBufferAttribute(pos, i);
    if (matrix) v.applyMatrix4(matrix);
    const k = `${Math.round(v.x * 2000)},${Math.round(v.y * 2000)},${Math.round(v.z * 2000)}`;
    let n = map.get(k);
    if (n === undefined) { n = push(m, v); map.set(k, n); }
    return n;
  };
  const count = idx ? idx.count : pos.count;
  for (let t = 0; t + 2 < count; t += 3) {
    const i0 = idx ? idx.getX(t) : t, a = vert(i0), b = vert(idx ? idx.getX(t + 1) : t + 1), d = vert(idx ? idx.getX(t + 2) : t + 2);
    if (a === b || b === d || a === d) continue;
    m.faces.push([a, b, d]);
    m.colors.push(col ? '#' + c.setRGB(col.getX(i0), col.getY(i0), col.getZ(i0)).multiply(base).getHexString() : baseColor);
  }
  return quads ? quadify(m) : m;
}

function quadify(m: MeshData): MeshData {
  const owner = new Map<string, number[]>();
  m.faces.forEach((f, fi) => { for (let i = 0; i < 3; i++) { const k = edgeKey(f[i], f[(i + 1) % 3]); (owner.get(k) ?? owner.set(k, []).get(k)!).push(fi); } });
  const used = new Uint8Array(m.faces.length), out: MeshData = { verts: m.verts, faces: [], colors: [] }, n1 = new THREE.Vector3(), n2 = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c1 = new THREE.Color(), c2 = new THREE.Color();
  m.faces.forEach((f, fi) => {
    if (used[fi]) return;
    used[fi] = 1;
    // The diagonal of a quad is the longest edge of both of its triangles.
    let best = 0, len = -1;
    for (let i = 0; i < 3; i++) { const l = P(m, f[i], a).distanceToSquared(P(m, f[(i + 1) % 3], b)); if (l > len) { len = l; best = i; } }
    const e0 = f[best], e1 = f[(best + 1) % 3], apex = f[(best + 2) % 3];
    const other = (owner.get(edgeKey(e0, e1)) ?? []).find((o) => o !== fi && !used[o]);
    if (other !== undefined && faceNormal(m, fi, n1).dot(faceNormal(m, other, n2)) > 0.9995) {
      c1.set(m.colors[fi]); c2.set(m.colors[other]);
      const d = m.faces[other].find((i) => i !== e0 && i !== e1)!;
      if (Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b) < 0.06) { used[other] = 1; out.faces.push([apex, e0, d, e1]); out.colors.push(m.colors[fi]); return; }
    }
    out.faces.push(f); out.colors.push(m.colors[fi]);
  });
  return out;
}

// ---------------------------------------------------------------- selection helpers

export function vertsOfFaces(m: MeshData, faces: Iterable<number>): number[] {
  const s = new Set<number>();
  for (const f of faces) for (const i of m.faces[f] ?? []) s.add(i);
  return [...s];
}

/** The flat, connected area a face belongs to (a whole wall of a box, a table top…). */
export function coplanarIsland(m: MeshData, start: number): number[] {
  const owner = new Map<string, number[]>();
  m.faces.forEach((f, fi) => { for (let i = 0; i < f.length; i++) { const k = edgeKey(f[i], f[(i + 1) % f.length]); (owner.get(k) ?? owner.set(k, []).get(k)!).push(fi); } });
  const n0 = faceNormal(m, start), n = new THREE.Vector3(), seen = new Set([start]), todo = [start];
  while (todo.length) {
    const f = m.faces[todo.pop()!];
    for (let i = 0; i < f.length; i++) for (const o of owner.get(edgeKey(f[i], f[(i + 1) % f.length])) ?? []) if (!seen.has(o) && faceNormal(m, o, n).dot(n0) > 0.999) { seen.add(o); todo.push(o); }
  }
  return [...seen];
}

// ---------------------------------------------------------------- operations (all return a new mesh)

/** Pull the selected faces out along their normals, building walls around the moved area. */
export function extrude(src: MeshData, faces: number[], dist: number): MeshData {
  const m = cloneMesh(src), directed = new Set<string>(), normals = new Map<number, THREE.Vector3>(), n = new THREE.Vector3();
  for (const f of faces) {
    const face = m.faces[f];
    faceNormal(m, f, n);
    face.forEach((a, i) => { directed.add(`${a}>${face[(i + 1) % face.length]}`); (normals.get(a) ?? normals.set(a, new THREE.Vector3()).get(a)!).add(n); });
  }
  const moved = new Map<number, number>(), p = new THREE.Vector3();
  for (const [vi, vn] of normals) moved.set(vi, push(m, P(m, vi, p).addScaledVector(vn.normalize(), dist)));
  for (const f of faces) {
    const face = m.faces[f];
    face.forEach((a, i) => { const b = face[(i + 1) % face.length]; if (!directed.has(`${b}>${a}`)) { m.faces.push([a, b, moved.get(b)!, moved.get(a)!]); m.colors.push(m.colors[f]); } });
    m.faces[f] = face.map((i) => moved.get(i)!);
  }
  return m;
}

/** Shrink each selected face towards its centre, leaving a border ring. `amount` is 0–0.95. */
export function inset(src: MeshData, faces: number[], amount: number): MeshData {
  const m = cloneMesh(src), c = new THREE.Vector3(), p = new THREE.Vector3();
  for (const f of faces) {
    const face = m.faces[f];
    faceCenter(m, f, c);
    const inner = face.map((i) => push(m, P(m, i, p).lerp(c, amount)));
    face.forEach((a, i) => { const j = (i + 1) % face.length; m.faces.push([a, face[j], inner[j], inner[i]]); m.colors.push(m.colors[f]); });
    m.faces[f] = inner;
  }
  return m;
}

/** Split each selected face into smaller faces around its centre. Returns the mesh and the faces that replaced the selection. */
export function subdivide(src: MeshData, faces: number[]): { mesh: MeshData; faces: number[] } {
  const m = cloneMesh(src), mids = new Map<string, number>(), a = new THREE.Vector3(), b = new THREE.Vector3(), out: number[] = [];
  const mid = (i: number, j: number) => { const k = edgeKey(i, j); let v = mids.get(k); if (v === undefined) { v = push(m, P(m, i, a).add(P(m, j, b)).multiplyScalar(0.5)); mids.set(k, v); } return v; };
  for (const f of faces) {
    const face = m.faces[f], c = push(m, faceCenter(m, f)), n = face.length;
    const ms = face.map((v, i) => mid(v, face[(i + 1) % n]));
    face.forEach((v, i) => {
      const quad = [v, ms[i], c, ms[(i + n - 1) % n]];
      if (i === 0) { m.faces[f] = quad; out.push(f); } else { m.faces.push(quad); m.colors.push(m.colors[f]); out.push(m.faces.length - 1); }
    });
  }
  return { mesh: m, faces: out };
}

function prune(m: MeshData): MeshData {
  const map = new Map<number, number>(), verts: number[] = [];
  const faces = m.faces.map((f) => f.map((i) => { let n = map.get(i); if (n === undefined) { n = verts.length / 3; verts.push(m.verts[i * 3], m.verts[i * 3 + 1], m.verts[i * 3 + 2]); map.set(i, n); } return n; }));
  return { verts, faces, colors: m.colors };
}

export function deleteFaces(src: MeshData, faces: number[]): MeshData {
  const drop = new Set(faces);
  return prune({ verts: src.verts, faces: src.faces.filter((_, i) => !drop.has(i)).map((f) => [...f]), colors: src.colors.filter((_, i) => !drop.has(i)) });
}

export function flip(src: MeshData, faces: number[]): MeshData {
  const m = cloneMesh(src);
  for (const f of faces) m.faces[f].reverse();
  return m;
}

export function paint(src: MeshData, faces: number[], color: string): MeshData {
  const m = cloneMesh(src);
  for (const f of faces) m.colors[f] = color;
  return m;
}

/** Collapse the selected vertices into one point at their centre. */
export function mergeVerts(src: MeshData, verts: number[]): MeshData {
  if (verts.length < 2) return src;
  const m = cloneMesh(src), c = new THREE.Vector3(), p = new THREE.Vector3(), keep = verts[0], gone = new Set(verts);
  for (const v of verts) c.add(P(m, v, p));
  c.multiplyScalar(1 / verts.length);
  m.verts[keep * 3] = r4(c.x); m.verts[keep * 3 + 1] = r4(c.y); m.verts[keep * 3 + 2] = r4(c.z);
  const faces: number[][] = [], colors: string[] = [];
  m.faces.forEach((f, fi) => {
    const g = f.map((i) => (gone.has(i) ? keep : i)).filter((v, i, arr) => v !== arr[(i + 1) % arr.length]);
    if (new Set(g).size >= 3) { faces.push(g); colors.push(m.colors[fi]); }
  });
  return prune({ verts: m.verts, faces, colors });
}

/** Give selected vertices new positions (used while dragging the gizmo). */
export function setVerts(m: MeshData, idx: number[], pts: THREE.Vector3[]) {
  idx.forEach((i, k) => { m.verts[i * 3] = r4(pts[k].x); m.verts[i * 3 + 1] = r4(pts[k].y); m.verts[i * 3 + 2] = r4(pts[k].z); });
}

/** Move all vertices so the origin sits at the centre of the base. Returns the shift that was applied. */
export function originToBase(src: MeshData): { mesh: MeshData; shift: THREE.Vector3 } {
  const b = bounds(src), c = b.getCenter(new THREE.Vector3()), shift = new THREE.Vector3(-c.x, -b.min.y, -c.z), m = cloneMesh(src);
  for (let i = 0; i < m.verts.length; i += 3) { m.verts[i] = r4(m.verts[i] + shift.x); m.verts[i + 1] = r4(m.verts[i + 1] + shift.y); m.verts[i + 2] = r4(m.verts[i + 2] + shift.z); }
  return { mesh: m, shift };
}
