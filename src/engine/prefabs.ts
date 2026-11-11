// Procedural asset library. Every prefab is a list of coloured low-poly parts that
// is merged into ONE flat-shaded geometry with vertex colours: one draw call per
// object and directly usable for GPU instancing (forests, rock fields).
// Parts can be tapered, faceted (jittered icosphere), tinted per face and shaded
// towards their base, which is what gives the models their hand-made look.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Part = {
  g: 'box' | 'cyl' | 'cone' | 'sph' | 'ico'; s: number[]; p: number[]; c: string; r?: number[];
  /** Box only: scale of the top face in x and z (0 = ridge / point). */ t?: number[];
  /** Per-face brightness variation (0–0.3). */ v?: number;
  /** Darkening towards the bottom of the part (0–0.6), a cheap ambient-occlusion look. */ ao?: number;
};
export interface PrefabDef {
  key: string;
  name: string;
  cat: string;
  parts: Part[];
  /** [w,h,d] collision box centred on x/z, or 'none'. Defaults to the bounding box. */
  collider?: number[] | 'none';
  light?: { pos: number[]; color: string; intensity: number; range: number };
  /** Small decoration: no shadow casting and a short draw distance when scattered. */
  small?: boolean;
}

const H = Math.PI / 2;
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: string, r?: number[]): Part => ({ g: 'box', s: [w, h, d], p: [x, y, z], c, r });
const taper = (w: number, h: number, d: number, x: number, y: number, z: number, c: string, tx: number, tz: number, r?: number[]): Part => ({ g: 'box', s: [w, h, d], p: [x, y, z], c, r, t: [tx, tz] });
const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number, c: string, r?: number[], seg = 8): Part => ({ g: 'cyl', s: [rt, rb, h, seg], p: [x, y, z], c, r });
const cone = (rad: number, h: number, x: number, y: number, z: number, c: string, seg = 7, ry = 0): Part => ({ g: 'cone', s: [rad, h, seg], p: [x, y, z], c, r: [0, ry, 0] });
const sph = (rad: number, x: number, y: number, z: number, c: string, sc?: number[]): Part => ({ g: 'sph', s: [rad, ...(sc ?? [1, 1, 1])], p: [x, y, z], c });
const ico = (rad: number, x: number, y: number, z: number, c: string, sc: number[] = [1, 1, 1], jit = 0.16, detail = 1, v = 0.08, ao = 0.28): Part => ({ g: 'ico', s: [rad, ...sc, detail, jit], p: [x, y, z], c, v, ao });
const shade = (p: Part, ao = 0.3, v = 0): Part => ({ ...p, ao, v });
const ring = (n: number, f: (a: number, i: number) => Part | Part[], a0 = 0): Part[] => Array.from({ length: n }, (_, i) => f(a0 + (i * 2 * Math.PI) / n, i)).flat();
const move = (parts: Part[], dx: number, dy: number, dz: number): Part[] => parts.map((q) => ({ ...q, p: [q.p[0] + dx, q.p[1] + dy, q.p[2] + dz] }));

/** Turn a group of parts to face the other way (exact for any part rotation). */
const flip = (parts: Part[]): Part[] => parts.map((q) => ({ ...q, p: [-q.p[0], q.p[1], -q.p[2]], r: [-(q.r?.[0] ?? 0), (q.r?.[1] ?? 0) + Math.PI, q.r?.[2] ?? 0] }));
/** Turn a group of unrotated parts around the vertical axis. */
const turn = (parts: Part[], ry: number): Part[] => parts.map((q) => ({ ...q, p: [q.p[0] * Math.cos(ry) + q.p[2] * Math.sin(ry), q.p[1], -q.p[0] * Math.sin(ry) + q.p[2] * Math.cos(ry)], r: [0, ry, 0] }));
const WOOD = '#8b6a47', DARK = '#6e5338', BARK = '#5b4330', METAL = '#3a3f47', STEEL = '#8a8f96', GLASS = '#9fd0e8', STONE = '#8d8982', WHITE = '#f2f0ea', TYRE = '#1c1d1f';

const legs = (w: number, d: number, h: number, c: string, t = 0.06): Part[] =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(t, h, t, a * (w / 2 - t), h / 2, b * (d / 2 - t), c));
const wheel = (x: number, y: number, z: number, rad: number, w: number): Part[] => [
  cyl(rad, rad, w, x, y, z, TYRE, [0, 0, H], 12), cyl(rad * 0.55, rad * 0.55, w + 0.03, x, y, z, '#c3c7cc', [0, 0, H], 8),
];
/** Framed window on a wall whose outward normal is rotated `ry` around the vertical axis. */
const win = (w: number, h: number, x: number, y: number, z: number, ry = 0, frame = WHITE): Part[] => {
  const nx = Math.sin(ry), nz = Math.cos(ry), r = [0, ry, 0], at = (o: number): [number, number, number] => [x + nx * o, y, z + nz * o];
  const [ax, ay, az] = at(0), [bx, , bz] = at(0.025), [cx, , cz] = at(0.05);
  return [box(w + 0.16, h + 0.16, 0.08, ax, ay, az, frame, r), box(w, h, 0.06, bx, ay, bz, GLASS, r), box(0.05, h, 0.04, cx, ay, cz, frame, r), box(w, 0.05, 0.04, cx, ay, cz, frame, r), box(w + 0.3, 0.07, 0.16, cx, ay - h / 2 - 0.1, cz, frame, r)];
};
const door = (w: number, h: number, x: number, z: number, c: string, ry = 0): Part[] => {
  const nx = Math.sin(ry), nz = Math.cos(ry), r = [0, ry, 0];
  return [box(w + 0.18, h + 0.1, 0.1, x, h / 2 + 0.05, z, WHITE, r), box(w, h, 0.08, x + nx * 0.03, h / 2, z + nz * 0.03, c, r), box(w - 0.24, h * 0.36, 0.03, x + nx * 0.07, h * 0.7, z + nz * 0.07, shadeHex(c, 0.82), r),
    sph(0.045, x + nx * 0.1 + nz * (w / 2 - 0.12), h * 0.48, z + nz * 0.1 - nx * (w / 2 - 0.12), '#d9c38a'), box(w + 0.5, 0.14, 0.5, x + nx * 0.25, 0.07, z + nz * 0.25, STONE, r)];
};
function shadeHex(hex: string, k: number) { return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString(); }

/** Gabled house: stone base, walls, two roof slopes with overhang, gable ends, door, framed windows and a chimney. */
const house = (w: number, d: number, h: number, wall: string, roof: string, o: { chimney?: boolean; upper?: boolean } = {}): Part[] => {
  const run = d / 2 + 0.4, rh = d * 0.38, a = Math.atan2(rh, run), len = Math.hypot(rh, run) + 0.12;
  const parts: Part[] = [
    box(w + 0.24, 0.35, d + 0.24, 0, 0.175, 0, STONE), shade(box(w, h, d, 0, h / 2, 0, wall), 0.14),
    taper(w, rh, d, 0, h + rh / 2, 0, wall, 1, 0),
    box(w + 0.8, 0.14, len, 0, h + rh / 2 + 0.03, run / 2, roof, [a, 0, 0]), box(w + 0.8, 0.14, len, 0, h + rh / 2 + 0.03, -run / 2, roof, [-a, 0, 0]),
    box(w + 0.86, 0.12, 0.3, 0, h + rh + 0.08, 0, shadeHex(roof, 0.8)),
    ...door(0.95, 2.05, 0, d / 2 + 0.02, '#4a3424'),
    ...win(1, 1.1, -w / 4 - 0.35, 1.55, d / 2 + 0.02), ...win(1, 1.1, w / 4 + 0.35, 1.55, d / 2 + 0.02),
    ...win(1, 1.1, w / 2 + 0.02, 1.55, 0, H), ...win(1, 1.1, -w / 2 - 0.02, 1.55, 0, -H), ...win(1.2, 1.1, 0, 1.55, -d / 2 - 0.02, Math.PI),
  ];
  if (o.upper) parts.push(...win(1, 1, -w / 4 - 0.35, h - 1.1, d / 2 + 0.02), ...win(1, 1, w / 4 + 0.35, h - 1.1, d / 2 + 0.02), ...win(1, 1, 0, h - 1.1, d / 2 + 0.02), ...win(1, 1, w / 2 + 0.02, h - 1.1, 0, H), ...win(1, 1, -w / 2 - 0.02, h - 1.1, 0, -H));
  if (o.chimney !== false) parts.push(box(0.6, rh + 1, 0.6, w / 4, h + rh / 2 + 0.3, -d / 5, '#9a5a48'), box(0.74, 0.12, 0.74, w / 4, h + rh + 0.86, -d / 5, '#6d4034'));
  return parts;
};

const foliage = (list: [number, number, number, number, string][], sy = 0.85, jit = 0.2): Part[] => list.map(([r, x, y, z, c]) => ico(r, x, y, z, c, [1, sy, 1], jit, 1, 0.1, 0.35));
const trunk = (rt: number, rb: number, h: number, c = BARK, seg = 6): Part => shade(cyl(rt, rb, h, 0, h / 2, 0, c, undefined, seg), 0.35, 0.06);

// ---- reusable office / computer pieces (also combined into ready-made workstations) ----
const SCREEN = '#2a5d94', SCREEN_HI = '#4f8fd0', CASE = '#22252a', ALU = '#b9bec4';
const monitor = (w = 0.56, h = 0.33): Part[] => [box(0.24, 0.015, 0.18, 0, 0.008, 0, CASE), box(0.05, 0.16, 0.03, 0, 0.09, -0.03, CASE), box(w, h, 0.025, 0, 0.17 + h / 2, 0, CASE), box(w - 0.03, h - 0.03, 0.006, 0, 0.17 + h / 2, 0.012, SCREEN),
  box(w * 0.42, h * 0.5, 0.004, -w * 0.2, 0.19 + h / 2, 0.016, SCREEN_HI), box(w * 0.3, h * 0.28, 0.004, w * 0.24, 0.13 + h / 2, 0.016, '#e8eef5'), box(w - 0.03, 0.022, 0.004, 0, 0.196, 0.016, '#1b2d44'), box(0.012, 0.012, 0.004, w / 2 - 0.03, 0.178, 0.014, '#3fd96a')];
const keyboardMouse = (): Part[] => [box(0.44, 0.018, 0.14, -0.08, 0.009, 0, CASE), ...[-0.045, -0.015, 0.015, 0.045].map((z) => box(0.41, 0.006, 0.022, -0.08, 0.02, z, '#3d424a')), box(0.16, 0.006, 0.02, -0.1, 0.021, 0.05, '#4a5058'),
  box(0.22, 0.004, 0.2, 0.3, 0.002, 0, '#30343a'), taper(0.06, 0.03, 0.1, 0.3, 0.019, 0, CASE, 0.75, 0.8), box(0.008, 0.004, 0.02, 0.3, 0.035, -0.02, '#8a8f96')];
const pcTower = (): Part[] => [box(0.2, 0.44, 0.45, 0, 0.235, 0, CASE), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.03, 0.015, 0.05, a * 0.07, 0.008, b * 0.18, '#111')), box(0.18, 0.42, 0.01, 0, 0.235, 0.228, '#30343a'),
  box(0.14, 0.035, 0.006, 0, 0.4, 0.234, '#1a1c20'), box(0.14, 0.035, 0.006, 0, 0.355, 0.234, '#1a1c20'), ...[0.1, 0.13, 0.16, 0.19, 0.22].map((y) => box(0.13, 0.008, 0.006, 0, y, 0.234, '#15171a')), cyl(0.014, 0.014, 0.008, 0.05, 0.3, 0.234, '#3fd9ff', [H, 0, 0], 8), box(0.02, 0.006, 0.006, -0.05, 0.3, 0.234, '#e8a33d'),
  box(0.005, 0.3, 0.3, 0.101, 0.25, 0, '#3a4350'), box(0.006, 0.02, 0.02, 0.104, 0.3, 0.05, '#d93f6a')];
const officeChair = (c = '#2f3540'): Part[] => [...ring(5, (a) => [box(0.3, 0.03, 0.05, Math.cos(a) * 0.15, 0.085, Math.sin(a) * 0.15, '#1c1d1f', [0, -a, 0]), sph(0.035, Math.cos(a) * 0.29, 0.035, Math.sin(a) * 0.29, '#111')]), cyl(0.045, 0.05, 0.06, 0, 0.1, 0, '#1c1d1f'), cyl(0.025, 0.025, 0.3, 0, 0.27, 0, ALU, undefined, 6),
  box(0.2, 0.04, 0.2, 0, 0.43, 0, '#1c1d1f'), taper(0.46, 0.09, 0.44, 0, 0.49, 0.02, c, 1.06, 1.04), box(0.06, 0.34, 0.04, 0, 0.62, -0.23, '#1c1d1f', [-0.12, 0, 0]), taper(0.44, 0.56, 0.07, 0, 0.98, -0.27, c, 0.86, 1, [-0.12, 0, 0]), box(0.3, 0.12, 0.03, 0, 0.84, -0.215, shadeHex(c, 1.25), [-0.12, 0, 0]),
  ...[-1, 1].flatMap((sx) => [box(0.035, 0.2, 0.035, sx * 0.26, 0.6, 0, '#1c1d1f'), box(0.06, 0.03, 0.26, sx * 0.26, 0.71, 0.02, '#15171a')])];
const drawers = (x: number, z: number, w: number, d: number, h: number, n: number, c: string): Part[] => [box(w, h, d, x, h / 2 + 0.03, z, c), ...Array.from({ length: n }, (_, i) => [box(w - 0.04, h / n - 0.03, 0.012, x, 0.03 + (h / n) * (i + 0.5), z + d / 2 + 0.006, shadeHex(c, 1.12)), box(w * 0.4, 0.014, 0.02, x, 0.03 + (h / n) * (i + 0.72), z + d / 2 + 0.02, ALU)]).flat()];
const officeDesk = (): Part[] => [box(1.6, 0.04, 0.75, 0, 0.74, 0, '#d9d4c8'), box(1.6, 0.012, 0.75, 0, 0.716, 0, '#8a8f96'), box(0.04, 0.71, 0.7, -0.76, 0.355, 0, '#9aa0a6'), box(1.1, 0.3, 0.02, -0.2, 0.5, -0.34, '#b0b5ba'), ...drawers(0.52, 0, 0.42, 0.68, 0.66, 3, '#aeb3b8')];

const P = (key: string, name: string, cat: string, parts: Part[], extra: Partial<PrefabDef> = {}): PrefabDef => ({ key, name, cat, parts, ...extra });

