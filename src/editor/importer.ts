// Model import pipeline: reads GLB/GLTF (incl. Draco and Meshopt compression), OBJ(+MTL), FBX, STL,
// PLY and Collada — as single files, multi-file selections or zip archives — analyses them, and
// stores them in the project as a self-contained GLB. Also hosts the optimiser (texture
// downscaling, vertex welding, triangle reduction). Loaders are fetched on demand.
import * as THREE from 'three';
import { unzipSync } from 'fflate';
import type { ModelMeta } from '../engine/types';
import { renderThumb } from './thumbs';

export const MODEL_EXT = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'dae'];
const RESOURCE_EXT = ['bin', 'mtl', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga', 'gif'];
export const ext = (name: string) => name.split('.').pop()!.toLowerCase();
const base = (path: string) => decodeURIComponent(path).split(/[\\/]/).pop()!.toLowerCase();

export interface Loaded { scene: THREE.Object3D; animations: THREE.AnimationClip[] }
export interface OptimiseOptions { maxTexture: number; detail: number }

/** Expand zip archives into plain files (other files pass through). */
export async function expandArchives(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    if (ext(f.name) !== 'zip') { out.push(f); continue; }
    const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
    for (const [path, data] of Object.entries(entries)) if (data.length && !path.endsWith('/') && !base(path).startsWith('.')) out.push(new File([data], path.split('/').pop()!));
  }
  return out;
}

/** True when the files that came with a model belong to it (textures, buffers, materials). */
export const isResource = (name: string) => RESOURCE_EXT.includes(ext(name));

function gltfJson(buf: ArrayBuffer, isGlb: boolean): any {
  try {
    if (!isGlb) return JSON.parse(new TextDecoder().decode(buf));
    const v = new DataView(buf), len = v.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)));
  } catch { return {}; }
}

/** A plain binary glTF can be stored untouched; everything else is converted. */
export async function needsConversion(f: File): Promise<boolean> {
  if (ext(f.name) !== 'glb') return true;
  const used: string[] = gltfJson(await f.arrayBuffer(), true).extensionsUsed ?? [];
  return used.includes('KHR_draco_mesh_compression');
}

/** Load a model file. `siblings` are the other files selected with it (textures, .bin, .mtl). */
export async function loadModel(main: File, siblings: File[] = []): Promise<Loaded> {
  const urls: string[] = [], byName = new Map<string, string>();
  const url = (f: Blob) => { const u = URL.createObjectURL(f); urls.push(u); return u; };
  for (const s of siblings) byName.set(s.name.toLowerCase(), url(s));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => (u.startsWith('blob:') || u.startsWith('data:') ? (byName.get(base(u.replace(/^blob:.*\//, ''))) ?? u) : (byName.get(base(u)) ?? u)));
  const e = ext(main.name), src = url(main);
  try {
    if (e === 'glb' || e === 'gltf') {
      const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/loaders/DRACOLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')]);
      const json = gltfJson(await main.arrayBuffer(), e === 'glb');
      if ((json.extensionsRequired ?? []).includes('KHR_texture_basisu')) throw new Error('This model uses KTX2/Basis textures, which are not supported yet. Re-export it with PNG or JPEG textures.');
      const loader = new GLTFLoader(manager), draco = new DRACOLoader(manager);
      draco.setDecoderPath(new URL('draco/', document.baseURI).href);
      loader.setDRACOLoader(draco);
      loader.setMeshoptDecoder(MeshoptDecoder);
      const g = await loader.loadAsync(src);
      draco.dispose();
      return { scene: g.scene, animations: g.animations };
    }
    if (e === 'obj') {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      const loader = new OBJLoader(manager), mtl = siblings.find((s) => ext(s.name) === 'mtl');
      if (mtl) {
        const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js');
        const mats = await new MTLLoader(manager).loadAsync(byName.get(mtl.name.toLowerCase())!);
        mats.preload();
        loader.setMaterials(mats);
      }
      return { scene: await loader.loadAsync(src), animations: [] };
    }
    if (e === 'fbx') {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
      const o = await new FBXLoader(manager).loadAsync(src);
      return { scene: o, animations: o.animations ?? [] };
    }
    if (e === 'dae') {
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
      const c = await new ColladaLoader(manager).loadAsync(src);
      return { scene: c.scene, animations: (c.scene as any).animations ?? [] };
    }
    if (e === 'stl' || e === 'ply') {
      const geo: THREE.BufferGeometry = e === 'stl'
        ? await new (await import('three/examples/jsm/loaders/STLLoader.js')).STLLoader(manager).loadAsync(src)
        : await new (await import('three/examples/jsm/loaders/PLYLoader.js')).PLYLoader(manager).loadAsync(src);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.8, vertexColors: !!geo.attributes.color }));
      if (e === 'stl') mesh.rotation.x = -Math.PI / 2; // STL files are Z-up by convention
      const g = new THREE.Group();
      g.add(mesh);
      return { scene: g, animations: [] };
    }
    throw new Error(`Unsupported model format .${e}`);
  } finally {
    // Textures decode asynchronously from these URLs; release them once everything has settled.
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 30000);
  }
}

const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;
const meshes = (root: THREE.Object3D) => { const l: THREE.Mesh[] = []; root.traverse((o: any) => o.isMesh && l.push(o)); return l; };
const materials = (root: THREE.Object3D) => new Set(meshes(root).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])).filter(Boolean) as THREE.Material[]);
function textures(root: THREE.Object3D) {
  const set = new Set<THREE.Texture>();
  for (const m of materials(root)) for (const k of MAPS) { const t = (m as any)[k] as THREE.Texture | undefined; if (t?.image) set.add(t); }
  return set;
}

