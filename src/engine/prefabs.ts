// Procedural asset library. Every prefab is a list of coloured primitives that
// is merged into ONE geometry with vertex colours: one draw call per object and
// directly usable for GPU instancing (forests, rock fields).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Part = { g: 'box' | 'cyl' | 'cone' | 'sph'; s: number[]; p: number[]; c: string; r?: number[] };
export interface PrefabDef {
  key: string;
  name: string;
  cat: string;
  parts: Part[];
  /** [w,h,d] collision box centred on x/z, or 'none'. Defaults to the bounding box. */
  collider?: number[] | 'none';
  light?: { pos: number[]; color: string; intensity: number; range: number };
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: string, r?: number[]): Part => ({ g: 'box', s: [w, h, d], p: [x, y, z], c, r });
const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number, c: string, r?: number[]): Part => ({ g: 'cyl', s: [rt, rb, h], p: [x, y, z], c, r });
const cone = (rad: number, h: number, x: number, y: number, z: number, c: string): Part => ({ g: 'cone', s: [rad, h], p: [x, y, z], c });
const sph = (rad: number, x: number, y: number, z: number, c: string, sc?: number[]): Part => ({ g: 'sph', s: [rad, ...(sc ?? [1, 1, 1])], p: [x, y, z], c });

const legs = (w: number, d: number, h: number, c: string, t = 0.06): Part[] =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(t, h, t, a * (w / 2 - t), h / 2, b * (d / 2 - t), c));

const house = (w: number, d: number, h: number, wall: string, roof: string): Part[] => [
  box(w, h, d, 0, h / 2, 0, wall),
  { g: 'cone', s: [Math.hypot(w, d) / 2 + 0.3, h * 0.55, 4], p: [0, h + h * 0.275, 0], c: roof, r: [0, Math.PI / 4, 0] },
  box(0.9, 2, 0.08, 0, 1, d / 2 + 0.02, '#4a3424'),
  box(1, 1, 0.08, -w / 4 - 0.4, h * 0.55, d / 2 + 0.02, '#9fd0e8'),
  box(1, 1, 0.08, w / 4 + 0.4, h * 0.55, d / 2 + 0.02, '#9fd0e8'),
];

const P = (key: string, name: string, cat: string, parts: Part[], extra: Partial<PrefabDef> = {}): PrefabDef => ({ key, name, cat, parts, ...extra });