export const PREFABS: PrefabDef[] = [
  // Trees
  P('tree_pine', 'Pine tree', 'Trees', [trunk(0.1, 0.2, 1.5), ...[[1.45, 1.5, 1.7, '#27502e'], [1.2, 1.4, 2.5, '#2c5a33'], [0.95, 1.3, 3.3, '#31653a'], [0.7, 1.2, 4.05, '#387241'], [0.42, 1.0, 4.75, '#40804a']].map(([r, h, y, c], i) => ({ ...cone(r as number, h as number, i % 2 ? 0.05 : -0.04, y as number, i % 2 ? -0.04 : 0.03, c as string, 7, i * 0.45), v: 0.1, ao: 0.4 }))], { collider: [0.4, 4, 0.4] }),
  P('tree_oak', 'Oak tree', 'Trees', [trunk(0.2, 0.34, 2.2, '#5a4532', 7), cyl(0.08, 0.13, 1.3, 0.5, 2.3, 0.1, '#5a4532', [0, 0, -0.75], 5), cyl(0.07, 0.12, 1.2, -0.45, 2.35, -0.2, '#5a4532', [0.3, 0, 0.8], 5),
    ...foliage([[1.35, 0, 3.6, 0, '#4d7d35'], [1.05, 1.05, 3.1, 0.35, '#447230'], [1.0, -0.95, 3.2, -0.45, '#58893c'], [0.9, 0.15, 3.0, -1.0, '#3f6b2d'], [0.85, -0.2, 3.1, 1.0, '#4f8238'], [0.8, 0.3, 4.35, 0.1, '#5f9242']])], { collider: [0.6, 4, 0.6] }),
  P('tree_birch', 'Birch tree', 'Trees', [trunk(0.07, 0.12, 3.4, '#e6e3d8', 6), ...[0.5, 1.1, 1.8, 2.5].map((y, i) => cyl(0.1 - i * 0.008, 0.105 - i * 0.008, 0.07, 0, y, 0, '#3b3a36', [0, i, 0], 6)), cyl(0.03, 0.05, 0.9, 0.3, 2.9, 0, '#e6e3d8', [0, 0, -0.9], 4),
    ...foliage([[0.85, 0, 4.0, 0, '#8fb04a'], [0.65, 0.5, 3.3, 0.2, '#9cbd55'], [0.6, -0.4, 3.5, -0.25, '#84a544'], [0.5, 0.05, 4.75, 0, '#a5c75e']], 1.15)], { collider: [0.3, 4, 0.3] }),
  P('tree_palm', 'Palm tree', 'Trees', [...[0, 1, 2, 3, 4].map((i) => shade(cyl(0.13 + (4 - i) * 0.015, 0.15 + (4 - i) * 0.018, 0.95, i * i * 0.022, 0.46 + i * 0.9, 0, i % 2 ? '#8a6f4d' : '#7d6444', [0, 0, -i * 0.045], 6), 0.25)),
    ...ring(8, (a, i) => [taper(1.5, 0.06, 0.55, 0.36 + Math.cos(a) * 0.72, 4.4 - (i % 2) * 0.08, Math.sin(a) * 0.72, i % 2 ? '#3f8a45' : '#357a3c', 1, 0.75, [0, -a, -0.28]), taper(1.2, 0.05, 0.42, 0.36 + Math.cos(a) * 1.86, 3.8 - (i % 2) * 0.08, Math.sin(a) * 1.92, i % 2 ? '#48994e' : '#3f8a45', 1, 0.2, [0, -a, -0.75])]),
    sph(0.13, 0.5, 4.3, 0.1, '#5a4028'), sph(0.13, 0.25, 4.28, -0.14, '#5a4028'), sph(0.12, 0.3, 4.26, 0.16, '#6b4c30')], { collider: [0.4, 4.4, 0.4] }),
  P('tree_dead', 'Dead tree', 'Trees', [trunk(0.09, 0.24, 2.9, '#4a4038', 6), cyl(0.04, 0.09, 1.5, 0.48, 2.7, 0, '#4a4038', [0, 0, -0.8], 5), cyl(0.03, 0.07, 1.2, -0.4, 2.3, 0.1, '#453b34', [0.2, 0, 0.9], 5), cyl(0.02, 0.05, 0.9, 0.1, 3.3, -0.2, '#4a4038', [-0.5, 0, 0.2], 4), cyl(0.02, 0.04, 0.7, 0.95, 3.35, 0, '#453b34', [0, 0, -0.2], 4), cyl(0.02, 0.04, 0.6, -0.8, 2.85, 0.2, '#4a4038', [0.3, 0, 0.3], 4)], { collider: [0.4, 3, 0.4] }),
  // Plants
  P('bush', 'Bush', 'Plants', foliage([[0.55, 0, 0.42, 0, '#3f6e33'], [0.42, 0.45, 0.33, 0.2, '#4a7d3a'], [0.38, -0.4, 0.3, -0.2, '#386430'], [0.34, 0.05, 0.3, -0.45, '#447534']], 0.8), { collider: 'none' }),
  P('grass_tuft', 'Grass tuft', 'Plants', [[0, 0, 0.55, '#6a9a3f', 0], [0.12, 0.05, 0.42, '#5d8c38', 0.15], [-0.1, 0.09, 0.46, '#74a646', -0.18], [0.03, -0.12, 0.38, '#5d8c38', 0.1], [-0.07, -0.06, 0.5, '#7fb04c', -0.1]].map(([x, z, h, c, lean]) => ({ ...taper(0.07, h as number, 0.02, x as number, (h as number) / 2, z as number, c as string, 0.1, 1, [0, (x as number) * 9, lean as number]), ao: 0.45 })), { collider: 'none', small: true }),
  P('flowers', 'Flowers', 'Plants', [[0, 0, 0.36, '#e8c33d'], [0.17, 0.08, 0.3, '#d9566a'], [-0.14, -0.1, 0.33, '#f1f1f1'], [0.05, -0.17, 0.26, '#b06ad9'], [-0.1, 0.15, 0.29, '#e88a3d']].flatMap(([x, z, h, c]) => [box(0.018, h as number, 0.018, x as number, (h as number) / 2, z as number, '#5d8c38'), ico(0.065, x as number, h as number, z as number, c as string, [1, 0.6, 1], 0, 0, 0.05, 0), taper(0.14, 0.01, 0.05, (x as number) + 0.05, (h as number) * 0.45, z as number, '#6a9a3f', 0.3, 1, [0, 0, 0.5])]), { collider: 'none', small: true }),
  P('fern', 'Fern', 'Plants', ring(7, (a, i) => taper(0.75, 0.03, 0.22, Math.cos(a) * 0.32, 0.22 + (i % 2) * 0.05, Math.sin(a) * 0.32, i % 2 ? '#3d7a3c' : '#46883f', 1, 0.15, [0, -a, 0.45])), { collider: 'none', small: true }),
  P('potted_plant', 'Potted plant', 'Plants', [cyl(0.22, 0.15, 0.34, 0, 0.17, 0, '#a5654a', undefined, 8), cyl(0.245, 0.245, 0.05, 0, 0.345, 0, '#8f553d', undefined, 8), cyl(0.2, 0.2, 0.02, 0, 0.36, 0, '#3d2e20', undefined, 8), box(0.03, 0.4, 0.03, 0, 0.55, 0, '#5d8c38'),
    ...foliage([[0.26, 0, 0.85, 0, '#3f7d3c'], [0.2, 0.16, 0.66, 0.08, '#4a8c45'], [0.19, -0.14, 0.7, -0.08, '#377236']], 1.2, 0.22)]),
  // Rocks
  P('rock', 'Rock', 'Rocks', [ico(0.62, 0, 0.26, 0, '#807c76', [1.2, 0.68, 1], 0.3, 1, 0.1, 0.35), ico(0.3, 0.5, 0.14, 0.3, '#75716b', [1.1, 0.7, 1], 0.3, 0, 0.1, 0.3)]),
  P('boulder', 'Boulder', 'Rocks', [ico(1.4, 0, 0.85, 0, '#77736d', [1.1, 0.8, 1], 0.3, 1, 0.1, 0.4), ico(0.8, 1.15, 0.45, 0.4, '#858079', [1, 0.7, 1], 0.32, 1, 0.1, 0.4), ico(0.5, -0.9, 0.28, 0.8, '#6f6b65', [1.1, 0.7, 0.9], 0.3, 0, 0.1, 0.35)]),
  P('rock_slab', 'Rock slab', 'Rocks', [shade(taper(2.3, 0.5, 1.5, 0, 0.25, 0, '#827d75', 0.86, 0.8, [0, 0.3, 0.05]), 0.3, 0.08), shade(taper(1.5, 0.4, 1.05, 0.2, 0.66, 0.1, '#77726b', 0.8, 0.75, [0, -0.2, -0.04]), 0.25, 0.08), ico(0.3, -1.1, 0.14, 0.7, '#6f6b65', [1, 0.6, 1], 0.3, 0)]),
  P('pebbles', 'Pebbles', 'Rocks', [[0.14, 0, 0, '#8d8982'], [0.1, 0.25, 0.1, '#7a766f'], [0.12, -0.2, -0.15, '#9a968e'], [0.08, 0.1, -0.24, '#85817a'], [0.07, -0.08, 0.22, '#96928b']].map(([r, x, z, c]) => ico(r as number, x as number, (r as number) * 0.45, z as number, c as string, [1, 0.6, 1], 0.25, 0, 0.08, 0.2)), { collider: 'none', small: true }),
  // Buildings & houses
  P('house_small', 'Small house', 'Houses', house(6, 5, 3, '#d8cdb8', '#8a3f33')),
  P('house_large', 'Large house', 'Houses', [...house(9, 7, 5.6, '#c9d2d6', '#3f4a5a', { upper: true }), box(3, 0.12, 1.6, 0, 2.5, 4.3, '#3f4a5a', [0.12, 0, 0]), box(0.14, 2.45, 0.14, -1.35, 1.22, 4.95, WHITE), box(0.14, 2.45, 0.14, 1.35, 1.22, 4.95, WHITE)]),
  P('cabin', 'Cabin', 'Houses', [...house(4.5, 4, 2.6, '#7a5a3c', '#3f3027'), ...[0.55, 1.05, 1.55, 2.05].flatMap((y) => [box(4.56, 0.05, 4.06, 0, y, 0, '#5f4530')]), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => cyl(0.13, 0.13, 2.6, a * 2.25, 1.3, b * 2, '#644a32', undefined, 6))]),
  P('office_block', 'Office block', 'Buildings', [shade(box(12, 18, 10, 0, 9, 0, '#8e9aa6'), 0.12), ...[0, 1, 2, 3, 4].map((i) => box(12.06, 1.5, 10.06, 0, 2.7 + i * 3.4, 0, '#bfe0f0')), ...[-4.5, -1.5, 1.5, 4.5].flatMap((x) => [box(0.22, 17.4, 0.14, x, 9.3, 5.06, '#7a8692'), box(0.22, 17.4, 0.14, x, 9.3, -5.06, '#7a8692')]),
    ...[-3.4, 0, 3.4].flatMap((z) => [box(0.14, 17.4, 0.22, 6.06, 9.3, z, '#7a8692'), box(0.14, 17.4, 0.22, -6.06, 9.3, z, '#7a8692')]), box(12.4, 0.5, 10.4, 0, 18.25, 0, '#6f7a85'), box(2.2, 1, 1.6, -3, 19, 1, '#9aa0a6'), box(1.4, 0.8, 1.4, 2.5, 18.9, -2, '#9aa0a6'),
    box(2.4, 2.6, 0.1, 0, 1.3, 5.04, '#2a3038'), box(1.05, 2.3, 0.06, -0.56, 1.2, 5.1, '#8fc2dc'), box(1.05, 2.3, 0.06, 0.56, 1.2, 5.1, '#8fc2dc'), box(4, 0.18, 1.8, 0, 2.9, 5.9, '#55606c'), cyl(0.07, 0.07, 2.9, -1.8, 1.45, 6.6, STEEL), cyl(0.07, 0.07, 2.9, 1.8, 1.45, 6.6, STEEL)]),
  P('tower', 'Tower', 'Buildings', [shade(box(8, 40, 8, 0, 20, 0, '#6f7c8c'), 0.12), ...Array.from({ length: 11 }, (_, i) => box(8.06, 1.6, 8.06, 0, 3 + i * 3.4, 0, '#a9cfe6')), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.5, 40.6, 0.5, a * 4, 20.3, b * 4, '#5d6978')),
    box(8.5, 0.6, 8.5, 0, 40.3, 0, '#55606c'), box(4, 2.2, 4, 0, 41.7, 0, '#66727f'), cyl(0.05, 0.08, 6, 0, 45.8, 0, STEEL, undefined, 5), sph(0.14, 0, 48.8, 0, '#d93f3f'), box(2.6, 2.6, 0.1, 0, 1.3, 4.04, '#2a3038'), box(4.4, 0.2, 1.6, 0, 3, 4.8, '#55606c')]),
  P('warehouse', 'Warehouse', 'Buildings', [shade(box(16, 5.4, 10, 0, 2.7, 0, '#9aa0a3'), 0.15), taper(16.5, 1.5, 10.6, 0, 6.15, 0, '#5d6468', 1, 0.04), ...[-6, -3, 0, 3, 6].map((x) => box(0.16, 5.4, 10.08, x, 2.7, 0, '#8b9195')),
    ...[-4, 4].flatMap((x) => [box(3.6, 3.8, 0.1, x, 1.9, 5.03, '#3b4046'), ...[0.6, 1.3, 2.0, 2.7, 3.4].map((y) => box(3.5, 0.06, 0.04, x, y, 5.09, '#555b62'))]), ...door(0.95, 2.05, 0, 5.02, '#55606c'), box(9, 0.3, 2, 0, 0.15, 6, '#77736d'),
    ...[-5, 0, 5].map((x) => cyl(0.3, 0.36, 0.5, x, 7.05, 0, STEEL, undefined, 6))]),
  P('shop', 'Shop', 'Buildings', [box(7.2, 0.3, 6.2, 0, 0.15, 0, STONE), shade(box(7, 3.6, 6, 0, 1.8, 0, '#d5c2a0'), 0.14), box(7.3, 0.5, 6.3, 0, 3.85, 0, '#b9a686'), box(4.6, 2, 0.1, 0.8, 1.35, 3.02, WHITE), box(4.4, 1.8, 0.1, 0.8, 1.35, 3.05, '#a9d4ea'), box(0.06, 1.8, 0.06, 0.8, 1.35, 3.1, WHITE),
    ...door(0.95, 2.1, -2.45, 3.02, '#4a3424'), ...[0, 1, 2, 3, 4, 5, 6].map((i) => box(1.06, 0.08, 1.5, -3.18 + i * 1.06, 2.75, 3.6, i % 2 ? '#f1ece2' : '#b5483c', [0.3, 0, 0])), box(3.4, 0.6, 0.1, 0, 3.6, 3.08, '#2d3a4a'), box(3, 0.3, 0.02, 0, 3.6, 3.14, '#e8c33d'),
    cyl(0.28, 0.2, 0.4, 3.1, 0.5, 3.5, '#a5654a'), ...foliage([[0.33, 3.1, 0.95, 3.5, '#3f7d3c']], 1, 0.2)]),
  P('church', 'Chapel', 'Buildings', [...house(6, 10, 5, '#e3ded2', '#5a4a44', { chimney: false }), shade(box(2.6, 9.4, 2.6, 0, 4.7, -5.6, '#e3ded2'), 0.12), box(2.9, 0.25, 2.9, 0, 9.5, -5.6, '#cfc9bb'), { g: 'cone', s: [2.0, 3.6, 4], p: [0, 11.4, -5.6], c: '#5a4a44', r: [0, Math.PI / 4, 0] },
    box(0.1, 1.1, 0.1, 0, 13.7, -5.6, '#d9c38a'), box(0.55, 0.1, 0.1, 0, 13.9, -5.6, '#d9c38a'), ...[-1, 1].flatMap((sx) => [-2.5, 0.5, 3].map((z) => box(0.08, 2.4, 0.7, sx * 3.02, 3, z, '#6f9fc4'))), box(0.9, 1.2, 0.08, 0, 7.4, -4.28, '#3d3a36'), box(1.5, 0.1, 0.4, 0, 2.5, 5.2, '#5a4a44')]),
  P('ruin_wall', 'Ruined wall', 'Buildings', [shade(taper(4, 2.4, 0.55, 0, 1.2, 0, '#8d877b', 0.96, 0.9), 0.3, 0.08), shade(box(1.4, 1, 0.5, -1.3, 2.9, 0, '#878175', [0, 0.04, 0.03]), 0.2, 0.08), box(0.8, 0.5, 0.5, 0.2, 2.65, 0, '#847e73', [0, -0.05, -0.04]), box(0.6, 0.35, 0.48, 1.3, 2.55, 0, '#8a8478', [0, 0.1, 0.08]),
    box(0.9, 1.3, 0.1, 0.9, 1.25, 0.26, '#6f6a60'), ...[[1.9, 0.6, 0.35], [-2.3, 0.5, 0.28], [0.6, 0.9, 0.22], [-1.1, -0.7, 0.3], [2.4, -0.4, 0.2]].map(([x, z, r]) => ico(r, x, r * 0.5, z, '#7d776c', [1.1, 0.7, 1], 0.3, 0, 0.1, 0.3))]),
  // Furniture
  P('table', 'Table', 'Furniture', [box(1.6, 0.06, 0.9, 0, 0.75, 0, WOOD), box(1.44, 0.1, 0.74, 0, 0.67, 0, DARK), ...legs(1.6, 0.9, 0.72, DARK, 0.07)]),
  P('chair', 'Chair', 'Furniture', [box(0.45, 0.05, 0.45, 0, 0.45, 0, WOOD), box(0.4, 0.06, 0.4, 0, 0.5, 0, '#6f8a5c'), ...legs(0.45, 0.45, 0.45, DARK, 0.04), box(0.04, 0.55, 0.04, -0.2, 0.75, -0.2, DARK), box(0.04, 0.55, 0.04, 0.2, 0.75, -0.2, DARK), box(0.44, 0.1, 0.03, 0, 0.98, -0.2, WOOD), box(0.44, 0.08, 0.03, 0, 0.78, -0.2, WOOD)]),
  P('sofa', 'Sofa', 'Furniture', [box(2, 0.3, 0.9, 0, 0.25, 0, '#52647d'), box(0.9, 0.16, 0.66, -0.46, 0.47, 0.08, '#6a7f9c'), box(0.9, 0.16, 0.66, 0.46, 0.47, 0.08, '#6a7f9c'), box(2, 0.6, 0.22, 0, 0.7, -0.34, '#52647d'), box(0.88, 0.42, 0.16, -0.46, 0.75, -0.2, '#6a7f9c', [-0.15, 0, 0]), box(0.88, 0.42, 0.16, 0.46, 0.75, -0.2, '#6a7f9c', [-0.15, 0, 0]),
    box(0.2, 0.5, 0.9, -0.99, 0.45, 0, '#4a5b72'), box(0.2, 0.5, 0.9, 0.99, 0.45, 0, '#4a5b72'), ...legs(2.1, 0.9, 0.1, '#2f2a25', 0.07), box(0.36, 0.3, 0.1, 0.62, 0.62, 0.02, '#d9a23f', [-0.4, 0.3, 0])]),
  P('bed', 'Bed', 'Furniture', [box(1.6, 0.22, 2.1, 0, 0.3, 0, DARK), ...legs(1.6, 2.1, 0.2, '#4f3b28', 0.08), box(1.5, 0.2, 2.0, 0, 0.5, 0, '#eeeae2'), box(1.54, 0.1, 1.3, 0, 0.62, 0.35, '#7c93b0'), box(1.54, 0.12, 0.2, 0, 0.64, -0.36, '#e6eef7'), box(1.6, 1.0, 0.1, 0, 0.7, -1.05, DARK), box(1.44, 0.6, 0.04, 0, 0.82, -0.99, WOOD), box(1.6, 0.45, 0.08, 0, 0.42, 1.05, DARK),
    box(0.58, 0.13, 0.36, -0.37, 0.67, -0.72, WHITE, [0, 0.06, 0]), box(0.58, 0.13, 0.36, 0.37, 0.67, -0.72, WHITE, [0, -0.05, 0])]),
  P('desk', 'Office desk', 'Furniture', [box(1.5, 0.05, 0.7, 0, 0.74, 0, '#c9c4b8'), box(0.05, 0.72, 0.66, -0.7, 0.36, 0, STEEL), box(0.42, 0.6, 0.62, 0.5, 0.42, 0, '#aeb3b8'), ...[0.58, 0.4, 0.22].map((y) => box(0.36, 0.02, 0.02, 0.5, y, 0.32, '#6f757c')), box(0.56, 0.34, 0.03, -0.1, 1.02, -0.18, '#16181c'), box(0.5, 0.28, 0.01, -0.1, 1.02, -0.162, '#4a7fb5'),
    box(0.06, 0.12, 0.05, -0.1, 0.82, -0.2, '#2a2e35'), box(0.22, 0.02, 0.14, -0.1, 0.775, -0.2, '#2a2e35'), box(0.42, 0.02, 0.14, -0.1, 0.775, 0.1, '#2a2e35'), box(0.07, 0.03, 0.1, 0.24, 0.78, 0.1, '#2a2e35'), cyl(0.04, 0.035, 0.1, -0.55, 0.82, 0.15, '#c9423a', undefined, 6)]),
  P('bookshelf', 'Bookshelf', 'Furniture', [box(1.2, 2, 0.04, 0, 1, -0.16, '#5c452e'), box(0.05, 2, 0.35, -0.6, 1, 0, DARK), box(0.05, 2, 0.35, 0.6, 1, 0, DARK), ...[0.03, 0.5, 0.97, 1.44, 1.97].map((y) => box(1.2, 0.05, 0.35, 0, y, 0, DARK)),
    ...[0, 1, 2, 3].flatMap((sh) => Array.from({ length: 8 }, (_, i) => { const hh = 0.26 + ((i * 7 + sh * 3) % 5) * 0.03, w = 0.09 + ((i + sh) % 3) * 0.025; return box(w, hh, 0.22, -0.5 + i * 0.138, 0.055 + sh * 0.47 + hh / 2, 0.02, ['#a44a3f', '#3f6ea4', '#5a8a4a', '#c9a23f', '#7c5a8e', '#d9d2c0', '#3d7a7a', '#b0683a'][(i * 3 + sh * 5) % 8], [0, 0, i === 5 && sh % 2 ? 0.12 : 0]); }))]),
  P('wardrobe', 'Wardrobe', 'Furniture', [box(1.3, 0.1, 0.6, 0, 0.05, 0, '#4f3b28'), box(1.3, 2, 0.6, 0, 1.1, 0, '#7b5d40'), box(1.36, 0.06, 0.64, 0, 2.13, 0, DARK), box(0.6, 1.86, 0.03, -0.31, 1.1, 0.305, WOOD), box(0.6, 1.86, 0.03, 0.31, 1.1, 0.305, WOOD), box(0.44, 1.5, 0.02, -0.31, 1.15, 0.32, '#93714c'), box(0.44, 1.5, 0.02, 0.31, 1.15, 0.32, '#93714c'), box(0.025, 0.2, 0.04, -0.06, 1.1, 0.34, '#d9c38a'), box(0.025, 0.2, 0.04, 0.06, 1.1, 0.34, '#d9c38a')]),
  P('kitchen_counter', 'Kitchen counter', 'Furniture', [box(2, 0.1, 0.56, 0, 0.05, -0.02, '#3a3f47'), box(2, 0.76, 0.6, 0, 0.48, 0, '#e6e2d8'), box(2.04, 0.05, 0.66, 0, 0.885, 0, '#3f4347'), ...[-0.75, -0.25, 0.25, 0.75].flatMap((x) => [box(0.46, 0.66, 0.02, x, 0.48, 0.31, '#f1eee6'), box(0.14, 0.02, 0.03, x, 0.76, 0.33, STEEL)]),
    box(0.5, 0.02, 0.4, 0.55, 0.915, 0, '#b9bec4'), box(0.42, 0.01, 0.32, 0.55, 0.9, 0, '#7d8388'), cyl(0.015, 0.015, 0.22, 0.55, 1.02, -0.24, STEEL, undefined, 5), cyl(0.015, 0.015, 0.14, 0.55, 1.12, -0.18, STEEL, [H, 0, 0], 5), ...[[-0.72, -0.12], [-0.38, -0.12], [-0.72, 0.14], [-0.38, 0.14]].map(([x, z]) => cyl(0.1, 0.1, 0.012, x, 0.916, z, '#1c1d1f', undefined, 8))]),
  P('fridge', 'Refrigerator', 'Furniture', [box(0.75, 1.85, 0.66, 0, 0.925, -0.02, '#c9cdd0'), box(0.73, 0.62, 0.04, 0, 1.52, 0.33, '#e3e6e8'), box(0.73, 1.16, 0.04, 0, 0.61, 0.33, '#e3e6e8'), box(0.03, 0.4, 0.04, -0.3, 1.5, 0.37, STEEL), box(0.03, 0.6, 0.04, -0.3, 0.85, 0.37, STEEL), box(0.7, 0.04, 0.6, 0, 0.02, 0, '#3a3f47')]),
  P('toilet', 'Toilet', 'Furniture', [cyl(0.15, 0.18, 0.22, 0, 0.11, 0, WHITE), cyl(0.21, 0.15, 0.2, 0, 0.3, 0.05, WHITE, undefined, 10), cyl(0.22, 0.22, 0.03, 0, 0.415, 0.05, '#e6e6e2', undefined, 10), cyl(0.15, 0.15, 0.032, 0, 0.42, 0.05, '#bcdcea', undefined, 10), box(0.42, 0.36, 0.17, 0, 0.6, -0.24, WHITE), box(0.44, 0.03, 0.19, 0, 0.795, -0.24, '#e6e6e2'), box(0.05, 0.02, 0.03, 0.12, 0.82, -0.24, STEEL)]),
  P('bathtub', 'Bathtub', 'Furniture', [taper(0.7, 0.5, 1.6, 0, 0.3, 0, '#f4f4f2', 1.14, 1.06), box(0.84, 0.05, 1.74, 0, 0.57, 0, WHITE), box(0.62, 0.02, 1.5, 0, 0.585, 0, '#bcdcea'), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => sph(0.06, a * 0.28, 0.05, b * 0.68, '#d9c38a')), cyl(0.018, 0.018, 0.24, 0, 0.72, -0.8, STEEL, undefined, 5), cyl(0.018, 0.018, 0.14, 0, 0.82, -0.74, STEEL, [H, 0, 0], 5)]),
  P('sink', 'Sink', 'Furniture', [cyl(0.07, 0.1, 0.72, 0, 0.36, -0.05, '#e2e2de'), taper(0.44, 0.18, 0.34, 0, 0.8, 0, WHITE, 1.36, 1.36), box(0.5, 0.01, 0.36, 0, 0.892, 0.01, '#bcdcea'), cyl(0.015, 0.015, 0.16, 0, 0.98, -0.18, STEEL, undefined, 5), cyl(0.015, 0.015, 0.1, 0, 1.05, -0.14, STEEL, [H, 0, 0], 5), box(0.5, 0.6, 0.02, 0, 1.55, -0.24, '#bfe3f2'), box(0.56, 0.66, 0.015, 0, 1.55, -0.25, STEEL)]),
  P('school_desk', 'School desk', 'Furniture', [box(0.7, 0.04, 0.5, 0, 0.7, 0, '#c9a878'), box(0.62, 0.1, 0.4, 0, 0.62, 0, '#8a8f96'), ...legs(0.7, 0.5, 0.68, '#6f757c', 0.03), box(0.4, 0.04, 0.4, 0, 0.42, 0.6, '#3f6ea4'), box(0.4, 0.3, 0.03, 0, 0.72, 0.79, '#3f6ea4'), ...move(legs(0.4, 0.4, 0.4, '#6f757c', 0.03), 0, 0, 0.6), box(0.03, 0.34, 0.03, -0.17, 0.58, 0.79, '#6f757c'), box(0.03, 0.34, 0.03, 0.17, 0.58, 0.79, '#6f757c')]),
  P('blackboard', 'Blackboard', 'Furniture', [box(3.1, 1.4, 0.05, 0, 1.6, -0.01, WOOD), box(3, 1.3, 0.06, 0, 1.6, 0, '#27382f'), box(3.1, 0.05, 0.12, 0, 0.92, 0.04, DARK), box(0.1, 0.025, 0.025, -0.6, 0.955, 0.05, WHITE), box(0.08, 0.025, 0.025, -0.3, 0.955, 0.06, '#e8c33d'), box(0.18, 0.05, 0.08, 0.9, 0.97, 0.05, '#5a5f66'), box(1.1, 0.012, 0.005, -0.7, 1.9, 0.032, '#c9d2cc'), box(0.7, 0.012, 0.005, -0.9, 1.72, 0.032, '#c9d2cc')]),
  // Office
  P('office_desk', 'Office desk', 'Office', officeDesk()),
  P('desk_l', 'Corner desk', 'Office', [box(1.8, 0.04, 0.75, 0, 0.74, 0, '#c9a878'), box(0.75, 0.04, 1.1, -0.525, 0.74, 0.925, '#c9a878'), box(0.04, 0.72, 0.7, 0.86, 0.36, 0, METAL), box(0.7, 0.72, 0.04, -0.525, 0.36, 1.44, METAL), box(0.04, 0.72, 0.04, -0.86, 0.36, -0.33, METAL), box(1.7, 0.26, 0.02, 0, 0.56, -0.35, '#b08f60'), ...drawers(0.55, 0, 0.42, 0.66, 0.62, 3, '#8a8f96'),
    cyl(0.03, 0.03, 0.012, -0.3, 0.766, -0.25, CASE, undefined, 8)]),
  P('desk_exec', 'Executive desk', 'Office', [box(2, 0.06, 0.95, 0, 0.75, 0, '#5c3d26'), box(1.86, 0.02, 0.8, 0, 0.785, 0, '#2f4a3a'), ...drawers(-0.68, 0, 0.52, 0.84, 0.66, 3, '#6e4a2e'), ...drawers(0.68, 0, 0.52, 0.84, 0.66, 2, '#6e4a2e'), box(0.86, 0.5, 0.03, 0, 0.45, -0.4, '#6e4a2e'), box(2.04, 0.04, 0.99, 0, 0.02, 0, '#4a3020')]),
  P('office_chair', 'Office chair', 'Office', officeChair(), { collider: [0.55, 1.2, 0.55] }),
  P('visitor_chair', 'Visitor chair', 'Office', [...[-1, 1].flatMap((sx) => [box(0.03, 0.44, 0.03, sx * 0.24, 0.22, 0.2, ALU), box(0.03, 0.86, 0.03, sx * 0.24, 0.43, -0.22, ALU, [-0.08, 0, 0]), box(0.03, 0.03, 0.46, sx * 0.24, 0.015, 0, ALU)]), box(0.5, 0.06, 0.46, 0, 0.46, 0, '#3f6ea4'), box(0.5, 0.36, 0.05, 0, 0.78, -0.25, '#3f6ea4', [-0.08, 0, 0])]),
  P('meeting_table', 'Meeting table', 'Office', [box(2.4, 0.05, 1.15, 0, 0.74, 0, '#b08f60'), { g: 'cyl', s: [0.575, 0.575, 0.05, 16], p: [-1.2, 0.74, 0], c: '#b08f60' }, { g: 'cyl', s: [0.575, 0.575, 0.05, 16], p: [1.2, 0.74, 0], c: '#b08f60' }, ...[-0.9, 0.9].flatMap((x) => [box(0.14, 0.68, 0.5, x, 0.37, 0, METAL), box(0.5, 0.04, 0.8, x, 0.02, 0, METAL)]),
    box(0.5, 0.012, 0.16, 0, 0.771, 0, CASE), ...[-0.15, 0, 0.15].map((x) => box(0.05, 0.006, 0.05, x, 0.779, 0, '#3d424a')), cyl(0.09, 0.07, 0.05, 0.9, 0.79, 0, CASE, undefined, 10)]),
  P('reception_desk', 'Reception desk', 'Office', [box(2.6, 1.1, 0.14, 0, 0.55, 0.45, '#e9e5dc'), box(2.6, 0.12, 0.15, 0, 0.5, 0.455, '#e8a33d'), box(2.7, 0.05, 0.42, 0, 1.125, 0.34, '#3a3f47'), box(0.14, 1.1, 0.9, -1.23, 0.55, 0, '#e9e5dc'), box(0.14, 1.1, 0.9, 1.23, 0.55, 0, '#e9e5dc'), box(2.32, 0.04, 0.72, 0, 0.74, 0, '#c9c4b8'),
    ...move(flip(monitor()), -0.5, 0.76, 0.05), ...drawers(0.8, -0.05, 0.42, 0.6, 0.66, 3, '#aeb3b8')]),
  P('filing_cabinet', 'Filing cabinet', 'Office', [...drawers(0, 0, 0.46, 0.6, 1.3, 4, '#8f969d'), box(0.48, 0.03, 0.62, 0, 0.015, 0, '#3a3f47'), ...[0, 1, 2, 3].map((i) => box(0.1, 0.045, 0.006, 0, 0.03 + 0.325 * (i + 0.4), 0.314, WHITE)), cyl(0.012, 0.012, 0.01, 0.17, 1.26, 0.31, '#d9c38a', [H, 0, 0], 6)]),
  P('lockers', 'Lockers', 'Office', [box(0.92, 1.8, 0.45, 0, 0.94, 0, '#5f7a94'), box(0.94, 0.04, 0.47, 0, 0.02, 0, METAL), ...[-0.3, 0, 0.3].flatMap((x) => [box(0.28, 1.72, 0.012, x, 0.94, 0.23, '#6f8ca8'), ...[1.6, 1.56, 1.52].map((y) => box(0.18, 0.012, 0.006, x, y, 0.238, '#3d5166')), box(0.02, 0.08, 0.02, x + 0.1, 0.95, 0.24, ALU), box(0.08, 0.04, 0.004, x, 1.38, 0.238, WHITE)])]),
  P('bookcase_office', 'Binder shelf', 'Office', [box(0.9, 1.9, 0.03, 0, 0.95, -0.17, '#c9c4b8'), box(0.03, 1.9, 0.36, -0.45, 0.95, 0, '#d9d4c8'), box(0.03, 1.9, 0.36, 0.45, 0.95, 0, '#d9d4c8'), ...[0.02, 0.4, 0.78, 1.16, 1.54, 1.89].map((y) => box(0.9, 0.03, 0.36, 0, y, 0, '#d9d4c8')),
    ...[0, 1, 2, 3].flatMap((sh) => Array.from({ length: 7 }, (_, i) => (sh === 3 && i > 3 ? [] : [box(0.075, 0.31, 0.27, -0.36 + i * 0.105, 0.2 + sh * 0.38, 0.01, ['#2d4a6e', '#8a2632', '#2d6a4f', '#3a3f47', '#b5803a'][(i + sh * 2) % 5], [0, 0, sh === 2 && i === 6 ? 0.2 : 0]), box(0.04, 0.07, 0.004, -0.36 + i * 0.105, 0.26 + sh * 0.38, 0.147, WHITE)])).flat()), box(0.3, 0.2, 0.22, 0.2, 1.3, 0, '#a1805c')]),
  P('cubicle_panel', 'Cubicle panel', 'Office', [box(1.6, 1.42, 0.05, 0, 0.78, 0, '#7f8ea0'), box(1.66, 0.05, 0.07, 0, 1.515, 0, ALU), box(0.05, 1.5, 0.07, -0.81, 0.75, 0, ALU), box(0.05, 1.5, 0.07, 0.81, 0.75, 0, ALU), box(1.6, 0.08, 0.06, 0, 0.06, 0, METAL), box(0.06, 0.03, 0.4, -0.7, 0.015, 0, METAL), box(0.06, 0.03, 0.4, 0.7, 0.015, 0, METAL), box(0.4, 0.28, 0.01, -0.3, 1.15, 0.03, WHITE), box(0.2, 0.2, 0.01, 0.25, 1.2, 0.03, '#f0e08a')]),
  P('whiteboard', 'Whiteboard', 'Office', [box(1.86, 1.16, 0.03, 0, 1.6, -0.005, ALU), box(1.8, 1.1, 0.035, 0, 1.6, 0, '#f7f8f8'), box(1.86, 0.04, 0.1, 0, 1.02, 0.04, ALU), ...[['#d93f3f', -0.5], ['#2d5dc2', -0.38], ['#2d8a5a', -0.26]].map(([c, x]) => cyl(0.012, 0.012, 0.1, x as number, 1.05, 0.05, c as string, [0, 0, H], 5)), box(0.12, 0.04, 0.06, 0.6, 1.06, 0.05, '#3a3f47'),
    box(0.7, 0.014, 0.004, -0.4, 1.95, 0.02, '#2d5dc2'), box(0.5, 0.014, 0.004, -0.5, 1.85, 0.02, '#2d5dc2'), box(0.014, 0.5, 0.004, 0.3, 1.55, 0.02, '#3a3f47'), box(0.6, 0.014, 0.004, 0.6, 1.3, 0.02, '#3a3f47'), ...[[0.4, 0.16], [0.52, 0.3], [0.64, 0.22], [0.76, 0.42]].map(([x, h]) => box(0.08, h, 0.004, x, 1.31 + h / 2, 0.02, '#d93f3f')), box(0.34, 0.2, 0.004, -0.45, 1.45, 0.02, '#f0e08a')], { collider: 'none' }),
  P('notice_board', 'Notice board', 'Office', [box(1.26, 0.86, 0.03, 0, 1.6, 0, '#7b5d40'), box(1.2, 0.8, 0.035, 0, 1.6, 0, '#c49a6c'), ...[[-0.38, 1.76, 0.3, 0.22, WHITE, 0.05], [0.05, 1.78, 0.24, 0.3, '#f0e08a', -0.04], [0.4, 1.72, 0.26, 0.2, '#cfe6f5', 0.03], [-0.3, 1.42, 0.22, 0.28, '#f5d0d0', -0.06], [0.2, 1.4, 0.36, 0.24, WHITE, 0.02]].flatMap(([x, y, w, h, c, r]) => [box(w as number, h as number, 0.004, x as number, y as number, 0.02, c as string, [0, 0, r as number]), sph(0.014, x as number, (y as number) + (h as number) / 2 - 0.02, 0.026, '#d93f3f')])], { collider: 'none' }),
  P('water_cooler', 'Water cooler', 'Office', [box(0.32, 0.95, 0.32, 0, 0.475, 0, '#eceff1'), box(0.34, 0.03, 0.34, 0, 0.015, 0, '#b9bec4'), box(0.24, 0.2, 0.02, 0, 0.72, 0.165, '#cfd4d8'), box(0.03, 0.05, 0.04, -0.05, 0.78, 0.18, '#2d5dc2'), box(0.03, 0.05, 0.04, 0.05, 0.78, 0.18, '#d93f3f'), box(0.2, 0.015, 0.1, 0, 0.62, 0.2, '#8a8f96'),
    cyl(0.06, 0.1, 0.06, 0, 0.98, 0, '#9fd0e8', undefined, 10), cyl(0.135, 0.135, 0.3, 0, 1.16, 0, '#9fd0e8', undefined, 10), cyl(0.1, 0.135, 0.05, 0, 1.335, 0, '#8cc4de', undefined, 10), cyl(0.04, 0.06, 0.3, 0.2, 0.75, 0, WHITE, undefined, 6)]),
  P('copier', 'Photocopier', 'Office', [box(0.62, 0.62, 0.56, 0, 0.33, 0, '#d9dde0'), box(0.64, 0.04, 0.58, 0, 0.02, 0, '#3a3f47'), ...[0.14, 0.34].flatMap((y) => [box(0.56, 0.16, 0.012, 0, y, 0.286, '#eceff1'), box(0.16, 0.02, 0.02, 0, y + 0.03, 0.296, '#8a8f96')]), box(0.64, 0.2, 0.58, 0, 0.74, 0, '#c4c9cd'), box(0.6, 0.04, 0.5, -0.01, 0.86, -0.03, '#eceff1'),
    box(0.3, 0.07, 0.12, 0.14, 0.86, 0.25, '#2a2e35', [0.5, 0, 0]), box(0.12, 0.05, 0.006, 0.1, 0.875, 0.3, SCREEN_HI, [0.5, 0, 0]), box(0.03, 0.03, 0.01, 0.24, 0.87, 0.31, '#3fd96a', [0.5, 0, 0]), box(0.32, 0.02, 0.3, -0.46, 0.62, 0, '#b9bec4', [0, 0, 0.2]), box(0.26, 0.01, 0.21, -0.45, 0.64, 0, WHITE, [0, 0, 0.2])]),
  P('desk_printer', 'Printer', 'Office', [box(0.42, 0.16, 0.34, 0, 0.08, 0, '#e3e6e8'), box(0.42, 0.03, 0.3, 0, 0.175, -0.02, '#2a2e35'), box(0.3, 0.01, 0.22, 0, 0.2, -0.16, WHITE, [-0.9, 0, 0]), box(0.3, 0.012, 0.16, 0, 0.05, 0.24, '#b9bec4'), box(0.26, 0.006, 0.14, 0, 0.06, 0.22, WHITE), box(0.08, 0.02, 0.006, 0.13, 0.12, 0.172, SCREEN_HI), box(0.02, 0.02, 0.008, -0.15, 0.12, 0.172, '#3fd96a')], { collider: 'none' }),
  P('coffee_machine', 'Coffee machine', 'Office', [box(0.26, 0.04, 0.32, 0, 0.02, 0, '#1c1d1f'), box(0.26, 0.36, 0.14, 0, 0.2, -0.09, '#2a2e35'), box(0.26, 0.1, 0.32, 0, 0.36, 0, '#2a2e35'), box(0.2, 0.012, 0.16, 0, 0.046, 0.06, ALU), cyl(0.025, 0.02, 0.05, 0, 0.29, 0.07, ALU, undefined, 6), cyl(0.04, 0.03, 0.07, 0, 0.087, 0.07, WHITE, undefined, 8),
    cyl(0.085, 0.085, 0.22, 0, 0.3, -0.09, '#6fb5d6', undefined, 8), box(0.03, 0.03, 0.01, -0.07, 0.36, 0.162, '#3fd96a'), box(0.03, 0.03, 0.01, 0.07, 0.36, 0.162, '#e8a33d')], { collider: 'none' }),
  P('desk_phone', 'Desk phone', 'Office', [taper(0.2, 0.05, 0.2, 0, 0.025, 0, '#2a2e35', 1, 0.7), box(0.055, 0.03, 0.2, -0.065, 0.065, 0, '#1c1d1f', [0.12, 0, 0]), box(0.09, 0.006, 0.05, 0.035, 0.056, -0.04, SCREEN_HI, [0.25, 0, 0]), ...[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => box(0.02, 0.006, 0.02, 0.01 + c * 0.028, 0.05 - r * 0.004, 0.005 + r * 0.03, '#8a8f96', [0.25, 0, 0])))], { collider: 'none' }),
  P('desk_lamp', 'Desk lamp', 'Office', [cyl(0.08, 0.09, 0.02, 0, 0.01, 0, CASE, undefined, 10), cyl(0.012, 0.012, 0.3, 0.05, 0.15, 0, ALU, [0, 0, -0.35], 5), cyl(0.012, 0.012, 0.28, 0.03, 0.39, 0, ALU, [0, 0, 0.65], 5), cyl(0.03, 0.075, 0.1, -0.1, 0.47, 0, CASE, [0, 0, 0.9], 8), sph(0.03, -0.12, 0.45, 0, '#fff6d8')], { collider: 'none', light: { pos: [-0.14, 0.42, 0], color: '#ffe9c4', intensity: 3, range: 4 } }),
  P('waste_bin', 'Waste bin', 'Office', [cyl(0.15, 0.12, 0.3, 0, 0.15, 0, '#3a3f47', undefined, 10), cyl(0.155, 0.155, 0.015, 0, 0.3, 0, '#2a2e35', undefined, 10), ico(0.06, 0.03, 0.29, 0.02, WHITE, [1, 0.6, 1], 0.3, 0), ico(0.05, -0.05, 0.28, -0.03, '#f0e08a', [1, 0.6, 1], 0.3, 0)], { collider: 'none' }),
  P('workstation', 'Workstation (complete)', 'Office', [...officeDesk(), ...move(monitor(), -0.15, 0.76, -0.16), ...move(keyboardMouse(), -0.12, 0.76, 0.14), ...move(pcTower(), -0.52, 0, -0.05), ...move(flip(officeChair()), -0.1, 0, 0.72), cyl(0.04, 0.035, 0.09, 0.5, 0.805, 0.2, WHITE, undefined, 8), box(0.21, 0.004, 0.297, 0.5, 0.762, -0.1, WHITE, [0, 0.2, 0])], { collider: [1.6, 0.78, 0.75] }),
  // Computers
  P('pc_tower', 'Desktop PC', 'Computers', pcTower()),
  P('monitor', 'Monitor', 'Computers', monitor(), { collider: 'none' }),
  P('monitor_dual', 'Dual monitors', 'Computers', [...move(turn(monitor(), 0.22), -0.29, 0, 0.03), ...move(turn(monitor(), -0.22), 0.29, 0, 0.03)], { collider: 'none' }),
  P('monitor_wide', 'Ultrawide monitor', 'Computers', monitor(0.86, 0.36), { collider: 'none' }),
  P('laptop', 'Laptop', 'Computers', [box(0.34, 0.016, 0.24, 0, 0.008, 0, ALU), box(0.3, 0.004, 0.11, 0, 0.018, -0.04, '#2a2e35'), ...[-0.07, -0.04, -0.01].map((z) => box(0.28, 0.003, 0.02, 0, 0.021, z, '#4a5058')), box(0.1, 0.003, 0.06, 0, 0.018, 0.07, '#a4a9ae'),
    box(0.34, 0.22, 0.01, 0, 0.016 + 0.105, -0.12 - 0.0325, ALU, [-0.3, 0, 0]), box(0.32, 0.2, 0.004, 0, 0.016 + 0.105 + 0.002, -0.12 - 0.0325 + 0.006, SCREEN, [-0.3, 0, 0]), box(0.14, 0.1, 0.003, -0.06, 0.016 + 0.12 + 0.003, -0.12 - 0.037 + 0.009, SCREEN_HI, [-0.3, 0, 0])], { collider: 'none' }),
  P('keyboard_mouse', 'Keyboard and mouse', 'Computers', keyboardMouse(), { collider: 'none' }),
  P('tablet', 'Tablet on stand', 'Computers', [box(0.12, 0.01, 0.1, 0, 0.005, 0, ALU), box(0.03, 0.12, 0.012, 0, 0.06, -0.03, ALU, [-0.35, 0, 0]), box(0.26, 0.18, 0.01, 0, 0.12, -0.01, CASE, [-0.35, 0, 0]), box(0.24, 0.16, 0.004, 0, 0.122, -0.004, SCREEN_HI, [-0.35, 0, 0])], { collider: 'none' }),
  P('server_rack', 'Server rack', 'Computers', [box(0.62, 0.06, 0.92, 0, 0.03, 0, '#111'), box(0.6, 1.94, 0.9, 0, 1.03, 0, '#1c1e22'), box(0.64, 0.04, 0.94, 0, 2.02, 0, '#111'), box(0.54, 1.84, 0.01, 0, 1.03, 0.452, '#0c0d0f'),
    ...Array.from({ length: 11 }, (_, i) => { const y = 0.22 + i * 0.16, kind = i % 4; return [box(0.5, 0.13, 0.02, 0, y, 0.458, kind === 3 ? '#3a3f47' : '#2a2e35'), ...(kind === 3 ? Array.from({ length: 8 }, (_, k) => box(0.035, 0.03, 0.006, -0.19 + k * 0.054, y, 0.47, '#0c0d0f')) : [box(0.26, 0.09, 0.006, -0.1, y, 0.47, '#15171a'), ...[0, 1, 2].map((k) => box(0.012, 0.012, 0.006, 0.12 + k * 0.03, y + 0.03, 0.47, (i + k) % 3 === 0 ? '#e8a33d' : '#3fd96a')), box(0.07, 0.02, 0.006, 0.15, y - 0.03, 0.47, '#3fd9ff')])]; }).flat(),
    ...[-0.29, 0.29].map((x) => box(0.02, 1.9, 0.03, x, 1.03, 0.455, '#3a3f47')), ...ring(6, (a) => box(0.2, 0.004, 0.02, Math.cos(a) * 0.0, 2.042, -0.3 + (a / (Math.PI * 2)) * 0.6, '#2a2e35'))], { collider: [0.62, 2.04, 0.92] }),
  P('router', 'Wi-Fi router', 'Computers', [taper(0.24, 0.035, 0.16, 0, 0.018, 0, '#eceff1', 0.92, 0.9), ...[-0.09, 0, 0.09].map((x) => cyl(0.006, 0.008, 0.16, x, 0.1, -0.07, '#2a2e35', [-0.15, 0, x * 2], 5)), ...[-0.06, -0.03, 0, 0.03].map((x, i) => box(0.008, 0.004, 0.008, x, 0.037, 0.05, i === 3 ? '#e8a33d' : '#3fd96a'))], { collider: 'none' }),
  P('network_switch', 'Network switch', 'Computers', [box(0.44, 0.045, 0.2, 0, 0.023, 0, '#2a2e35'), ...Array.from({ length: 12 }, (_, i) => [box(0.022, 0.018, 0.006, -0.17 + i * 0.03, 0.022, 0.101, '#0c0d0f'), box(0.006, 0.004, 0.006, -0.17 + i * 0.03, 0.037, 0.101, i % 4 === 1 ? '#e8a33d' : '#3fd96a')]).flat(), box(0.03, 0.02, 0.006, 0.2, 0.022, 0.101, '#3fd9ff')], { collider: 'none' }),
  P('projector', 'Projector', 'Computers', [box(0.3, 0.09, 0.24, 0, 0.06, 0, '#eceff1'), box(0.3, 0.012, 0.24, 0, 0.111, 0, '#cfd4d8'), cyl(0.045, 0.05, 0.05, 0.07, 0.065, 0.13, '#1c1d1f', [H, 0, 0], 10), cyl(0.032, 0.032, 0.052, 0.07, 0.065, 0.132, '#6fb5d6', [H, 0, 0], 10), ...[-0.1, -0.07, -0.04].map((x) => box(0.012, 0.05, 0.004, x, 0.06, 0.121, '#8a8f96')),
    ...[[-0.11, 0.09], [0.11, 0.09], [0, -0.09]].map(([x, z]) => cyl(0.015, 0.015, 0.016, x, 0.008, z, '#1c1d1f', undefined, 6)), box(0.02, 0.006, 0.02, -0.1, 0.12, -0.05, '#3fd96a')], { collider: 'none' }),
  P('projector_screen', 'Projector screen', 'Computers', [cyl(0.02, 0.02, 2.1, 0, 1.05, -0.04, METAL, undefined, 6), ...ring(3, (a) => cyl(0.014, 0.014, 0.7, Math.cos(a) * 0.26, 0.2, -0.04 + Math.sin(a) * 0.26, METAL, [Math.sin(a) * 0.85, 0, -Math.cos(a) * 0.85], 5), 0.5), box(1.9, 0.07, 0.07, 0, 2.12, 0, '#2a2e35'), box(1.84, 1.14, 0.01, 0, 1.5, 0.01, '#15171a'), box(1.76, 1.04, 0.012, 0, 1.51, 0.012, '#f7f8f8'), box(1.84, 0.03, 0.03, 0, 0.92, 0.01, '#2a2e35')], { collider: [1.9, 2.1, 0.5] }),
  P('speakers', 'Desktop speakers', 'Computers', [-0.2, 0.2].flatMap((x) => [box(0.1, 0.18, 0.11, x, 0.09, 0, CASE), cyl(0.034, 0.034, 0.01, x, 0.07, 0.056, '#3d424a', [H, 0, 0], 10), cyl(0.018, 0.018, 0.01, x, 0.14, 0.056, '#3d424a', [H, 0, 0], 8)]), { collider: 'none' }),
  // Vehicles
  P('car', 'Car', 'Vehicles', [box(1.8, 0.5, 4.2, 0, 0.62, 0, '#b5403a'), taper(1.8, 0.14, 4.2, 0, 0.94, 0, '#b5403a', 0.94, 0.97), box(1.7, 0.2, 4.0, 0, 0.36, 0, '#2a2a2c'), taper(1.62, 0.56, 2.3, 0, 1.29, -0.2, '#a53a34', 0.84, 0.66), taper(1.5, 0.44, 2.34, 0, 1.27, -0.2, '#26313c', 0.86, 0.66), box(1.42, 0.03, 1.5, 0, 1.585, -0.2, '#a53a34'),
    ...[-1, 1].flatMap((sx) => [box(0.04, 0.34, 0.7, sx * 0.79, 1.25, 0.22, '#26313c', [0, 0, sx * 0.14]), box(0.04, 0.34, 0.7, sx * 0.79, 1.25, -0.62, '#26313c', [0, 0, sx * 0.14]), box(0.3, 0.12, 0.06, sx * 0.6, 0.78, 2.1, '#fff3c4'), box(0.3, 0.1, 0.06, sx * 0.62, 0.8, -2.1, '#d92b2b'), box(0.12, 0.08, 0.16, sx * 0.96, 1.05, 0.72, '#b5403a'), box(0.02, 0.03, 0.14, sx * 0.905, 0.84, 0.1, '#d9dde0'), box(0.02, 0.03, 0.14, sx * 0.905, 0.84, -0.75, '#d9dde0')]),
    box(1.84, 0.16, 0.14, 0, 0.44, 2.1, '#3a3d42'), box(1.84, 0.16, 0.14, 0, 0.44, -2.1, '#3a3d42'), box(0.9, 0.12, 0.04, 0, 0.66, 2.11, '#1c1d1f'), box(0.44, 0.12, 0.02, 0, 0.6, -2.115, WHITE), ...[[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]].flatMap(([a, b]) => wheel(a * 0.84, 0.34, b, 0.34, 0.22))]),
  P('truck', 'Truck', 'Vehicles', [box(2.1, 0.3, 7, 0, 0.7, -0.2, '#2a2a2c'), box(2.2, 1.2, 2, 0, 1.45, 2.2, '#3f6ea4'), taper(2.2, 0.9, 2, 0, 2.5, 2.2, '#3f6ea4', 0.94, 0.8), box(1.9, 0.62, 0.05, 0, 2.5, 3.13, '#26313c', [-0.22, 0, 0]), box(0.04, 0.56, 1, -1.07, 2.5, 2.25, '#26313c'), box(0.04, 0.56, 1, 1.07, 2.5, 2.25, '#26313c'),
    box(2.3, 2.5, 4.6, 0, 2.1, -1.25, '#e3e3df'), box(2.34, 0.08, 4.64, 0, 0.9, -1.25, '#b9bec4'), box(2.34, 0.08, 4.64, 0, 3.32, -1.25, '#b9bec4'), box(1.0, 2.2, 0.03, -0.55, 2.1, -3.56, '#cfcfca'), box(1.0, 2.2, 0.03, 0.55, 2.1, -3.56, '#cfcfca'), box(0.04, 1.4, 0.04, 0.05, 2, -3.59, STEEL),
    box(2.3, 0.3, 0.2, 0, 0.75, 3.25, '#3a3d42'), box(1.3, 0.5, 0.05, 0, 1.3, 3.21, '#1c1d1f'), ...[-1, 1].flatMap((sx) => [box(0.34, 0.16, 0.06, sx * 0.85, 1.15, 3.22, '#fff3c4'), box(0.2, 0.2, 0.05, sx * 0.95, 1.05, -3.57, '#d92b2b'), box(0.14, 0.34, 0.1, sx * 1.25, 2.4, 3, '#2a2a2c')]), cyl(0.28, 0.28, 0.9, -0.95, 0.75, 0.7, STEEL, [H, 0, 0], 8),
    ...[[-1, 2.2], [1, 2.2], [-1, -1.6], [1, -1.6], [-1, -2.75], [1, -2.75]].flatMap(([a, b]) => wheel(a * 1.02, 0.48, b, 0.48, 0.3))]),
  P('bicycle', 'Bicycle', 'Vehicles', [...[0.52, -0.52].flatMap((z) => [cyl(0.33, 0.33, 0.035, 0, 0.33, z, '#222', [0, 0, H], 14), cyl(0.27, 0.27, 0.04, 0, 0.33, z, '#9aa0a6', [0, 0, H], 14), cyl(0.04, 0.04, 0.08, 0, 0.33, z, '#555b62', [0, 0, H], 6)]),
    box(0.035, 0.035, 0.62, 0, 0.56, -0.02, '#c9423a', [0.62, 0, 0]), box(0.035, 0.035, 0.56, 0, 0.78, -0.05, '#c9423a', [-0.06, 0, 0]), box(0.035, 0.6, 0.035, 0, 0.58, -0.26, '#c9423a', [0.3, 0, 0]), box(0.035, 0.035, 0.36, 0, 0.36, -0.36, '#c9423a'), box(0.035, 0.035, 0.44, 0, 0.56, -0.4, '#c9423a', [-0.75, 0, 0]),
    box(0.035, 0.62, 0.035, 0, 0.62, 0.4, '#8a8f96', [-0.35, 0, 0]), box(0.46, 0.035, 0.035, 0, 0.94, 0.3, '#333'), box(0.035, 0.06, 0.12, -0.22, 0.94, 0.3, '#1c1d1f'), box(0.035, 0.06, 0.12, 0.22, 0.94, 0.3, '#1c1d1f'), taper(0.14, 0.05, 0.26, 0, 0.92, -0.36, '#2a2a2c', 0.8, 0.9), cyl(0.08, 0.08, 0.02, 0.04, 0.34, -0.18, STEEL, [0, 0, H], 8), box(0.1, 0.02, 0.06, 0.12, 0.26, -0.12, '#1c1d1f')], { collider: [0.5, 1, 1.7] }),
  P('boat', 'Rowing boat', 'Vehicles', [box(0.84, 0.06, 2.7, 0, 0.05, -0.2, '#93714c'), ...[-1, 1].flatMap((sx) => [box(0.06, 0.5, 2.7, sx * 0.52, 0.27, -0.2, '#7b5d40', [0, 0, sx * -0.32]), box(0.06, 0.5, 1.12, sx * 0.3, 0.27, 1.6, '#7b5d40', [0, sx * -0.56, sx * -0.32]), box(0.07, 0.05, 2.7, sx * 0.6, 0.52, -0.2, DARK), box(0.07, 0.05, 1.14, sx * 0.34, 0.52, 1.6, DARK, [0, sx * -0.56, 0]),
    cyl(0.02, 0.02, 1.9, sx * 1.1, 0.6, -0.1, '#a1805c', [0.15, 0, sx * 1.25], 5), box(0.02, 0.14, 0.4, sx * 1.95, 0.3, -0.2, '#a1805c', [0.15, 0, sx * 1.25]), cyl(0.03, 0.03, 0.08, sx * 0.6, 0.57, -0.1, STEEL, undefined, 5)]),
    box(1.2, 0.5, 0.06, 0, 0.27, -1.55, '#7b5d40', [0.12, 0, 0]), taper(0.5, 0.06, 0.9, 0, 0.05, 1.55, '#93714c', 1, 1), box(0.08, 0.6, 0.08, 0, 0.3, 2.1, DARK, [-0.3, 0, 0]),
    box(1.06, 0.05, 0.3, 0, 0.36, 0.4, '#a1805c'), box(1.06, 0.05, 0.3, 0, 0.36, -0.7, '#a1805c'), box(0.5, 0.05, 0.3, 0, 0.36, 1.5, '#a1805c')]),
  // Signs & street furniture
  P('sign_post', 'Sign post', 'Signs', [cyl(0.045, 0.055, 2.4, 0, 1.2, 0, BARK, undefined, 6), cone(0.07, 0.12, 0, 2.46, 0, BARK, 6), taper(0.9, 0.2, 0.04, 0.38, 2.1, 0.05, '#2d6a4f', 1, 1), taper(0.2, 0.2, 0.04, 0.93, 2.1, 0.05, '#2d6a4f', 0.05, 1, [0, 0, -H]), box(0.7, 0.04, 0.01, 0.4, 2.1, 0.075, WHITE),
    taper(0.8, 0.2, 0.04, -0.33, 1.8, -0.05, '#b5803a', 1, 1), taper(0.2, 0.2, 0.04, -0.83, 1.8, -0.05, '#b5803a', 0.05, 1, [0, 0, H]), box(0.6, 0.04, 0.01, -0.35, 1.8, -0.025, WHITE)], { collider: [0.2, 2.4, 0.2] }),
  P('stop_sign', 'Stop sign', 'Signs', [cyl(0.04, 0.04, 2.2, 0, 1.1, 0, STEEL, undefined, 6), { g: 'cyl', s: [0.38, 0.38, 0.03, 8], p: [0, 2.1, 0.02], c: WHITE, r: [H, Math.PI / 8, 0] }, { g: 'cyl', s: [0.34, 0.34, 0.035, 8], p: [0, 2.1, 0.025], c: '#c22f2f', r: [H, Math.PI / 8, 0] }, box(0.44, 0.1, 0.01, 0, 2.1, 0.045, WHITE), cyl(0.09, 0.11, 0.06, 0, 0.03, 0, '#77736d', undefined, 6)], { collider: [0.2, 2.2, 0.2] }),
  P('info_board', 'Information board', 'Signs', [box(0.09, 1.9, 0.09, -0.7, 0.95, 0, BARK), box(0.09, 1.9, 0.09, 0.7, 0.95, 0, BARK), box(1.5, 0.9, 0.05, 0, 1.3, 0, DARK), box(1.34, 0.76, 0.02, 0, 1.3, 0.03, '#e9e2cf'), box(0.5, 0.34, 0.01, -0.34, 1.42, 0.045, '#7fa8c4'), ...[1.52, 1.42, 1.32].map((y) => box(0.6, 0.03, 0.01, 0.3, y, 0.045, '#6f6a60')), ...[1.14, 1.06].map((y) => box(1.14, 0.025, 0.01, 0, y, 0.045, '#8d877b')),
    box(1.8, 0.06, 0.5, 0, 2, 0.12, '#5a4028', [0.5, 0, 0]), box(1.8, 0.06, 0.5, 0, 2, -0.12, '#5a4028', [-0.5, 0, 0])]),
  P('bench', 'Bench', 'Street furniture', [...[-0.15, 0, 0.15].map((z) => box(1.6, 0.04, 0.12, 0, 0.45, z, WOOD)), box(1.6, 0.12, 0.04, 0, 0.62, -0.24, WOOD, [-0.2, 0, 0]), box(1.6, 0.12, 0.04, 0, 0.8, -0.28, WOOD, [-0.2, 0, 0]),
    ...[-0.7, 0.7].flatMap((x) => [box(0.06, 0.44, 0.06, x, 0.22, 0.18, METAL), box(0.06, 0.9, 0.06, x, 0.45, -0.24, METAL, [-0.2, 0, 0]), box(0.06, 0.05, 0.5, x, 0.42, -0.02, METAL), box(0.06, 0.04, 0.46, x, 0.66, 0, METAL), box(0.06, 0.24, 0.05, x, 0.55, 0.2, METAL)])]),
  P('street_lamp', 'Street lamp', 'Street furniture', [cyl(0.11, 0.14, 0.4, 0, 0.2, 0, '#2f343b', undefined, 8), cyl(0.05, 0.08, 3.9, 0, 2.3, 0, METAL, undefined, 8), cyl(0.04, 0.045, 0.6, 0.2, 4.35, 0, METAL, [0, 0, -0.8], 6), cyl(0.035, 0.04, 0.45, 0.6, 4.5, 0, METAL, [0, 0, -H], 6),
    taper(0.5, 0.1, 0.24, 0.92, 4.5, 0, '#2f343b', 0.7, 0.7), box(0.4, 0.04, 0.18, 0.92, 4.43, 0, '#fff3c4')], { collider: [0.25, 4.2, 0.25], light: { pos: [0.9, 4.2, 0], color: '#ffe2a8', intensity: 40, range: 18 } }),
  P('trash_bin', 'Trash bin', 'Street furniture', [cyl(0.25, 0.2, 0.78, 0, 0.41, 0, '#3f5a48', undefined, 10), ...ring(10, (a) => box(0.02, 0.6, 0.015, Math.cos(a) * 0.235, 0.42, Math.sin(a) * 0.235, '#34493b', [0, -a + H, 0])), cyl(0.27, 0.27, 0.05, 0, 0.82, 0, '#2d4034', undefined, 10), sph(0.24, 0, 0.85, 0, '#2d4034', [1, 0.45, 1]), box(0.24, 0.07, 0.02, 0, 0.7, 0.245, '#1c1d1f'), cyl(0.18, 0.2, 0.04, 0, 0.02, 0, '#2a2a2c', undefined, 10)]),
  P('fence', 'Fence section', 'Street furniture', [...[-1, 1].flatMap((x) => [box(0.1, 1.1, 0.1, x, 0.55, 0, '#7b5d40'), cone(0.08, 0.1, x, 1.15, 0, '#7b5d40', 4, Math.PI / 4)]), box(2, 0.08, 0.04, 0, 0.85, -0.03, WOOD), box(2, 0.08, 0.04, 0, 0.35, -0.03, WOOD),
    ...[-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75].flatMap((x) => [box(0.1, 0.9, 0.025, x, 0.5, 0.01, '#93714c'), taper(0.1, 0.08, 0.025, x, 0.99, 0.01, '#93714c', 0.05, 1)])]),
  P('hydrant', 'Fire hydrant', 'Street furniture', [cyl(0.17, 0.18, 0.05, 0, 0.025, 0, '#a82626', undefined, 8), cyl(0.11, 0.13, 0.5, 0, 0.3, 0, '#c22f2f', undefined, 8), cyl(0.14, 0.14, 0.04, 0, 0.56, 0, '#a82626', undefined, 8), sph(0.12, 0, 0.6, 0, '#c22f2f', [1, 0.8, 1]), cyl(0.03, 0.03, 0.06, 0, 0.72, 0, '#d9c38a', undefined, 5),
    cyl(0.055, 0.055, 0.36, 0, 0.42, 0, '#a82626', [0, 0, H], 6), cyl(0.07, 0.07, 0.1, 0, 0.36, 0.13, '#a82626', [H, 0, 0], 6), cyl(0.045, 0.045, 0.02, 0, 0.36, 0.19, '#d9c38a', [H, 0, 0], 6)]),
  P('fountain', 'Fountain', 'Street furniture', [cyl(1.95, 2.0, 0.14, 0, 0.07, 0, '#8d8982', undefined, 12), cyl(1.8, 1.9, 0.46, 0, 0.3, 0, '#a7a39a', undefined, 12), cyl(1.92, 1.92, 0.08, 0, 0.54, 0, '#b8b4aa', undefined, 12), cyl(1.6, 1.6, 0.06, 0, 0.5, 0, '#5fa7c9', undefined, 12),
    cyl(0.28, 0.38, 0.5, 0, 0.75, 0, '#a7a39a'), cyl(0.18, 0.24, 0.6, 0, 1.25, 0, '#b0aca2'), cyl(0.8, 0.26, 0.2, 0, 1.62, 0, '#a7a39a', undefined, 10), cyl(0.72, 0.72, 0.04, 0, 1.71, 0, '#6fb5d6', undefined, 10), cyl(0.1, 0.14, 0.4, 0, 1.9, 0, '#b0aca2', undefined, 6), cyl(0.34, 0.12, 0.1, 0, 2.14, 0, '#a7a39a'), ico(0.12, 0, 2.28, 0, '#9fd6ee', [1, 1.3, 1], 0.1, 0, 0.05, 0),
    ...ring(6, (a) => cyl(0.02, 0.05, 0.5, Math.cos(a) * 0.5, 1.95, Math.sin(a) * 0.5, '#bfe3f2', [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], 4))]),
  // Museum objects
  P('pedestal', 'Pedestal', 'Museum objects', [box(0.86, 0.1, 0.86, 0, 0.05, 0, '#d6d2c8'), box(0.76, 0.06, 0.76, 0, 0.13, 0, '#e2dfd6'), shade(box(0.66, 0.78, 0.66, 0, 0.55, 0, '#ebe8e1'), 0.12), box(0.76, 0.05, 0.76, 0, 0.965, 0, '#e2dfd6'), box(0.84, 0.06, 0.84, 0, 1.02, 0, '#d6d2c8')]),
  P('display_case', 'Display case', 'Museum objects', [box(1.26, 0.08, 0.76, 0, 0.04, 0, '#2a2e35'), box(1.2, 0.82, 0.7, 0, 0.49, 0, METAL), box(1.24, 0.04, 0.74, 0, 0.92, 0, '#555b62'), box(1.1, 0.02, 0.6, 0, 0.95, 0, '#7a2632'), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.03, 0.52, 0.03, a * 0.585, 1.2, b * 0.335, STEEL)),
    box(1.2, 0.03, 0.03, 0, 1.46, 0.335, STEEL), box(1.2, 0.03, 0.03, 0, 1.46, -0.335, STEEL), box(0.03, 0.03, 0.7, 0.585, 1.46, 0, STEEL), box(0.03, 0.03, 0.7, -0.585, 1.46, 0, STEEL), box(1.14, 0.5, 0.01, 0, 1.2, -0.33, '#cfeaf5'), box(0.01, 0.5, 0.64, -0.58, 1.2, 0, '#cfeaf5'), box(1.16, 0.01, 0.66, 0, 1.45, 0, '#cfeaf5'),
    ico(0.13, -0.25, 1.08, 0, '#d9b23f', [1, 0.9, 1], 0.2, 0), cyl(0.05, 0.08, 0.2, 0.25, 1.06, 0.05, '#b8704f', undefined, 6), box(0.16, 0.01, 0.08, 0, 0.965, 0.22, WHITE)]),
  P('painting', 'Painting', 'Museum objects', [box(1.6, 1.2, 0.05, 0, 1.6, 0, '#7a5a2e'), box(1.5, 1.1, 0.07, 0, 1.6, 0, '#a1803f'), box(1.36, 0.96, 0.08, 0, 1.6, 0, '#5a4322'), box(1.3, 0.9, 0.085, 0, 1.6, 0, '#7fb2d6'), box(1.3, 0.3, 0.09, 0, 1.3, 0, '#5a8a4a'),
    taper(0.7, 0.42, 0.09, -0.25, 1.66, 0.002, '#5f7f8f', 0.05, 1), taper(0.5, 0.3, 0.09, 0.3, 1.6, 0.003, '#6d8d9a', 0.05, 1), { g: 'cyl', s: [0.09, 0.09, 0.09, 10], p: [0.42, 1.88, 0.004], c: '#f0d060', r: [H, 0, 0] }, box(0.3, 0.06, 0.01, 0, 0.9, 0.02, '#d9c38a')], { collider: 'none' }),
  P('statue', 'Statue', 'Museum objects', [box(0.9, 0.16, 0.9, 0, 0.08, 0, '#77736d'), box(0.76, 0.3, 0.76, 0, 0.31, 0, STONE), ...[-0.11, 0.11].map((x) => cyl(0.075, 0.09, 0.72, x, 0.82, 0, '#cfcabf', undefined, 6)), taper(0.4, 0.2, 0.26, 0, 1.25, 0, '#cfcabf', 0.9, 0.9), shade(taper(0.36, 0.5, 0.24, 0, 1.6, 0, '#cfcabf', 1.25, 1.05), 0.15),
    cyl(0.055, 0.065, 0.56, -0.29, 1.56, 0.02, '#cfcabf', [0, 0, -0.14], 5), cyl(0.055, 0.065, 0.36, 0.3, 1.72, 0.06, '#cfcabf', [0.5, 0, 0.5], 5), cyl(0.05, 0.055, 0.34, 0.42, 1.98, 0.2, '#cfcabf', [0.3, 0, -0.2], 5), cyl(0.06, 0.07, 0.1, 0, 1.9, 0, '#cfcabf', undefined, 6),
    ico(0.15, 0, 2.08, 0, '#d6d1c6', [0.9, 1.1, 1], 0.05, 1, 0.03, 0.1), taper(0.5, 0.9, 0.1, 0.02, 1.2, -0.13, '#c4bfb4', 0.6, 1, [0.06, 0, 0])]),
  P('vase', 'Ancient vase', 'Museum objects', [cyl(0.09, 0.08, 0.04, 0, 0.02, 0, '#8f553d', undefined, 8), cyl(0.17, 0.08, 0.14, 0, 0.11, 0, '#b8704f', undefined, 8), cyl(0.2, 0.17, 0.12, 0, 0.24, 0, '#b8704f', undefined, 8), cyl(0.2, 0.2, 0.03, 0, 0.3, 0, '#3d2e20', undefined, 8), cyl(0.12, 0.2, 0.14, 0, 0.385, 0, '#b8704f', undefined, 8),
    cyl(0.07, 0.12, 0.1, 0, 0.505, 0, '#a5654a', undefined, 8), cyl(0.1, 0.07, 0.05, 0, 0.58, 0, '#a5654a', undefined, 8), ...[-1, 1].flatMap((sx) => [box(0.02, 0.16, 0.03, sx * 0.19, 0.44, 0, '#8f553d'), box(0.1, 0.02, 0.03, sx * 0.14, 0.52, 0, '#8f553d')])]),
  P('rope_barrier', 'Rope barrier', 'Museum objects', [...[-0.9, 0.9].flatMap((x) => [cyl(0.15, 0.17, 0.04, x, 0.02, 0, '#b08d32', undefined, 10), cyl(0.028, 0.035, 0.9, x, 0.47, 0, '#c9a23f', undefined, 6), sph(0.055, x, 0.95, 0, '#d9b54a')]),
    box(0.5, 0.045, 0.045, -0.64, 0.8, 0, '#8a2632', [0, 0, -0.32]), box(0.82, 0.045, 0.045, 0, 0.725, 0, '#8a2632'), box(0.5, 0.045, 0.045, 0.64, 0.8, 0, '#8a2632', [0, 0, 0.32])]),
  P('skeleton_fossil', 'Fossil exhibit', 'Museum objects', [box(2.6, 0.1, 1.1, 0, 0.05, 0, '#2a2e35'), box(2.4, 0.22, 0.9, 0, 0.21, 0, METAL), ...[-0.7, -0.35, 0, 0.35, 0.7].map((x, i) => cyl(0.055, 0.055, 0.34, x, 1.0 + Math.sin(i * 0.8) * 0.06, 0, '#e3dcc8', [0, 0, H], 6)),
    ...[-0.5, -0.25, 0, 0.25].flatMap((x) => [cyl(0.018, 0.018, 0.5, x, 0.8, 0.14, '#e3dcc8', [0.5, 0, 0], 4), cyl(0.018, 0.018, 0.5, x, 0.8, -0.14, '#e3dcc8', [-0.5, 0, 0], 4)]), taper(0.5, 0.22, 0.26, 1.1, 1.1, 0, '#e3dcc8', 0.5, 0.8, [0, 0, -H + 0.2]), box(0.3, 0.05, 0.18, 1.22, 0.98, 0, '#d6cfba'),
    cyl(0.02, 0.05, 0.9, -1.25, 0.85, 0, '#e3dcc8', [0, 0, -1.2], 5), ...[[-0.5, 0.2], [-0.5, -0.2], [0.5, 0.2], [0.5, -0.2]].map(([x, z]) => cyl(0.03, 0.035, 0.6, x, 0.6, z, '#e3dcc8', undefined, 5)), cyl(0.015, 0.015, 0.7, 0, 0.66, 0, STEEL, undefined, 4)]),
  // Interior decorations
  P('rug', 'Rug', 'Interior decorations', [box(2.4, 0.02, 1.6, 0, 0.01, 0, '#8a3a3a'), box(2.1, 0.024, 1.3, 0, 0.012, 0, '#c9a878'), box(1.8, 0.028, 1.0, 0, 0.014, 0, '#8a3a3a'), box(1.5, 0.032, 0.7, 0, 0.016, 0, '#d9c08f'), taper(0.5, 0.036, 0.5, 0, 0.018, 0, '#3f5a7a', 1, 1, [0, Math.PI / 4, 0]),
    ...Array.from({ length: 12 }, (_, i) => [box(0.05, 0.012, 0.03, -1.225, 0.006, -0.72 + i * 0.13, '#e9dfc6'), box(0.05, 0.012, 0.03, 1.225, 0.006, -0.72 + i * 0.13, '#e9dfc6')]).flat()], { collider: 'none' }),
  P('picture_frame', 'Picture frame', 'Interior decorations', [box(0.64, 0.84, 0.03, 0, 1.5, 0, '#2a2a2a'), box(0.56, 0.76, 0.04, 0, 1.5, 0, '#f1ece2'), box(0.4, 0.58, 0.045, 0, 1.5, 0, '#c9b78f'), box(0.4, 0.2, 0.05, 0, 1.31, 0, '#7a8f6a'), ico(0.07, 0.06, 1.62, 0.02, '#b5653f', [1, 1, 0.2], 0, 0, 0, 0)], { collider: 'none' }),
  P('tv', 'Television', 'Interior decorations', [box(1.6, 0.5, 0.42, 0, 0.27, 0, DARK), box(1.6, 0.03, 0.44, 0, 0.535, 0, WOOD), box(0.74, 0.4, 0.02, -0.39, 0.27, 0.215, WOOD), box(0.74, 0.4, 0.02, 0.39, 0.27, 0.215, WOOD), ...legs(1.6, 0.42, 0.04, '#2a2a2c', 0.06),
    box(0.5, 0.025, 0.24, 0, 0.56, 0, '#2a2e35'), box(0.07, 0.16, 0.05, 0, 0.64, -0.02, '#2a2e35'), box(1.3, 0.76, 0.05, 0, 1.08, 0, '#16181c'), box(1.24, 0.7, 0.01, 0, 1.085, 0.027, '#25456b'), box(0.5, 0.3, 0.005, -0.2, 1.15, 0.034, '#3a6fa8'), box(0.03, 0.03, 0.01, 0.6, 0.73, 0.03, '#d93f3f')]),
  P('clock', 'Wall clock', 'Interior decorations', [{ g: 'cyl', s: [0.27, 0.27, 0.05, 20], p: [0, 1.9, 0], c: '#3d2e20', r: [H, 0, 0] }, { g: 'cyl', s: [0.24, 0.24, 0.055, 20], p: [0, 1.9, 0.002], c: '#f2efe6', r: [H, 0, 0] },
    ...ring(12, (a, i) => box(0.012, i % 3 ? 0.03 : 0.05, 0.01, Math.sin(a) * 0.2, 1.9 + Math.cos(a) * 0.2, 0.031, '#222', [0, 0, -a])), box(0.02, 0.13, 0.008, 0.03, 1.95, 0.034, '#222', [0, 0, -0.5]), box(0.014, 0.19, 0.008, -0.07, 1.95, 0.036, '#222', [0, 0, 0.95]), { g: 'cyl', s: [0.018, 0.018, 0.012, 8], p: [0, 1.9, 0.04], c: '#c22f2f', r: [H, 0, 0] }], { collider: 'none' }),
  P('curtains', 'Curtains', 'Interior decorations', [...[-1, 1].flatMap((sx) => Array.from({ length: 5 }, (_, i) => shade(cyl(0.07, 0.085, 2.2, sx * (0.48 + i * 0.11), 1.2, (i % 2) * 0.05, i % 2 ? '#7c5a6e' : '#6d4d60', undefined, 5), 0.25))), ...[-1, 1].map((sx) => box(0.56, 0.06, 0.14, sx * 0.7, 1.0, 0.03, '#d9c38a')),
    cyl(0.02, 0.02, 2.3, 0, 2.34, 0, METAL, [0, 0, H], 6), sph(0.045, -1.17, 2.34, 0, '#d9c38a'), sph(0.045, 1.17, 2.34, 0, '#d9c38a')], { collider: 'none' }),
  // Industrial
  P('crate', 'Crate', 'Industrial equipment', [box(0.94, 0.94, 0.94, 0, 0.5, 0, '#a1805c'), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.1, 1, 0.1, a * 0.45, 0.5, b * 0.45, '#7b5d40')), ...[0.05, 0.95].flatMap((y) => [box(1, 0.1, 0.1, 0, y, 0.45, '#7b5d40'), box(1, 0.1, 0.1, 0, y, -0.45, '#7b5d40'), box(0.1, 0.1, 1, 0.45, y, 0, '#7b5d40'), box(0.1, 0.1, 1, -0.45, y, 0, '#7b5d40')]),
    box(1.2, 0.09, 0.03, 0, 0.5, 0.475, '#8b6a47', [0, 0, 0.72]), box(1.2, 0.09, 0.03, 0, 0.5, -0.475, '#8b6a47', [0, 0, -0.72]), box(0.03, 0.09, 1.2, 0.475, 0.5, 0, '#8b6a47', [0.72, 0, 0]), box(0.03, 0.09, 1.2, -0.475, 0.5, 0, '#8b6a47', [-0.72, 0, 0])]),
  P('barrel', 'Barrel', 'Industrial equipment', [cyl(0.34, 0.3, 0.32, 0, 0.16, 0, '#3f6ea4', undefined, 10), cyl(0.34, 0.34, 0.31, 0, 0.475, 0, '#4577ad', undefined, 10), cyl(0.3, 0.34, 0.32, 0, 0.79, 0, '#3f6ea4', undefined, 10), ...[0.05, 0.32, 0.63, 0.9].map((y, i) => cyl(i % 3 ? 0.35 : 0.315, i % 3 ? 0.35 : 0.315, 0.04, 0, y, 0, '#2c4f77', undefined, 10)),
    cyl(0.27, 0.27, 0.01, 0, 0.94, 0, '#35608f', undefined, 10), cyl(0.04, 0.04, 0.03, 0.15, 0.955, 0.05, '#1c1d1f', undefined, 6)]),
  P('pipe', 'Pipe section', 'Industrial equipment', [cyl(0.2, 0.2, 3, 0, 0.42, 0, STEEL, [0, 0, H], 10), ...[-1.5, 1.5].flatMap((x) => [cyl(0.27, 0.27, 0.08, x, 0.42, 0, '#6f757c', [0, 0, H], 10), ...ring(6, (a) => cyl(0.025, 0.025, 0.1, x, 0.42 + Math.cos(a) * 0.235, Math.sin(a) * 0.235, '#3a3f47', [0, 0, H], 5))]),
    cyl(0.215, 0.215, 0.1, 0, 0.42, 0, '#c9a23f', [0, 0, H], 10), ...[-0.9, 0.9].flatMap((x) => [box(0.12, 0.22, 0.46, x, 0.11, 0, METAL), box(0.14, 0.04, 0.6, x, 0.02, 0, METAL)])]),
  P('generator', 'Generator', 'Industrial equipment', [box(1.9, 0.08, 1.1, 0, 0.3, 0, METAL), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.06, 1.1, 0.06, a * 0.92, 0.85, b * 0.52, METAL)), box(1.9, 0.06, 0.06, 0, 1.4, 0.52, METAL), box(1.9, 0.06, 0.06, 0, 1.4, -0.52, METAL), box(0.06, 0.06, 1.1, 0.92, 1.4, 0, METAL), box(0.06, 0.06, 1.1, -0.92, 1.4, 0, METAL),
    box(1.0, 0.7, 0.8, -0.3, 0.7, 0, '#c9a23f'), box(0.9, 0.2, 0.7, -0.3, 1.14, 0, '#2a2a2c'), cyl(0.05, 0.05, 0.06, -0.55, 1.27, 0.15, '#d93f3f', undefined, 6), cyl(0.3, 0.3, 0.5, 0.55, 0.65, 0, '#555b62', [H, 0, 0], 10), ...ring(8, (a) => box(0.03, 0.1, 0.5, 0.55 + Math.cos(a) * 0.31, 0.65 + Math.sin(a) * 0.31, 0, '#3a3f47', [0, 0, a])),
    cyl(0.05, 0.05, 0.7, 0.75, 1.3, -0.3, METAL, undefined, 6), cyl(0.07, 0.07, 0.12, 0.75, 1.68, -0.3, '#2a2a2c', undefined, 6), box(0.4, 0.3, 0.03, -0.3, 0.75, 0.415, '#22262c'), box(0.1, 0.06, 0.01, -0.4, 0.8, 0.435, '#3fd96a'), box(0.06, 0.06, 0.02, -0.2, 0.72, 0.435, '#d93f3f'), ...wheel(-0.97, 0.16, -0.4, 0.16, 0.08), ...wheel(0.97, 0.16, -0.4, 0.16, 0.08), box(0.06, 0.3, 0.06, 0, 0.15, 0.45, METAL)]),
  P('control_panel', 'Control panel', 'Industrial equipment', [box(1.04, 0.08, 0.54, 0, 0.04, 0, '#2a2e35'), box(1, 0.86, 0.5, 0, 0.5, 0, '#6f757c'), box(0.9, 0.5, 0.01, 0, 0.5, 0.255, '#62686f'), box(1, 0.4, 0.5, 0, 1.05, -0.05, '#555b62', [-0.5, 0, 0]),
    box(0.4, 0.22, 0.02, -0.22, 1.12, 0.1, '#16181c', [-0.5, 0, 0]), box(0.34, 0.16, 0.022, -0.22, 1.125, 0.105, '#2f7f5a', [-0.5, 0, 0]), ...[[0.14, '#d93f3f'], [0.26, '#3fd96a'], [0.38, '#e8c33d']].map(([x, c]) => cyl(0.035, 0.035, 0.03, x as number, 1.19, 0.03, c as string, [-0.5, 0, 0], 8)),
    ...[0.14, 0.26, 0.38].map((x) => box(0.05, 0.02, 0.05, x, 1.08, 0.2, '#22262c', [-0.5, 0, 0])), cyl(0.015, 0.015, 0.14, 0.26, 1.02, 0.34, STEEL, [-0.2, 0, 0], 5), sph(0.03, 0.26, 1.09, 0.33, '#1c1d1f')]),
  P('tank', 'Storage tank', 'Industrial equipment', [...ring(4, (a) => box(0.14, 0.7, 0.14, Math.cos(a) * 1.15, 0.35, Math.sin(a) * 1.15, METAL), Math.PI / 4), cyl(1.4, 1.4, 3, 0, 2.1, 0, '#b9bec4', undefined, 14), cyl(0.9, 1.4, 0.4, 0, 3.8, 0, '#aeb3b8', undefined, 14), cyl(1.4, 0.9, 0.3, 0, 0.5, 0, '#aeb3b8', undefined, 14), ...[1.2, 2.1, 3.0].map((y) => cyl(1.43, 1.43, 0.07, 0, y, 0, '#8a8f96', undefined, 14)),
    cyl(0.3, 0.3, 0.1, 0, 4.05, 0, '#6f757c', undefined, 8), box(0.04, 3.6, 0.04, 1.47, 2.2, 0.2, METAL), box(0.04, 3.6, 0.04, 1.47, 2.2, -0.2, METAL), ...Array.from({ length: 10 }, (_, i) => box(0.03, 0.03, 0.4, 1.47, 0.6 + i * 0.35, 0, METAL)), cyl(0.07, 0.07, 1.2, -1.5, 0.6, 0, '#c9a23f', undefined, 6), cyl(0.07, 0.07, 0.3, -1.4, 1.2, 0, '#c9a23f', [0, 0, H], 6), cyl(0.12, 0.12, 0.03, -1.5, 0.9, 0.1, '#c22f2f', [H, 0, 0], 8)]),
  P('lever', 'Lever', 'Industrial equipment', [box(0.36, 0.05, 0.36, 0, 0.025, 0, '#2a2e35'), taper(0.3, 0.18, 0.3, 0, 0.14, 0, METAL, 0.8, 0.8), box(0.05, 0.02, 0.2, 0, 0.235, 0.02, '#1c1d1f'), cyl(0.022, 0.026, 0.7, 0, 0.52, 0.12, '#b0b5ba', [0.4, 0, 0], 6), sph(0.065, 0, 0.84, 0.26, '#c22f2f'), box(0.2, 0.03, 0.01, 0, 0.12, 0.155, '#e8c33d')]),
  P('button_panel', 'Push button', 'Industrial equipment', [cyl(0.025, 0.025, 1.05, 0, 0.525, -0.03, STEEL, undefined, 5), box(0.27, 0.37, 0.07, 0, 1.2, 0, '#2a2e35'), box(0.24, 0.34, 0.08, 0, 1.2, 0, METAL), cyl(0.085, 0.085, 0.03, 0, 1.23, 0.045, '#e8c33d', [H, 0, 0], 10), cyl(0.06, 0.06, 0.05, 0, 1.23, 0.055, '#d93f3f', [H, 0, 0], 10), box(0.16, 0.05, 0.01, 0, 1.08, 0.042, WHITE)], { collider: 'none' }),
  // Lighting
  P('floor_lamp', 'Floor lamp', 'Lighting', [cyl(0.17, 0.2, 0.04, 0, 0.02, 0, METAL, undefined, 10), cyl(0.05, 0.08, 0.08, 0, 0.08, 0, METAL), cyl(0.018, 0.018, 1.42, 0, 0.8, 0, '#55504a', undefined, 6), cyl(0.03, 0.03, 0.08, 0, 1.5, 0, '#d9c38a', undefined, 6), cyl(0.14, 0.26, 0.34, 0, 1.66, 0, '#f6e7c1', undefined, 10), cyl(0.15, 0.15, 0.015, 0, 1.83, 0, '#e3d2a8', undefined, 10), sph(0.06, 0, 1.6, 0, '#fff6d8')], { light: { pos: [0, 1.55, 0], color: '#ffdca0', intensity: 10, range: 9 } }),
  P('ceiling_light', 'Ceiling light', 'Lighting', [cyl(0.08, 0.08, 0.03, 0, -0.015, 0, METAL), cyl(0.012, 0.012, 0.4, 0, -0.22, 0, METAL, undefined, 4), cyl(0.06, 0.06, 0.06, 0, -0.42, 0, '#2a2e35', undefined, 6), cyl(0.12, 0.32, 0.2, 0, -0.52, 0, '#f6e7c1', undefined, 10), sph(0.07, 0, -0.56, 0, '#fff6d8')], { collider: 'none', light: { pos: [0, -0.6, 0], color: '#fff0d0', intensity: 14, range: 12 } }),
  P('lantern', 'Lantern', 'Lighting', [box(0.26, 0.04, 0.26, 0, 0.02, 0, '#2a2a2a'), box(0.17, 0.28, 0.17, 0, 0.19, 0, '#f6d58a'), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.022, 0.3, 0.022, a * 0.095, 0.19, b * 0.095, '#2a2a2a')), box(0.24, 0.025, 0.24, 0, 0.345, 0, '#2a2a2a'),
    { g: 'cone', s: [0.2, 0.13, 4], p: [0, 0.42, 0], c: '#2a2a2a', r: [0, Math.PI / 4, 0] }, box(0.012, 0.1, 0.012, -0.05, 0.53, 0, '#2a2a2a'), box(0.012, 0.1, 0.012, 0.05, 0.53, 0, '#2a2a2a'), box(0.112, 0.012, 0.012, 0, 0.585, 0, '#2a2a2a')], { collider: 'none', light: { pos: [0, 0.3, 0], color: '#ffb866', intensity: 5, range: 7 } }),
  P('campfire', 'Campfire', 'Lighting', [...ring(8, (a, i) => ico(0.12 + (i % 3) * 0.015, Math.cos(a) * 0.44, 0.07, Math.sin(a) * 0.44, i % 2 ? '#77736d' : '#858079', [1, 0.75, 1], 0.25, 0, 0.08, 0.2)), cyl(0.3, 0.34, 0.03, 0, 0.015, 0, '#2a2622', undefined, 8),
    ...ring(4, (a) => cyl(0.045, 0.055, 0.62, Math.cos(a) * 0.12, 0.24, Math.sin(a) * 0.12, '#4a3424', [Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55], 5), 0.4), cone(0.15, 0.45, 0, 0.32, 0, '#e8642a', 5), cone(0.1, 0.36, 0.05, 0.36, 0.03, '#f0a030', 5, 0.6), cone(0.06, 0.26, -0.03, 0.34, -0.03, '#f6d860', 4, 1.1)], { collider: 'none', light: { pos: [0, 0.5, 0], color: '#ff9340', intensity: 14, range: 11 } }),
  // Architectural components
  P('column', 'Column', 'Architectural components', [box(0.76, 0.14, 0.76, 0, 0.07, 0, '#d0ccc2'), cyl(0.3, 0.34, 0.1, 0, 0.19, 0, '#dcd8ce', undefined, 12), shade(cyl(0.23, 0.28, 2.5, 0, 1.49, 0, '#e8e4da', undefined, 12), 0.14), ...ring(12, (a) => box(0.022, 2.4, 0.022, Math.cos(a) * 0.262, 1.49, Math.sin(a) * 0.262, '#d6d2c8', [0, -a, 0])),
    cyl(0.3, 0.24, 0.1, 0, 2.79, 0, '#dcd8ce', undefined, 12), taper(0.56, 0.1, 0.56, 0, 2.89, 0, '#dcd8ce', 1.25, 1.25), box(0.76, 0.08, 0.76, 0, 2.98, 0, '#d0ccc2')]),
  P('beam', 'Beam', 'Architectural components', [box(4, 0.3, 0.3, 0, 0.15, 0, DARK), box(4, 0.04, 0.34, 0, 0.32, 0, '#5c452e'), ...[-1.9, 1.9].flatMap((x) => [box(0.12, 0.34, 0.34, x, 0.15, 0, METAL), cyl(0.02, 0.02, 0.36, x, 0.22, 0, STEEL, [H, 0, 0], 5), cyl(0.02, 0.02, 0.36, x, 0.08, 0, STEEL, [H, 0, 0], 5)])]),
  P('arch', 'Arch', 'Architectural components', [...[-1.2, 1.2].flatMap((x) => [box(0.66, 0.2, 0.62, x, 0.1, 0, '#c4bfb4'), shade(box(0.52, 1.9, 0.5, x, 1.15, 0, '#d2cdc2'), 0.14), box(0.64, 0.14, 0.6, x, 2.17, 0, '#c4bfb4')]),
    ...Array.from({ length: 7 }, (_, i) => { const a = (Math.PI * (i + 0.5)) / 7; return box(0.6, i === 3 ? 0.56 : 0.48, i === 3 ? 0.56 : 0.5, Math.cos(a) * 1.2, 2.24 + Math.sin(a) * 1.2, 0, i === 3 ? '#bdb8ad' : i % 2 ? '#d2cdc2' : '#cbc6bb', [0, 0, a - H]); })], { collider: 'none' }),
  P('railing', 'Railing', 'Architectural components', [box(2, 0.06, 0.07, 0, 1, 0, METAL), box(2, 0.04, 0.04, 0, 0.12, 0, METAL), box(0.06, 1.02, 0.06, -0.97, 0.51, 0, METAL), box(0.06, 1.02, 0.06, 0.97, 0.51, 0, METAL), ...[-0.75, -0.56, -0.37, -0.19, 0, 0.19, 0.37, 0.56, 0.75].map((x) => box(0.025, 0.86, 0.025, x, 0.56, 0, '#4a5058'))]),
  P('balcony', 'Balcony', 'Architectural components', [box(3, 0.15, 1.4, 0, 0.075, 0, '#bdb8ad'), box(3.06, 0.06, 1.46, 0, 0.16, 0, '#aaa59a'), ...[-1.2, 1.2].map((x) => taper(0.14, 0.4, 1.0, x, -0.2, -0.2, '#aaa59a', 1, 1.4)), box(3, 0.05, 0.06, 0, 1.12, 0.67, METAL), box(0.06, 0.05, 1.4, -1.47, 1.12, 0, METAL), box(0.06, 0.05, 1.4, 1.47, 1.12, 0, METAL),
    ...Array.from({ length: 13 }, (_, i) => box(0.03, 0.94, 0.03, -1.44 + i * 0.24, 0.65, 0.67, '#4a5058')), ...[-0.45, -0.1, 0.25].flatMap((z) => [box(0.03, 0.94, 0.03, -1.47, 0.65, z, '#4a5058'), box(0.03, 0.94, 0.03, 1.47, 0.65, z, '#4a5058')])]),
  P('room_divider', 'Room divider', 'Architectural components', [-1, 0, 1].flatMap((i) => { const ry = i === 0 ? -0.35 : 0.35, x = i * 0.62, z = i === 0 ? 0 : 0.0; return [box(0.64, 1.8, 0.04, x, 0.92, z, '#3a3028', [0, ry, 0]), box(0.54, 1.66, 0.045, x, 0.92, z, '#e9e2cf', [0, ry, 0]), box(0.54, 0.03, 0.05, x, 1.3, z, '#3a3028', [0, ry, 0]), box(0.54, 0.03, 0.05, x, 0.55, z, '#3a3028', [0, ry, 0])]; })),
];