export function analyse(l: Loaded, withThumb = true): ModelMeta {
  let tris = 0, verts = 0;
  const ms = meshes(l.scene);
  for (const m of ms) { const g = m.geometry, n = g.index ? g.index.count : g.attributes.position?.count ?? 0; tris += Math.floor(n / 3) * ((m as any).isInstancedMesh ? (m as any).count : 1); verts += g.attributes.position?.count ?? 0; }
  const tex = textures(l.scene);
  let maxTex = 0;
  for (const t of tex) maxTex = Math.max(maxTex, (t.image as any).width ?? 0, (t.image as any).height ?? 0);
  l.scene.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(l.scene).getSize(new THREE.Vector3());
  let thumb: string | undefined;
  if (withThumb) { try { const parent = l.scene.parent; thumb = renderThumb(l.scene, 96); parent?.add(l.scene); } catch { /* preview is optional */ } }
  return { tris, verts, meshes: ms.length, materials: materials(l.scene).size, textures: tex.size, maxTexture: maxTex, size: [size.x, size.y, size.z].map((v) => Math.round(v * 1000) / 1000) as [number, number, number], animations: l.animations.length, thumb };
}

/** Make materials exportable (glTF is PBR-only) and choose compact texture encodings. */
function normaliseMaterials(root: THREE.Object3D) {
  const done = new Map<THREE.Material, THREE.Material>();
  const conv = (m: any): THREE.Material => {
    if (!m || m.isMeshStandardMaterial || m.isMeshBasicMaterial) return m;
    if (done.has(m)) return done.get(m)!;
    const s = new THREE.MeshStandardMaterial({
      name: m.name, color: m.color?.clone() ?? new THREE.Color(0xffffff), map: m.map ?? null, normalMap: m.normalMap ?? null, emissive: m.emissive?.clone() ?? new THREE.Color(0), emissiveMap: m.emissiveMap ?? null,
      alphaMap: m.alphaMap ?? null, transparent: !!m.transparent, opacity: m.opacity ?? 1, alphaTest: m.alphaTest ?? 0, side: m.side, vertexColors: !!m.vertexColors,
      roughness: m.shininess !== undefined ? THREE.MathUtils.clamp(1 - m.shininess / 120, 0.35, 1) : 0.85, metalness: 0,
    });
    done.set(m, s);
    return s;
  };
  for (const mesh of meshes(root)) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  for (const m of materials(root)) {
    const needsAlpha = m.transparent || m.alphaTest > 0;
    for (const k of MAPS) { const t = (m as any)[k] as THREE.Texture | undefined; if (t) t.userData.mimeType = k === 'normalMap' || (k === 'map' && needsAlpha) || k === 'alphaMap' ? 'image/png' : 'image/jpeg'; }
  }
}