export const PREFABS: PrefabDef[] = [
  // Trees
  P('tree_pine', 'Pine tree', 'Trees', [cyl(0.12, 0.18, 1.6, 0, 0.8, 0, '#5b4330'), cone(1.3, 2.2, 0, 2.3, 0, '#2f5d34'), cone(1.0, 1.9, 0, 3.5, 0, '#356a3a'), cone(0.65, 1.5, 0, 4.6, 0, '#3d7742')], { collider: [0.4, 4, 0.4] }),
  P('tree_oak', 'Oak tree', 'Trees', [cyl(0.18, 0.26, 2.2, 0, 1.1, 0, '#5a4532'), sph(1.5, 0, 3.3, 0, '#4d7d35'), sph(1.1, 0.9, 2.9, 0.4, '#447230'), sph(1.0, -0.8, 3.0, -0.5, '#58893c')], { collider: [0.5, 4, 0.5] }),
  P('tree_birch', 'Birch tree', 'Trees', [cyl(0.09, 0.12, 3.2, 0, 1.6, 0, '#e4e1d6'), sph(1.0, 0, 3.8, 0, '#8fb04a', [1, 1.3, 1]), sph(0.7, 0.4, 3.0, 0.2, '#9cbd55')], { collider: [0.3, 4, 0.3] }),
  P('tree_palm', 'Palm tree', 'Trees', [cyl(0.12, 0.2, 4.4, 0, 2.2, 0, '#8a6f4d'), ...[0, 1, 2, 3, 4].map((i) => ({ g: 'box', s: [2.2, 0.06, 0.5], p: [Math.cos((i * 2 * Math.PI) / 5) * 0.95, 4.35, Math.sin((i * 2 * Math.PI) / 5) * 0.95], c: '#3f8a45', r: [0, -(i * 2 * Math.PI) / 5, -0.35] }) as Part)], { collider: [0.4, 4.4, 0.4] }),
  P('tree_dead', 'Dead tree', 'Trees', [cyl(0.1, 0.22, 2.8, 0, 1.4, 0, '#4a4038'), cyl(0.04, 0.08, 1.4, 0.4, 2.6, 0, '#4a4038', [0, 0, -0.8]), cyl(0.04, 0.07, 1.1, -0.35, 2.2, 0.1, '#4a4038', [0.2, 0, 0.9])], { collider: [0.4, 3, 0.4] }),
  // Plants
  P('bush', 'Bush', 'Plants', [sph(0.6, 0, 0.45, 0, '#3f6e33', [1, 0.8, 1]), sph(0.45, 0.45, 0.35, 0.2, '#4a7d3a'), sph(0.4, -0.4, 0.3, -0.2, '#386430')], { collider: 'none' }),
  P('grass_tuft', 'Grass tuft', 'Plants', [cone(0.12, 0.5, 0, 0.25, 0, '#6a9a3f'), cone(0.1, 0.4, 0.13, 0.2, 0.05, '#5d8c38'), cone(0.1, 0.42, -0.1, 0.21, 0.1, '#74a646'), cone(0.09, 0.36, 0.02, 0.18, -0.13, '#5d8c38')], { collider: 'none' }),
  P('flowers', 'Flowers', 'Plants', [cone(0.1, 0.3, 0, 0.15, 0, '#5d8c38'), sph(0.07, 0, 0.36, 0, '#e8c33d'), sph(0.07, 0.16, 0.3, 0.08, '#d9566a'), sph(0.07, -0.13, 0.32, -0.1, '#f1f1f1')], { collider: 'none' }),
  P('fern', 'Fern', 'Plants', [0, 1, 2, 3, 4, 5].map((i) => ({ g: 'box', s: [0.7, 0.03, 0.18], p: [Math.cos(i * 1.05) * 0.3, 0.25, Math.sin(i * 1.05) * 0.3], c: '#3d7a3c', r: [0, -i * 1.05, 0.5] }) as Part), { collider: 'none' }),
  P('potted_plant', 'Potted plant', 'Plants', [cyl(0.22, 0.16, 0.35, 0, 0.175, 0, '#a5654a'), sph(0.35, 0, 0.7, 0, '#3f7d3c', [1, 1.3, 1])]),
  // Rocks
  P('rock', 'Rock', 'Rocks', [sph(0.6, 0, 0.3, 0, '#807c76', [1.2, 0.7, 1])]),
  P('boulder', 'Boulder', 'Rocks', [sph(1.4, 0, 0.9, 0, '#77736d', [1.1, 0.8, 1]), sph(0.8, 1.1, 0.5, 0.4, '#858079', [1, 0.7, 1])]),
  P('rock_slab', 'Rock slab', 'Rocks', [box(2.2, 0.5, 1.4, 0, 0.25, 0, '#827d75', [0, 0.3, 0.05]), box(1.4, 0.4, 1.0, 0.2, 0.65, 0.1, '#77726b', [0, -0.2, -0.04])]),
  P('pebbles', 'Pebbles', 'Rocks', [sph(0.14, 0, 0.07, 0, '#8d8982', [1, 0.6, 1]), sph(0.1, 0.25, 0.05, 0.1, '#7a766f', [1, 0.6, 1]), sph(0.12, -0.2, 0.06, -0.15, '#9a968e', [1, 0.6, 1])], { collider: 'none' }),
  // Buildings & houses
  P('house_small', 'Small house', 'Houses', house(6, 5, 3, '#d8cdb8', '#8a3f33')),
  P('house_large', 'Large house', 'Houses', [...house(9, 7, 5.6, '#c9d2d6', '#3f4a5a'), box(1, 1, 0.08, -2.6, 4.2, 3.52, '#9fd0e8'), box(1, 1, 0.08, 2.6, 4.2, 3.52, '#9fd0e8')]),
  P('cabin', 'Cabin', 'Houses', house(4.5, 4, 2.6, '#7a5a3c', '#3f3027')),
  P('office_block', 'Office block', 'Buildings', [box(12, 18, 10, 0, 9, 0, '#8e9aa6'), ...[0, 1, 2, 3, 4].map((i) => box(12.06, 1.4, 10.06, 0, 2.6 + i * 3.4, 0, '#bfe0f0')), box(2, 2.4, 0.1, 0, 1.2, 5.03, '#2a3038')]),
  P('tower', 'Tower', 'Buildings', [box(8, 40, 8, 0, 20, 0, '#6f7c8c'), ...Array.from({ length: 11 }, (_, i) => box(8.06, 1.5, 8.06, 0, 3 + i * 3.4, 0, '#a9cfe6')), box(3, 2, 3, 0, 41, 0, '#55606c')]),
  P('warehouse', 'Warehouse', 'Buildings', [box(16, 6, 10, 0, 3, 0, '#9aa0a3'), box(16.4, 0.4, 10.4, 0, 6.2, 0, '#5d6468'), box(4, 4, 0.1, 0, 2, 5.03, '#3b4046')]),
  P('shop', 'Shop', 'Buildings', [box(7, 3.6, 6, 0, 1.8, 0, '#d5c2a0'), box(7.4, 0.3, 1.4, 0, 2.9, 3.5, '#b5483c'), box(4.4, 1.9, 0.08, 0.8, 1.3, 3.02, '#a9d4ea'), box(0.9, 2.1, 0.08, -2.4, 1.05, 3.02, '#4a3424')]),
  P('church', 'Chapel', 'Buildings', [...house(6, 10, 5, '#e3ded2', '#5a4a44'), box(2.4, 9, 2.4, 0, 4.5, -5.5, '#e3ded2'), { g: 'cone', s: [2.1, 3.2, 4], p: [0, 10.6, -5.5], c: '#5a4a44', r: [0, Math.PI / 4, 0] }]),
  P('ruin_wall', 'Ruined wall', 'Buildings', [box(4, 2.4, 0.5, 0, 1.2, 0, '#8d877b'), box(1.4, 1, 0.5, -1.3, 2.9, 0, '#8d877b'), box(0.8, 0.5, 0.5, 0.2, 2.65, 0, '#847e73')]),
  // Furniture
  P('table', 'Table', 'Furniture', [box(1.6, 0.06, 0.9, 0, 0.75, 0, '#8b6a47'), ...legs(1.6, 0.9, 0.72, '#6e5338')]),
  P('chair', 'Chair', 'Furniture', [box(0.45, 0.05, 0.45, 0, 0.45, 0, '#8b6a47'), box(0.45, 0.5, 0.05, 0, 0.72, -0.2, '#8b6a47'), ...legs(0.45, 0.45, 0.45, '#6e5338', 0.04)]),
  P('sofa', 'Sofa', 'Furniture', [box(2, 0.4, 0.9, 0, 0.3, 0, '#5c6f8a'), box(2, 0.55, 0.22, 0, 0.72, -0.34, '#52647d'), box(0.22, 0.55, 0.9, -0.89, 0.45, 0, '#52647d'), box(0.22, 0.55, 0.9, 0.89, 0.45, 0, '#52647d')]),
  P('bed', 'Bed', 'Furniture', [box(1.6, 0.3, 2.1, 0, 0.3, 0, '#6e5338'), box(1.5, 0.2, 2.0, 0, 0.55, 0, '#eeeae2'), box(1.5, 0.22, 1.3, 0, 0.58, 0.33, '#7c93b0'), box(1.6, 0.9, 0.1, 0, 0.6, -1.05, '#6e5338'), box(0.6, 0.12, 0.35, -0.35, 0.72, -0.75, '#ffffff'), box(0.6, 0.12, 0.35, 0.35, 0.72, -0.75, '#ffffff')]),
  P('desk', 'Office desk', 'Furniture', [box(1.5, 0.05, 0.7, 0, 0.74, 0, '#c9c4b8'), box(0.05, 0.72, 0.66, -0.7, 0.36, 0, '#8a8f96'), box(0.05, 0.72, 0.66, 0.7, 0.36, 0, '#8a8f96'), box(0.5, 0.32, 0.03, 0, 1.0, -0.15, '#22262c'), box(0.16, 0.1, 0.12, 0, 0.8, -0.15, '#3a3f47')]),
  P('bookshelf', 'Bookshelf', 'Furniture', [box(1.2, 2, 0.35, 0, 1, 0, '#6e5338'), ...[0, 1, 2, 3].map((i) => box(1.05, 0.32, 0.26, 0, 0.3 + i * 0.47, 0.05, ['#a44a3f', '#3f6ea4', '#5a8a4a', '#c9a23f'][i]))]),
  P('wardrobe', 'Wardrobe', 'Furniture', [box(1.3, 2.1, 0.6, 0, 1.05, 0, '#7b5d40'), box(0.02, 2, 0.02, 0, 1.05, 0.31, '#3d2e20'), sph(0.03, -0.08, 1.05, 0.32, '#d9c38a'), sph(0.03, 0.08, 1.05, 0.32, '#d9c38a')]),
  P('kitchen_counter', 'Kitchen counter', 'Furniture', [box(2, 0.86, 0.62, 0, 0.43, 0, '#e6e2d8'), box(2.04, 0.05, 0.66, 0, 0.885, 0, '#3f4347'), box(0.5, 0.02, 0.4, 0.5, 0.915, 0, '#b9bec4')]),
  P('fridge', 'Refrigerator', 'Furniture', [box(0.75, 1.85, 0.7, 0, 0.925, 0, '#d9dde0'), box(0.03, 0.5, 0.03, -0.28, 1.2, 0.37, '#8a8f96'), box(0.75, 0.01, 0.71, 0, 1.3, 0, '#9aa0a6')]),
  P('toilet', 'Toilet', 'Furniture', [cyl(0.2, 0.16, 0.4, 0, 0.2, 0.05, '#f2f2f0'), box(0.42, 0.38, 0.18, 0, 0.6, -0.22, '#f2f2f0'), cyl(0.22, 0.22, 0.04, 0, 0.42, 0.05, '#e6e6e2')]),
  P('bathtub', 'Bathtub', 'Furniture', [box(0.8, 0.55, 1.7, 0, 0.275, 0, '#f4f4f2'), box(0.62, 0.02, 1.5, 0, 0.555, 0, '#bcdcea')]),
  P('sink', 'Sink', 'Furniture', [box(0.6, 0.16, 0.46, 0, 0.82, 0, '#f2f2f0'), cyl(0.06, 0.08, 0.74, 0, 0.37, 0, '#e2e2de'), cyl(0.015, 0.015, 0.16, 0, 0.98, -0.16, '#b0b5ba')]),
  P('school_desk', 'School desk', 'Furniture', [box(0.7, 0.04, 0.5, 0, 0.7, 0, '#c9a878'), ...legs(0.7, 0.5, 0.68, '#6f757c', 0.03), box(0.4, 0.04, 0.4, 0, 0.42, 0.6, '#3f6ea4'), ...legs(0.4, 0.4, 0.4, '#6f757c', 0.03).map((l) => ({ ...l, p: [l.p[0], l.p[1], l.p[2] + 0.6] }))]),
  P('blackboard', 'Blackboard', 'Furniture', [box(3, 1.3, 0.06, 0, 1.6, 0, '#27382f'), box(3.1, 0.06, 0.1, 0, 0.93, 0.02, '#8b6a47')]),
  // Vehicles
  P('car', 'Car', 'Vehicles', [box(1.8, 0.6, 4.2, 0, 0.65, 0, '#b5403a'), box(1.6, 0.55, 2.1, 0, 1.2, -0.2, '#2c3138'), ...[[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]].map(([a, b]) => cyl(0.34, 0.34, 0.22, a * 0.88, 0.34, b, '#1c1d1f', [0, 0, Math.PI / 2]))]),
  P('truck', 'Truck', 'Vehicles', [box(2.2, 1.6, 2, 0, 1.4, 2.2, '#3f6ea4'), box(2.3, 2.4, 4.6, 0, 1.9, -1.2, '#d9d9d6'), ...[[-1, 2.2], [1, 2.2], [-1, -0.6], [1, -0.6], [-1, -2.6], [1, -2.6]].map(([a, b]) => cyl(0.48, 0.48, 0.3, a * 1.05, 0.48, b, '#1c1d1f', [0, 0, Math.PI / 2]))]),
  P('bicycle', 'Bicycle', 'Vehicles', [cyl(0.33, 0.33, 0.04, 0, 0.33, 0.5, '#222', [0, 0, Math.PI / 2]), cyl(0.33, 0.33, 0.04, 0, 0.33, -0.5, '#222', [0, 0, Math.PI / 2]), box(0.04, 0.04, 1, 0, 0.6, 0, '#c9423a', [0.25, 0, 0]), box(0.04, 0.5, 0.04, 0, 0.8, -0.3, '#c9423a'), box(0.4, 0.04, 0.04, 0, 0.98, 0.45, '#333')], { collider: [0.4, 1, 1.7] }),
  P('boat', 'Rowing boat', 'Vehicles', [box(1.3, 0.4, 3.4, 0, 0.2, 0, '#7b5d40'), box(1.1, 0.05, 0.3, 0, 0.35, 0.5, '#a1805c'), box(1.1, 0.05, 0.3, 0, 0.35, -0.6, '#a1805c')]),
  // Signs & street furniture
  P('sign_post', 'Sign post', 'Signs', [cyl(0.04, 0.04, 2.2, 0, 1.1, 0, '#8a8f96'), box(0.9, 0.5, 0.04, 0, 2.0, 0, '#2d6a4f')], { collider: [0.2, 2.2, 0.2] }),
  P('stop_sign', 'Stop sign', 'Signs', [cyl(0.04, 0.04, 2.2, 0, 1.1, 0, '#8a8f96'), { g: 'cyl', s: [0.36, 0.36, 0.04, 8], p: [0, 2.1, 0], c: '#c22f2f', r: [Math.PI / 2, 0, 0] }], { collider: [0.2, 2.2, 0.2] }),
  P('info_board', 'Information board', 'Signs', [box(0.08, 1.2, 0.08, -0.6, 0.6, 0, '#5b4330'), box(0.08, 1.2, 0.08, 0.6, 0.6, 0, '#5b4330'), box(1.4, 0.8, 0.06, 0, 1.25, 0, '#e9e2cf', [-0.3, 0, 0])]),
  P('bench', 'Bench', 'Street furniture', [box(1.6, 0.06, 0.45, 0, 0.45, 0, '#8b6a47'), box(1.6, 0.4, 0.05, 0, 0.75, -0.2, '#8b6a47'), box(0.08, 0.45, 0.45, -0.7, 0.225, 0, '#3f4347'), box(0.08, 0.45, 0.45, 0.7, 0.225, 0, '#3f4347')]),
  P('street_lamp', 'Street lamp', 'Street furniture', [cyl(0.06, 0.09, 4.2, 0, 2.1, 0, '#3a3f47'), box(0.9, 0.08, 0.14, 0.4, 4.2, 0, '#3a3f47'), box(0.4, 0.1, 0.2, 0.75, 4.12, 0, '#fff3c4')], { collider: [0.25, 4.2, 0.25], light: { pos: [0.75, 4, 0], color: '#ffe2a8', intensity: 40, range: 18 } }),
  P('trash_bin', 'Trash bin', 'Street furniture', [cyl(0.25, 0.2, 0.8, 0, 0.4, 0, '#3f5a48'), cyl(0.27, 0.27, 0.05, 0, 0.82, 0, '#2d4034')]),
  P('fence', 'Fence section', 'Street furniture', [box(0.1, 1.1, 0.1, -1, 0.55, 0, '#7b5d40'), box(0.1, 1.1, 0.1, 1, 0.55, 0, '#7b5d40'), box(2.1, 0.1, 0.05, 0, 0.9, 0, '#8b6a47'), box(2.1, 0.1, 0.05, 0, 0.5, 0, '#8b6a47')]),
  P('hydrant', 'Fire hydrant', 'Street furniture', [cyl(0.12, 0.14, 0.6, 0, 0.3, 0, '#c22f2f'), sph(0.13, 0, 0.62, 0, '#c22f2f'), cyl(0.05, 0.05, 0.36, 0, 0.4, 0, '#a82626', [0, 0, Math.PI / 2])]),
  P('fountain', 'Fountain', 'Street furniture', [cyl(1.8, 1.9, 0.5, 0, 0.25, 0, '#a7a39a'), cyl(1.6, 1.6, 0.06, 0, 0.5, 0, '#5fa7c9'), cyl(0.2, 0.3, 1.4, 0, 0.9, 0, '#a7a39a'), cyl(0.7, 0.3, 0.2, 0, 1.6, 0, '#a7a39a')]),
  // Museum objects
  P('pedestal', 'Pedestal', 'Museum objects', [box(0.7, 1, 0.7, 0, 0.5, 0, '#ebe8e1'), box(0.8, 0.06, 0.8, 0, 1.03, 0, '#d6d2c8')]),
  P('display_case', 'Display case', 'Museum objects', [box(1.2, 0.9, 0.7, 0, 0.45, 0, '#3a3f47'), box(1.16, 0.5, 0.66, 0, 1.15, 0, '#bfe3f2')]),
  P('painting', 'Painting', 'Museum objects', [box(1.5, 1.1, 0.06, 0, 1.6, 0, '#7a5a2e'), box(1.3, 0.9, 0.07, 0, 1.6, 0.005, '#3f6ea4'), box(1.3, 0.3, 0.075, 0, 1.3, 0.006, '#5a8a4a'), sph(0.12, 0.35, 1.78, 0.03, '#f0d060', [1, 1, 0.2])], { collider: 'none' }),
  P('statue', 'Statue', 'Museum objects', [box(0.8, 0.4, 0.8, 0, 0.2, 0, '#8d8982'), cyl(0.2, 0.28, 1.1, 0, 0.95, 0, '#cfcabf'), sph(0.3, 0, 1.65, 0, '#cfcabf', [1, 1.1, 0.8]), sph(0.17, 0, 2.1, 0, '#cfcabf')]),
  P('vase', 'Ancient vase', 'Museum objects', [cyl(0.1, 0.07, 0.1, 0, 0.05, 0, '#a5654a'), sph(0.18, 0, 0.26, 0, '#b8704f', [1, 1.2, 1]), cyl(0.09, 0.06, 0.16, 0, 0.5, 0, '#a5654a')]),
  P('rope_barrier', 'Rope barrier', 'Museum objects', [cyl(0.03, 0.03, 0.95, -0.9, 0.475, 0, '#c9a23f'), cyl(0.03, 0.03, 0.95, 0.9, 0.475, 0, '#c9a23f'), cyl(0.14, 0.14, 0.03, -0.9, 0.015, 0, '#c9a23f'), cyl(0.14, 0.14, 0.03, 0.9, 0.015, 0, '#c9a23f'), box(1.8, 0.04, 0.04, 0, 0.82, 0, '#8a2632')]),
  P('skeleton_fossil', 'Fossil exhibit', 'Museum objects', [box(2.4, 0.3, 1, 0, 0.15, 0, '#3a3f47'), cyl(0.05, 0.05, 2, 0, 0.9, 0, '#e3dcc8', [0, 0, Math.PI / 2]), ...[-0.6, -0.3, 0, 0.3].map((x) => cyl(0.02, 0.02, 0.6, x, 0.65, 0, '#e3dcc8')), sph(0.2, 1.1, 1.0, 0, '#e3dcc8', [1.4, 0.8, 0.7])]),
  // Interior decorations
  P('rug', 'Rug', 'Interior decorations', [box(2.4, 0.02, 1.6, 0, 0.01, 0, '#8a3a3a'), box(2.0, 0.025, 1.2, 0, 0.012, 0, '#c9a878')], { collider: 'none' }),
  P('picture_frame', 'Picture frame', 'Interior decorations', [box(0.6, 0.8, 0.04, 0, 1.5, 0, '#2a2a2a'), box(0.5, 0.7, 0.045, 0, 1.5, 0.003, '#d9cdb0')], { collider: 'none' }),
  P('tv', 'Television', 'Interior decorations', [box(1.3, 0.75, 0.06, 0, 1.1, 0, '#16181c'), box(0.5, 0.04, 0.25, 0, 0.6, 0, '#2a2e35'), box(0.06, 0.2, 0.06, 0, 0.68, 0, '#2a2e35'), box(1.5, 0.5, 0.4, 0, 0.25, 0, '#6e5338')]),
  P('clock', 'Wall clock', 'Interior decorations', [{ g: 'cyl', s: [0.25, 0.25, 0.05, 24], p: [0, 1.9, 0], c: '#f2efe6', r: [Math.PI / 2, 0, 0] }, box(0.02, 0.18, 0.06, 0, 1.97, 0.01, '#222'), box(0.13, 0.02, 0.06, 0.06, 1.9, 0.01, '#222')], { collider: 'none' }),
  P('curtains', 'Curtains', 'Interior decorations', [box(0.5, 2.2, 0.08, -0.7, 1.2, 0, '#7c5a6e'), box(0.5, 2.2, 0.08, 0.7, 1.2, 0, '#7c5a6e'), cyl(0.02, 0.02, 2.2, 0, 2.32, 0, '#3a3f47', [0, 0, Math.PI / 2])], { collider: 'none' }),
  // Industrial
  P('crate', 'Crate', 'Industrial equipment', [box(1, 1, 1, 0, 0.5, 0, '#a1805c'), box(1.02, 0.1, 1.02, 0, 0.5, 0, '#7b5d40')]),
  P('barrel', 'Barrel', 'Industrial equipment', [cyl(0.32, 0.32, 0.95, 0, 0.475, 0, '#3f6ea4'), cyl(0.33, 0.33, 0.05, 0, 0.3, 0, '#2c4f77'), cyl(0.33, 0.33, 0.05, 0, 0.7, 0, '#2c4f77')]),
  P('pipe', 'Pipe section', 'Industrial equipment', [cyl(0.2, 0.2, 3, 0, 0.3, 0, '#8a8f96', [0, 0, Math.PI / 2]), cyl(0.24, 0.24, 0.1, -1.5, 0.3, 0, '#6f757c', [0, 0, Math.PI / 2]), cyl(0.24, 0.24, 0.1, 1.5, 0.3, 0, '#6f757c', [0, 0, Math.PI / 2])]),
  P('generator', 'Generator', 'Industrial equipment', [box(1.8, 1.1, 1, 0, 0.65, 0, '#c9a23f'), box(1.9, 0.1, 1.1, 0, 0.05, 0, '#3a3f47'), cyl(0.07, 0.07, 0.7, 0.6, 1.5, 0, '#3a3f47'), box(0.5, 0.3, 0.02, -0.4, 0.8, 0.51, '#22262c')]),
  P('control_panel', 'Control panel', 'Industrial equipment', [box(1, 0.9, 0.5, 0, 0.45, 0, '#6f757c'), box(1, 0.4, 0.5, 0, 1.05, -0.05, '#555b62', [-0.5, 0, 0]), sph(0.04, -0.25, 1.15, 0.12, '#d93f3f'), sph(0.04, 0, 1.15, 0.12, '#3fd96a'), sph(0.04, 0.25, 1.15, 0.12, '#e8c33d')]),
  P('tank', 'Storage tank', 'Industrial equipment', [cyl(1.4, 1.4, 3.6, 0, 1.8, 0, '#b9bec4'), sph(1.4, 0, 3.6, 0, '#b9bec4', [1, 0.35, 1]), cyl(0.05, 0.05, 3.8, 1.45, 1.9, 0, '#6f757c')]),
  P('lever', 'Lever', 'Industrial equipment', [box(0.3, 0.2, 0.3, 0, 0.1, 0, '#3a3f47'), cyl(0.025, 0.025, 0.7, 0, 0.5, 0.12, '#b0b5ba', [0.4, 0, 0]), sph(0.06, 0, 0.82, 0.26, '#c22f2f')]),
  P('button_panel', 'Push button', 'Industrial equipment', [box(0.25, 0.35, 0.08, 0, 1.2, 0, '#3a3f47'), cyl(0.06, 0.06, 0.05, 0, 1.2, 0.05, '#d93f3f', [Math.PI / 2, 0, 0])], { collider: 'none' }),
  // Lighting
  P('floor_lamp', 'Floor lamp', 'Lighting', [cyl(0.16, 0.18, 0.04, 0, 0.02, 0, '#3a3f47'), cyl(0.02, 0.02, 1.5, 0, 0.77, 0, '#3a3f47'), cyl(0.14, 0.24, 0.3, 0, 1.62, 0, '#f6e7c1')], { light: { pos: [0, 1.55, 0], color: '#ffdca0', intensity: 10, range: 9 } }),
  P('ceiling_light', 'Ceiling light', 'Lighting', [cyl(0.02, 0.02, 0.4, 0, -0.2, 0, '#3a3f47'), cyl(0.3, 0.12, 0.18, 0, -0.45, 0, '#f6e7c1')], { collider: 'none', light: { pos: [0, -0.6, 0], color: '#fff0d0', intensity: 14, range: 12 } }),
  P('lantern', 'Lantern', 'Lighting', [box(0.2, 0.3, 0.2, 0, 0.2, 0, '#f6d58a'), box(0.24, 0.04, 0.24, 0, 0.03, 0, '#2a2a2a'), { g: 'cone', s: [0.2, 0.14, 4], p: [0, 0.42, 0], c: '#2a2a2a', r: [0, Math.PI / 4, 0] }], { collider: 'none', light: { pos: [0, 0.3, 0], color: '#ffb866', intensity: 5, range: 7 } }),
  P('campfire', 'Campfire', 'Lighting', [...[0, 1, 2, 3, 4, 5].map((i) => sph(0.12, Math.cos(i * 1.05) * 0.4, 0.07, Math.sin(i * 1.05) * 0.4, '#77736d')), cyl(0.05, 0.05, 0.6, 0, 0.12, 0, '#4a3424', [0, 0, 1.2]), cyl(0.05, 0.05, 0.6, 0, 0.12, 0, '#4a3424', [1.2, 0, 0]), cone(0.16, 0.45, 0, 0.35, 0, '#ff8a2a')], { collider: 'none', light: { pos: [0, 0.5, 0], color: '#ff8a3a', intensity: 14, range: 11 } }),
  // Architectural components
  P('column', 'Column', 'Architectural components', [box(0.7, 0.2, 0.7, 0, 0.1, 0, '#dcd8ce'), cyl(0.25, 0.28, 2.6, 0, 1.5, 0, '#e8e4da'), box(0.7, 0.2, 0.7, 0, 2.9, 0, '#dcd8ce')]),
  P('beam', 'Beam', 'Architectural components', [box(4, 0.3, 0.3, 0, 0.15, 0, '#6e5338')]),
  P('arch', 'Arch', 'Architectural components', [box(0.5, 2.6, 0.5, -1.2, 1.3, 0, '#d2cdc2'), box(0.5, 2.6, 0.5, 1.2, 1.3, 0, '#d2cdc2'), box(2.9, 0.5, 0.5, 0, 2.85, 0, '#d2cdc2')], { collider: 'none' }),
  P('railing', 'Railing', 'Architectural components', [box(2, 0.05, 0.05, 0, 1, 0, '#3a3f47'), ...[-0.95, -0.47, 0, 0.47, 0.95].map((x) => box(0.03, 1, 0.03, x, 0.5, 0, '#3a3f47'))]),
  P('balcony', 'Balcony', 'Architectural components', [box(3, 0.15, 1.4, 0, 0.075, 0, '#bdb8ad'), box(3, 0.05, 0.05, 0, 1.1, 0.67, '#3a3f47'), ...[-1.45, -0.7, 0, 0.7, 1.45].map((x) => box(0.04, 1, 0.04, x, 0.6, 0.67, '#3a3f47')), box(0.05, 1, 1.4, -1.47, 0.6, 0, '#3a3f47'), box(0.05, 1, 1.4, 1.47, 0.6, 0, '#3a3f47')]),
  P('room_divider', 'Room divider', 'Architectural components', [box(0.05, 1.8, 0.4, -0.9, 0.9, 0, '#3a3f47'), box(0.05, 1.8, 0.4, 0.9, 0.9, 0, '#3a3f47'), box(1.8, 1.6, 0.04, 0, 0.95, 0, '#e9e2cf')]),
];