export const PREFAB_MAP: Record<string, PrefabDef> = Object.fromEntries(PREFABS.map((p) => [p.key, p]));
export const PREFAB_CATEGORIES = [...new Set(PREFABS.map((p) => p.cat))];

const geoCache = new Map<string, THREE.BufferGeometry>();
let sharedMat: THREE.MeshStandardMaterial | null = null;

export function prefabMaterial(): THREE.MeshStandardMaterial {
  sharedMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02, flatShading: true });
  return sharedMat;
}

const rand = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function partGeometry(part: Part, index: number): THREE.BufferGeometry {
  const s = part.s;
  let g: THREE.BufferGeometry;
  if (part.g === 'box') {
    g = new THREE.BoxGeometry(s[0], s[1], s[2]);
    if (part.t) { const a = g.attributes.position as THREE.BufferAttribute; for (let i = 0; i < a.count; i++) if (a.getY(i) > 0) a.setXYZ(i, a.getX(i) * part.t[0], a.getY(i), a.getZ(i) * part.t[1]); }
  } else if (part.g === 'cyl') g = new THREE.CylinderGeometry(s[0], s[1], s[2], s[3] ?? 8);
  else if (part.g === 'cone') g = new THREE.ConeGeometry(s[0], s[1], s[2] ?? 7);
  else if (part.g === 'sph') { g = new THREE.SphereGeometry(s[0], 8, 6); g.scale(s[1], s[2], s[3]); }
  else {
    g = new THREE.IcosahedronGeometry(s[0], s[4] ?? 1);
    const a = g.attributes.position as THREE.BufferAttribute, jit = s[5] ?? 0;
    // Faces do not share vertices, so the offset is derived from the position: coincident corners move together.
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      const k = 1 + (rand(Math.round(x * 53) * 7.13 + Math.round(y * 53) * 3.71 + Math.round(z * 53) * 1.37 + index * 0.61) - 0.5) * 2 * jit;
      a.setXYZ(i, x * k * s[1], y * k * s[2], z * k * s[3]);
    }
  }
  if (g.index) { const ni = g.toNonIndexed(); g.dispose(); g = ni; }
  g.deleteAttribute('uv');
  const pos = g.attributes.position as THREE.BufferAttribute, n = pos.count, col = new Float32Array(n * 3), c = new THREE.Color(part.c);
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const perFace = part.g === 'box' ? 6 : 3, v = part.v ?? 0, ao = part.ao ?? 0;
  for (let i = 0; i < n; i++) {
    let k = 1;
    if (v) k += (rand(Math.floor(i / perFace) * 1.91 + index * 13.7) - 0.5) * 2 * v;
    if (ao) k *= 1 - ao * (1 - (pos.getY(i) - y0) / Math.max(y1 - y0, 1e-5));
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const e = new THREE.Euler(part.r?.[0] ?? 0, part.r?.[1] ?? 0, part.r?.[2] ?? 0);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(part.p[0], part.p[1], part.p[2]), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, 1, 1)));
  g.computeVertexNormals();
  return g;
}

export function prefabGeometry(key: string): THREE.BufferGeometry {
  const hit = geoCache.get(key);
  if (hit) return hit;
  const def = PREFAB_MAP[key] ?? PREFAB_MAP.crate;
  const geos = def.parts.map(partGeometry);
  const merged = mergeGeometries(geos, false) ?? new THREE.BoxGeometry(1, 1, 1);
  geos.forEach((g) => g.dispose());
  merged.userData.shared = true;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  geoCache.set(key, merged);
  return merged;
}
/** Local-space collision box for a prefab: [minx,miny,minz,maxx,maxy,maxz] or null. */
export function prefabCollider(key: string): number[] | null {
  const def = PREFAB_MAP[key];
  if (!def || def.collider === 'none') return null;
  if (Array.isArray(def.collider)) {
    const [w, h, d] = def.collider;
    return [-w / 2, 0, -d / 2, w / 2, h, d / 2];
  }
  const b = prefabGeometry(key).boundingBox!;
  return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
}