/** Reduce texture resolution and triangle count in place. Returns notes about anything that was skipped. */
export async function optimise(l: Loaded, o: OptimiseOptions): Promise<string[]> {
  const notes: string[] = [];
  for (const t of textures(l.scene)) {
    const img: any = t.image, w = img.width, h = img.height;
    if (!w || !h || Math.max(w, h) <= o.maxTexture) continue;
    const k = o.maxTexture / Math.max(w, h), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    t.image = c;
    t.needsUpdate = true;
  }
  const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
  const reduce = o.detail < 0.99;
  const simp = reduce ? (await import('meshoptimizer/simplifier')).MeshoptSimplifier : null;
  if (simp) await simp.ready;
  const seen = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  let skipped = 0;
  for (const m of meshes(l.scene)) {
    if (seen.has(m.geometry)) { m.geometry = seen.get(m.geometry)!; continue; }
    const src = m.geometry, morph = Object.keys(src.morphAttributes ?? {}).length > 0, skinned = !!(m as any).isSkinnedMesh;
    let g = src;
    // Welding shares identical corners; it is skipped for skinned/morphing meshes, whose extra data must stay aligned.
    if (!skinned && !morph) { try { g = mergeVertices(src, 1e-4); } catch { g = src; } }
    // Flat-shaded meshes store every triangle corner separately, which leaves the simplifier nothing to collapse.
    // For those, weld by position (ignoring normals), reduce, then restore the faceted look.
    const triCount = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
    const flat = !skinned && !morph && (g.attributes.position?.count ?? 0) > triCount * 2.2;
    let w = g;
    if (simp && flat) { const c = src.clone(); c.deleteAttribute('normal'); if (c.attributes.tangent) c.deleteAttribute('tangent'); try { w = mergeVertices(c, 1e-4); } catch { w = g; } }
    const pos = w.attributes.position as THREE.BufferAttribute;
    if (simp && !morph && w.index && pos && !(pos as any).isInterleavedBufferAttribute && pos.array instanceof Float32Array && w.index.count >= 300) {
      const idx = new Uint32Array(w.index.array), target = Math.max(3, Math.floor((idx.length * o.detail) / 3) * 3);
      const [kept] = simp.simplify(idx, pos.array, 3, target, 0.05, []);
      const [remap, count] = simp.compactMesh(kept); // rewrites `kept` to the compacted numbering
      let out = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(w.attributes) as [string, THREE.BufferAttribute][]) {
        const n = a.itemSize, arr = new (a.array.constructor as any)(count * n);
        for (let v = 0; v < remap.length; v++) { const to = remap[v]; if (to !== 0xffffffff) for (let k = 0; k < n; k++) arr[to * n + k] = a.array[v * n + k]; }
        out.setAttribute(name, new THREE.BufferAttribute(arr, n, a.normalized));
      }
      out.setIndex(new THREE.BufferAttribute(count > 65535 ? kept : new Uint16Array(kept), 1));
      if (flat) { const ni = out.toNonIndexed(); out.dispose(); out = ni; out.computeVertexNormals(); }
      else if (!out.attributes.normal) out.computeVertexNormals();
      g = out;
    } else if (reduce) skipped++;
    seen.set(src, g);
    m.geometry = g;
  }
  if (skipped) notes.push(`${skipped} mesh(es) kept their original detail (morphing, interleaved or very small meshes are not reduced).`);
  return notes;
}

/** Serialise to a single self-contained binary glTF. */
export async function toGLB(l: Loaded): Promise<Blob> {
  normaliseMaterials(l.scene);
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const buf = (await new GLTFExporter().parseAsync(l.scene, { binary: true, animations: l.animations, onlyVisible: false })) as ArrayBuffer;
  return new Blob([buf], { type: 'model/gltf-binary' });
}

/** Full import: load, fix units, analyse, and return the blob to store plus its description. */
export async function importModel(main: File, siblings: File[]): Promise<{ blob: Blob; fileName: string; meta: ModelMeta; notes: string[] }> {
  const l = await loadModel(main, siblings), notes: string[] = [], e = ext(main.name);
  if (!meshes(l.scene).length) throw new Error('The file contains no 3D geometry.');
  let meta = analyse(l, false);
  if (e === 'fbx' && Math.max(...meta.size) > 40) { l.scene.scale.multiplyScalar(0.01); notes.push('converted from centimetres to metres'); }
  const convert = await needsConversion(main);
  let blob: Blob = main, fileName = main.name;
  if (convert) {
    // glTF stores baked transforms; give the exporter a clean root so unit fixes are kept.
    const root = new THREE.Group();
    root.add(l.scene);
    blob = await toGLB({ scene: root, animations: l.animations });
    fileName = main.name.replace(/\.[^.]+$/, '') + '.glb';
    if (e !== 'glb') notes.push(`converted from .${e} to GLB`); else notes.push('decompressed (Draco)');
    meta = analyse({ scene: root, animations: l.animations });
  } else meta = analyse(l);
  return { blob, fileName, meta, notes };
}