export const PREFAB_MAP: Record<string, PrefabDef> = Object.fromEntries(PREFABS.map((p) => [p.key, p]));
export const PREFAB_CATEGORIES = [...new Set(PREFABS.map((p) => p.cat))];

const geoCache = new Map<string, THREE.BufferGeometry>();
let sharedMat: THREE.MeshStandardMaterial | null = null;

export function prefabMaterial(): THREE.MeshStandardMaterial {
  sharedMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02, flatShading: true });
  return sharedMat;
}

export function prefabGeometry(key: string): THREE.BufferGeometry {
  const hit = geoCache.get(key);
  if (hit) return hit;
  const def = PREFAB_MAP[key] ?? PREFAB_MAP.crate;
  const geos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (const part of def.parts) {
    let g: THREE.BufferGeometry;
    const s = part.s;
    if (part.g === 'box') g = new THREE.BoxGeometry(s[0], s[1], s[2]);
    else if (part.g === 'cyl') g = new THREE.CylinderGeometry(s[0], s[1], s[2], s[3] ?? 10);
    else if (part.g === 'cone') g = new THREE.ConeGeometry(s[0], s[1], s[2] ?? 8);
    else {
      g = new THREE.SphereGeometry(s[0], 10, 7);
      g.scale(s[1], s[2], s[3]);
    }
    e.set(part.r?.[0] ?? 0, part.r?.[1] ?? 0, part.r?.[2] ?? 0);
    m.compose(new THREE.Vector3(part.p[0], part.p[1], part.p[2]), q.setFromEuler(e), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    const c = new THREE.Color(part.c);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
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
