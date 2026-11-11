// Turns project objects into three.js nodes. Shared by the editor viewport and
// the runtime so "what you build is what gets published".
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetProvider, Obj, Scene } from './types';
import { PREFAB_MAP, prefabCollider, prefabGeometry, prefabMaterial } from './prefabs';

export interface BuildCtx {
  editor: boolean;
  assets: AssetProvider;
  heightAt(x: number, z: number): number;
  scene: Scene;
  onAsync?: (id: string) => void;
}
export interface ColliderDesc { box: number[]; ref: THREE.Object3D; dynamic?: boolean; tag?: string; enabled: boolean }

type Builder = (o: Obj, node: THREE.Group, ctx: BuildCtx) => void;

const texCache = new Map<string, Promise<THREE.Texture | null>>();
const gltfCache = new Map<string, Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] } | null>>();
const mixers = new Set<THREE.AnimationMixer>();
/** Advance every playing model animation (called once per frame by the editor viewport and the runtime). */
export function updateAnimations(dt: number) { for (const m of mixers) m.update(dt); }
const iconCache = new Map<string, THREE.Texture>();

export function clearAssetCaches() { texCache.clear(); gltfCache.clear(); }

function loadTexture(id: string, ctx: BuildCtx) {
  if (!texCache.has(id))
    texCache.set(id, ctx.assets.url(id).then((u) => (u ? new THREE.TextureLoader().loadAsync(u) : null)).then((t) => {
      if (t) { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      return t;
    }).catch(() => null));
  return texCache.get(id)!;
}

export function stdMat(p: Record<string, any>, ctx: BuildCtx, repeat?: [number, number]): THREE.MeshStandardMaterial {
  const opacity = p.opacity ?? 1;
  const m = new THREE.MeshStandardMaterial({ color: p.color ?? '#bbbbbb', roughness: p.roughness ?? 0.85, metalness: p.metalness ?? 0, transparent: opacity < 1, opacity });
  if (p.emissive) { m.emissive.set(p.color ?? '#ffffff'); m.emissiveIntensity = p.emissive; }
  if (p.texture)
    loadTexture(p.texture, ctx).then((t) => {
      if (!t) return;
      const tex = t.clone();
      if (repeat) tex.repeat.set(repeat[0], repeat[1]);
      tex.needsUpdate = true;
      m.map = tex;
      m.needsUpdate = true;
    });
  return m;
}

const boxMesh = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};

function iconSprite(glyph: string, color: string, size = 0.6): THREE.Sprite {
  const key = glyph + color;
  let tex = iconCache.get(key);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d')!;
    g.fillStyle = color;
    g.beginPath(); g.arc(48, 48, 42, 0, Math.PI * 2); g.fill();
    g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(glyph, 48, 52);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    iconCache.set(key, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true, fog: false }));
  s.scale.setScalar(size);
  return s;
}

export function textPlane(text: string, w: number, h: number, color: string, bg: string | null): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.max(32, Math.round((512 * h) / w));
  const g = c.getContext('2d')!;
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
  const lines = String(text).split('\n');
  let fs = Math.min((c.height * 0.8) / lines.length, 120);
  g.font = `600 ${fs}px system-ui, sans-serif`;
  const widest = Math.max(...lines.map((l) => g.measureText(l).width), 1);
  if (widest > c.width * 0.92) fs *= (c.width * 0.92) / widest;
  g.font = `600 ${fs}px system-ui, sans-serif`;
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * fs * 1.15));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: !bg, side: THREE.DoubleSide }));
}

const helper = <T extends THREE.Object3D>(o: T): T => { o.userData.helper = true; return o; };
const wire = (w: number, h: number, d: number, color: number) =>
  helper(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineBasicMaterial({ color })));
const col = (node: THREE.Group, box: number[], ref: THREE.Object3D = node, extra: Partial<ColliderDesc> = {}) =>
  (node.userData.colliders as ColliderDesc[]).push({ box, ref, enabled: true, ...extra });

export function wallPieces(p: Record<string, any>): number[][] {
  const out: number[][] = [];
  let x = 0;
  const ops = [...(p.openings ?? [])].sort((a, b) => a.offset - b.offset);
  for (const op of ops) {
    const a = THREE.MathUtils.clamp(op.offset, 0, p.length), b = THREE.MathUtils.clamp(op.offset + op.width, 0, p.length);
    if (a > x + 1e-4) out.push([x, a, 0, p.height]);
    if (op.sill > 0.001) out.push([a, b, 0, Math.min(op.sill, p.height)]);
    if (op.sill + op.height < p.height - 0.001) out.push([a, b, op.sill + op.height, p.height]);
    x = Math.max(x, b);
  }
  if (x < p.length - 1e-4) out.push([x, p.length, 0, p.height]);
  return out;
}

function ribbon(pts: THREE.Vector3[], width: number, y: (x: number, z: number) => number, lift: number, offset = 0): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l;
    const cx = pts[i].x + nx * offset, cz = pts[i].z + nz * offset;
    const lx = cx + (nx * width) / 2, lz = cz + (nz * width) / 2, rx = cx - (nx * width) / 2, rz = cz - (nz * width) / 2;
    const h = Math.max(y(lx, lz), y(rx, rz), y(cx, cz)) + lift;
    pos.push(lx, h, lz, rx, h, rz);
    if (i < pts.length - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Animated GIF → canvas texture, decoded frame by frame (falls back to a still image where ImageDecoder is missing). */
async function gifTexture(data: ArrayBuffer, alive: () => boolean): Promise<THREE.Texture | null> {
  const ID = (globalThis as any).ImageDecoder;
  if (!ID) return null;
  const dec = new ID({ data, type: 'image/gif' });
  await dec.tracks.ready;
  await dec.completed;
  const count: number = dec.tracks.selectedTrack?.frameCount ?? 1;
  const first = (await dec.decode({ frameIndex: 0 })).image;
  const canvas = document.createElement('canvas');
  canvas.width = first.displayWidth; canvas.height = first.displayHeight;
  const g = canvas.getContext('2d')!;
  g.drawImage(first, 0, 0);
  let wait = (first.duration ?? 100000) / 1000;
  first.close();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  let i = 0;
  const next = async () => {
    if (!alive()) { dec.close?.(); return; }
    i = (i + 1) % count;
    try {
      const f = (await dec.decode({ frameIndex: i })).image;
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(f, 0, 0);
      wait = (f.duration ?? 100000) / 1000;
      f.close();
      tex.needsUpdate = true;
    } catch { /* keep the last good frame */ }
    setTimeout(next, Math.max(wait, 20));
  };
  if (count > 1) setTimeout(next, Math.max(wait, 20));
  return tex;
}

const BUILDERS: Partial<Record<Obj['kind'], Builder>> = {
  primitive(o, node, ctx) {
    const p = o.props;
    const g = p.shape === 'sphere' ? new THREE.SphereGeometry(0.5, 28, 18) : p.shape === 'cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 28)
      : p.shape === 'cone' ? new THREE.ConeGeometry(0.5, 1, 28) : p.shape === 'plane' ? new THREE.BoxGeometry(1, 0.02, 1) : new THREE.BoxGeometry(1, 1, 1);
    node.add(new THREE.Mesh(g, stdMat(p, ctx)));
    if (p.solid !== false) col(node, p.shape === 'plane' ? [-0.5, -0.01, -0.5, 0.5, 0.01, 0.5] : [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);
  },
  prefab(o, node) {
    const def = PREFAB_MAP[o.props.prefab];
    let mat: THREE.Material = prefabMaterial();
    if (o.props.color) { mat = prefabMaterial().clone(); (mat as THREE.MeshStandardMaterial).color.set(o.props.color); }
    const mesh = new THREE.Mesh(prefabGeometry(o.props.prefab), mat);
    mesh.userData.cullDist = THREE.MathUtils.clamp((mesh.geometry.boundingSphere?.radius ?? 1) * 240, 140, 5000);
    if (def?.small) mesh.userData.noShadowCast = true;
    node.add(mesh);
    const c = o.props.solid !== false ? prefabCollider(o.props.prefab) : null;
    if (c) col(node, c);
    if (def?.light && o.props.lightOn !== false) {
      const l = new THREE.PointLight(def.light.color, def.light.intensity, def.light.range, 1.6);
      l.position.fromArray(def.light.pos);
      node.add(l);
    }
  },
  model(o, node, ctx) {
    const ph = wire(1, 1, 1, 0x8899aa), p = o.props;
    ph.position.y = 0.5;
    node.add(ph);
    if (!p.asset) return;
    if (!gltfCache.has(p.asset))
      gltfCache.set(p.asset, ctx.assets.url(p.asset).then((u) => (u ? new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(u) : null)).then((g) => (g ? { scene: g.scene, animations: g.animations } : null)).catch((e) => { console.warn('Model failed to load', e); return null; }));
    let alive = true, mixer: THREE.AnimationMixer | null = null;
    node.userData.dispose = () => { alive = false; if (mixer) { mixer.stopAllAction(); mixers.delete(mixer); } };
    node.userData.ready = gltfCache.get(p.asset)!.then((src) => {
      if (!src || !alive) return;
      const inst = src.animations.length ? cloneSkinned(src.scene) : src.scene.clone(true);
      inst.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(inst);
      if (p.ground && !b.isEmpty()) {
        // Stand the model on its base and centre it, whatever origin the file was exported with.
        const c = b.getCenter(new THREE.Vector3());
        inst.position.sub(new THREE.Vector3(c.x, b.min.y, c.z));
        inst.updateMatrixWorld(true);
        b.setFromObject(inst);
      }
      const far = THREE.MathUtils.clamp(b.getSize(new THREE.Vector3()).length() * 120, 160, 6000);
      const parts: THREE.Box3[] = [];
      inst.traverse((m: any) => {
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        if (!m.isSkinnedMesh) { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); m.userData.cullDist = far; }
        if (p.collision === 'parts' && parts.length < 96) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); parts.push(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); }
      });
      node.remove(ph);
      node.add(inst);
      if (p.solid !== false && p.collision !== 'none' && !b.isEmpty())
        for (const c of p.collision === 'parts' && parts.length ? parts : [b]) col(node, [c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z]);
      if (src.animations.length && p.animate !== false) {
        mixer = new THREE.AnimationMixer(inst);
        mixer.clipAction(src.animations[THREE.MathUtils.clamp(p.clip | 0, 0, src.animations.length - 1)]).play();
        mixers.add(mixer);
      }
      ctx.onAsync?.(o.id);
    });
  },
  text(o, node) {
    const p = o.props;
    const m = textPlane(p.text, p.width, p.height, p.color, p.background || null);
    m.position.y = p.height / 2;
    node.add(m);
  },
  screen(o, node, ctx) {
    const p = o.props, w = p.width, h = p.height;
    node.add(boxMesh(w + 0.08, h + 0.08, 0.06, 0, h / 2 + 0.04, 0, new THREE.MeshStandardMaterial({ color: p.frame || '#15171b', roughness: 0.5 })));
    const mat = new THREE.MeshBasicMaterial({ color: 0x050607, toneMapped: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    face.position.set(0, h / 2 + 0.04, 0.032);
    face.scale.set(w, h, 1);
    face.userData.noShadowCast = true;
    node.add(face);
    if (p.solid !== false) col(node, [-w / 2 - 0.04, 0, -0.03, w / 2 + 0.04, h + 0.08, 0.03]);
    const asset = ctx.scene.assets[p.media];
    if (!asset) { if (ctx.editor) { const ic = helper(iconSprite('▶', '#8a93a0', 0.4)); ic.position.set(0, h / 2 + 0.04, 0.08); node.add(ic); } return; }
    let alive = true, url = '', video: HTMLVideoElement | null = null;
    const show = (tex: THREE.Texture, mw: number, mh: number) => {
      if (!alive) { tex.dispose(); return; }
      if (p.fit !== 'stretch' && mw && mh) { const k = Math.min(w / mw, h / mh); face.scale.set(mw * k, mh * k, 1); }
      mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
      ctx.onAsync?.(o.id);
    };
    node.userData.dispose = () => { alive = false; if (video) { video.pause(); video.removeAttribute('src'); video.load(); } if (url) URL.revokeObjectURL(url); };
    node.userData.ready = (async () => {
      const bin = await ctx.assets.bin(p.media);
      if (!bin || !alive) return;
      const isGif = /gif/i.test(asset.mime) || /\.gif$/i.test(asset.file ?? '');
      if (asset.type === 'video') {
        url = URL.createObjectURL(new Blob([bin], { type: asset.mime && asset.mime !== 'application/octet-stream' ? asset.mime : 'video/mp4' }));
        const v = (video = document.createElement('video'));
        v.src = url; v.loop = p.loop !== false; v.muted = true; v.playsInline = true; v.volume = p.volume ?? 0.8;
        await new Promise<void>((res) => { v.onloadeddata = () => res(); v.onerror = () => res(); setTimeout(res, 8000); });
        v.play().catch(() => {});
        const tex = new THREE.VideoTexture(v);
        tex.colorSpace = THREE.SRGBColorSpace;
        node.userData.screen = { video: v, sound: !!p.sound };
        show(tex, v.videoWidth, v.videoHeight);
        return;
      }
      let tex = isGif ? await gifTexture(bin, () => alive).catch(() => null) : null;
      if (!tex) {
        url = URL.createObjectURL(new Blob([bin], { type: asset.mime || 'image/png' }));
        tex = await new THREE.TextureLoader().loadAsync(url).catch(() => null);
        if (tex) tex.colorSpace = THREE.SRGBColorSpace;
      }
      if (tex) show(tex, (tex.image as any).width, (tex.image as any).height);
    })().catch((e) => console.warn(`Screen "${o.name}" could not load its media`, e));
  },
  light(o, node, ctx) {
    const p = o.props;
    let l: THREE.Light;
    if (p.type === 'spot') {
      const s = new THREE.SpotLight(p.color, p.intensity, p.range, THREE.MathUtils.degToRad(p.angle), 0.4, 1.6);
      s.target.position.set(0, -1, 0); node.add(s.target); l = s;
    } else if (p.type === 'directional') {
      const d = new THREE.DirectionalLight(p.color, p.intensity);
      d.target.position.set(0, -1, 0); node.add(d.target); l = d;
    } else l = new THREE.PointLight(p.color, p.intensity, p.range, 1.6);
    l.castShadow = !!p.castShadow;
    node.add(l);
    if (ctx.editor) node.add(helper(iconSprite('☀', '#d9a520', 0.5)));
  },
  audio(_o, node, ctx) { if (ctx.editor) node.add(helper(iconSprite('♪', '#3f7fd9', 0.5))); },
  spawn(_o, node, ctx) {
    if (!ctx.editor) return;
    const m = new THREE.MeshBasicMaterial({ color: 0x35c46a, transparent: true, opacity: 0.75 });
    const body = helper(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 12), m)); body.position.y = 0.85;
    const nose = helper(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 12), m)); nose.rotation.x = -Math.PI / 2; nose.position.set(0, 1.5, -0.5);
    node.add(body, nose);
  },
  info(o, node, ctx) { if (o.props.marker !== false || ctx.editor) node.add(helper(iconSprite('i', o.props.color || '#e8a33d', 0.55))); },
  trigger(o, node, ctx) {
    if (!ctx.editor) return;
    const [w, h, d] = o.props.size;
    const w1 = wire(w, h, d, 0x39d0c0); w1.position.y = h / 2;
    const fill = helper(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: 0x39d0c0, transparent: true, opacity: 0.07, depthWrite: false }))); fill.position.y = h / 2;
    node.add(w1, fill);
  },
  wall(o, node, ctx) {
    const p = o.props, mat = stdMat(p, ctx, [p.length / 2, p.height / 2]);
    for (const [x0, x1, y0, y1] of wallPieces(p)) {
      node.add(boxMesh(x1 - x0, y1 - y0, p.thickness, (x0 + x1) / 2, (y0 + y1) / 2, 0, mat));
      col(node, [x0, y0, -p.thickness / 2, x1, y1, p.thickness / 2]);
    }
  },
  floor(o, node, ctx) {
    const p = o.props;
    node.add(boxMesh(p.width, p.thickness, p.depth, 0, -p.thickness / 2, 0, stdMat(p, ctx, [p.width / 2, p.depth / 2])));
    col(node, [-p.width / 2, -p.thickness, -p.depth / 2, p.width / 2, 0, p.depth / 2]);
  },
  door(o, node, ctx) {
    const p = o.props, pivot = new THREE.Group();
    pivot.position.set(-p.width / 2, 0, 0);
    const mat = stdMat({ color: p.color, roughness: 0.6 }, ctx);
    pivot.add(boxMesh(p.width, p.height, 0.05, p.width / 2, p.height / 2, 0, mat));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd9c38a, metalness: 0.8, roughness: 0.3 }));
    knob.position.set(p.width - 0.1, p.height * 0.48, 0.05);
    pivot.add(knob, knob.clone().translateZ(-0.1));
    node.add(pivot);
    node.userData.door = { pivot, base: pivot.position.clone() };
    col(node, [0, 0, -0.06, p.width, p.height, 0.06], pivot, { dynamic: true, tag: 'door' });
  },
  window(o, node) {
    const p = o.props;
    node.add(boxMesh(p.width, p.height, 0.03, 0, p.height / 2, 0, new THREE.MeshStandardMaterial({ color: p.color, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2 })));
    const fm = new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.6 });
    node.add(boxMesh(p.width, 0.05, 0.07, 0, 0.025, 0, fm), boxMesh(p.width, 0.05, 0.07, 0, p.height - 0.025, 0, fm), boxMesh(0.05, p.height, 0.07, -p.width / 2 + 0.025, p.height / 2, 0, fm), boxMesh(0.05, p.height, 0.07, p.width / 2 - 0.025, p.height / 2, 0, fm), boxMesh(0.03, p.height, 0.05, 0, p.height / 2, 0, fm));
    col(node, [-p.width / 2, 0, -0.04, p.width / 2, p.height, 0.04]);
  },
  stairs(o, node, ctx) {
    const p = o.props, n = Math.max(2, Math.round(p.steps)), mat = stdMat(p, ctx);
    const dz = p.run / n, dy = p.rise / n;
    for (let i = 0; i < n; i++) {
      const h = dy * (i + 1);
      node.add(boxMesh(p.width, h, dz, 0, h / 2, (i + 0.5) * dz, mat));
      col(node, [-p.width / 2, 0, i * dz, p.width / 2, h, (i + 1) * dz]);
    }
  },
  elevator(o, node, ctx) {
    const p = o.props, { width: w, depth: d, height: h } = p, t = 0.08;
    const cabin = new THREE.Group();
    const mat = stdMat({ color: p.color, roughness: 0.45, metalness: 0.5 }, ctx);
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7 });
    cabin.add(boxMesh(w, 0.1, d, 0, -0.05, 0, dark), boxMesh(w, 0.1, d, 0, h + 0.05, 0, mat), boxMesh(w, h, t, 0, h / 2, -d / 2 + t / 2, mat), boxMesh(t, h, d, -w / 2 + t / 2, h / 2, 0, mat), boxMesh(t, h, d, w / 2 - t / 2, h / 2, 0, mat));
    const dm = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.3, metalness: 0.7 });
    const doorL = boxMesh(w / 2, h, 0.05, -w / 4, h / 2, d / 2 - 0.025, dm), doorR = boxMesh(w / 2, h, 0.05, w / 4, h / 2, d / 2 - 0.025, dm);
    const lamp = new THREE.PointLight(p.light, 5, Math.max(w, d, h) * 2.2, 1.6); lamp.position.set(0, h - 0.3, 0);
    const panel = boxMesh(0.02, 0.4, 0.25, w / 2 - t - 0.01, 1.25, d / 2 - 0.4, dark);
    let label = textPlane(p.floors[p.startFloor]?.name ?? '', 0.5, 0.25, '#ffb13d', '#111418');
    label.position.set(0, h + 0.28, d / 2 + 0.01);
    cabin.add(doorL, doorR, lamp, panel, label);
    cabin.position.y = p.floors[p.startFloor]?.y ?? 0;
    node.add(cabin);
    const add = (box: number[], tag?: string) => col(node, box, cabin, { dynamic: true, tag });
    add([-w / 2, -0.1, -d / 2, w / 2, 0, d / 2]); add([-w / 2, h, -d / 2, w / 2, h + 0.1, d / 2]);
    add([-w / 2, 0, -d / 2, w / 2, h, -d / 2 + t]); add([-w / 2, 0, -d / 2, -w / 2 + t, h, d / 2]); add([w / 2 - t, 0, -d / 2, w / 2, h, d / 2]);
    add([-w / 2, 0, d / 2 - 0.06, w / 2, h, d / 2], 'edoor');
    node.userData.elevator = {
      cabin, doorL, doorR,
      setLabel(text: string) {
        cabin.remove(label); (label.material as THREE.MeshBasicMaterial).map?.dispose();
        label = textPlane(text, 0.5, 0.25, '#ffb13d', '#111418'); label.position.set(0, h + 0.28, d / 2 + 0.01); cabin.add(label);
      },
    };
    if (ctx.editor)
      p.floors.forEach((f: any) => {
        const m = wire(w, h, d, 0xe8a33d); m.position.y = f.y + h / 2; node.add(m);
        const s = helper(textPlane(f.name, 0.6, 0.3, '#ffffff', '#b06f10')); s.position.set(-w / 2 - 0.4, f.y + 1.6, d / 2); node.add(s);
      });
  },
  platform(o, node, ctx) {
    const p = o.props, [sx, sy, sz] = p.size, mover = new THREE.Group();
    mover.add(boxMesh(sx, sy, sz, 0, -sy / 2, 0, stdMat({ color: p.color, roughness: 0.6, metalness: 0.3 }, ctx)));
    node.add(mover);
    node.userData.platform = { mover };
    col(node, [-sx / 2, -sy, -sz / 2, sx / 2, 0, sz / 2], mover, { dynamic: true });
    if (ctx.editor) {
      const ghost = wire(sx, sy, sz, 0x6d9eea); ghost.position.set(p.offset[0], p.offset[1] - sy / 2, p.offset[2]);
      const line = helper(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...(p.offset as [number, number, number]))]), new THREE.LineBasicMaterial({ color: 0x6d9eea })));
      node.add(ghost, line);
    }
  },
  road(o, node, ctx) {
    const p = o.props, raw: number[][] = p.points ?? [];
    if (raw.length < 2) return;
    const v = raw.map(([x, z]) => new THREE.Vector3(x, 0, z));
    let pts = v;
    if (v.length > 2) {
      const curve = new THREE.CatmullRomCurve3(v, !!p.closed, 'centripetal');
      pts = curve.getSpacedPoints(Math.min(1500, Math.max(8, Math.ceil(curve.getLength() / 2))));
    } else {
      const n = Math.max(2, Math.ceil(v[0].distanceTo(v[1]) / 2));
      pts = Array.from({ length: n + 1 }, (_, i) => v[0].clone().lerp(v[1], i / n));
    }
    const y = (x: number, z: number) => ctx.heightAt(x + o.pos[0], z + o.pos[2]) - o.pos[1];
    const water = p.kindOf === 'river';
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: water ? 0.15 : 0.95, metalness: water ? 0.3 : 0, side: THREE.DoubleSide, transparent: water, opacity: water ? 0.8 : 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(ribbon(pts, p.width, y, water ? 0.05 : 0.1), mat);
    m.userData.noShadowCast = true;
    node.add(m);
    if (p.sidewalks) {
      const sm = new THREE.MeshStandardMaterial({ color: 0xb4b1a8, roughness: 0.95, side: THREE.DoubleSide });
      for (const s of [-1, 1]) { const sw = new THREE.Mesh(ribbon(pts, 1.6, y, 0.2, s * (p.width / 2 + 0.8)), sm); sw.userData.noShadowCast = true; node.add(sw); }
    }
  },
  poly(o, node, ctx) {
    const p = o.props, raw: number[][] = p.points ?? [];
    if (raw.length < 3) return;
    const shape = new THREE.Shape(raw.map(([x, z]) => new THREE.Vector2(x, -z)));
    const hs = raw.map(([x, z]) => ctx.heightAt(x + o.pos[0], z + o.pos[2]));
    const g: THREE.BufferGeometry = p.height > 0 ? new THREE.ExtrudeGeometry(shape, { depth: p.height + (Math.max(...hs) - Math.min(...hs)), bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const flat = !(p.height > 0);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: p.color, roughness: flat ? 0.2 : 0.9, metalness: flat ? 0.25 : 0, transparent: p.opacity < 1, opacity: p.opacity, side: THREE.DoubleSide }));
    const base = flat ? hs.reduce((a, b) => a + b, 0) / hs.length + 0.06 : Math.min(...hs);
    m.position.y = base - o.pos[1];
    if (flat) m.userData.noShadowCast = true;
    node.add(m);
    if (!flat && p.solid !== false) {
      const xs = raw.map((q) => q[0]), zs = raw.map((q) => q[1]);
      col(node, [Math.min(...xs), m.position.y, Math.min(...zs), Math.max(...xs), m.position.y + p.height + Math.max(...hs) - Math.min(...hs), Math.max(...zs)]);
    }
  },
  scatter(o, node, ctx) {
    const items: number[] = o.props.items ?? [], n = items.length / 4;
    if (!n) return;
    // Instances are grouped into ground cells so each cell can be frustum- and distance-culled on its own.
    const CELL = 48, cells = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const k = `${Math.floor(items[i * 4] / CELL)},${Math.floor(items[i * 4 + 1] / CELL)}`;
      let l = cells.get(k);
      if (!l) cells.set(k, (l = []));
      l.push(i);
    }
    const def = PREFAB_MAP[o.props.prefab], geo = prefabGeometry(o.props.prefab), r = geo.boundingSphere?.radius ?? 1;
    const far = def?.small ? 120 : r < 1.3 ? 320 : 1600;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), v = new THREE.Vector3();
    for (const list of cells.values()) {
      const im = new THREE.InstancedMesh(geo, prefabMaterial(), list.length);
      list.forEach((i, k) => {
        const x = items[i * 4], z = items[i * 4 + 1];
        v.set(x, ctx.heightAt(x + o.pos[0], z + o.pos[2]) - o.pos[1], z);
        im.setMatrixAt(k, m.compose(v, q.setFromAxisAngle(up, items[i * 4 + 3]), s.setScalar(items[i * 4 + 2])));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.userData.cullDist = far;
      if (def?.small) im.userData.noShadowCast = true;
      node.add(im);
    }
  },
  water(o, node) {
    const p = o.props;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.depth).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: p.color, transparent: true, opacity: p.opacity, roughness: 0.12, metalness: 0.35, side: THREE.DoubleSide }));
    m.userData.noShadowCast = true;
    node.add(m);
  },
};

export function applyTransform(node: THREE.Object3D, o: Obj) {
  node.position.fromArray(o.pos);
  node.rotation.set(THREE.MathUtils.degToRad(o.rot[0]), THREE.MathUtils.degToRad(o.rot[1]), THREE.MathUtils.degToRad(o.rot[2]));
  node.scale.fromArray(o.scale);
  node.visible = o.visible;
}

export function buildNode(o: Obj, ctx: BuildCtx): THREE.Group {
  const node = new THREE.Group();
  node.name = o.name;
  node.userData = { id: o.id, kind: o.kind, colliders: [] };
  try {
    BUILDERS[o.kind]?.(o, node, ctx);
  } catch (e) {
    console.warn(`Could not build "${o.name}"`, e);
  }
  node.traverse((m: any) => {
    if (m.isMesh && !m.userData.helper) {
      m.castShadow = !m.material?.transparent && !m.userData.noShadowCast;
      m.receiveShadow = true;
    }
  });
  applyTransform(node, o);
  return node;
}

export function disposeNode(node: THREE.Object3D, shared = new Set<any>([prefabMaterial()])) {
  node.userData.dispose?.();
  node.traverse((m: any) => {
    if (m.userData?.id && m !== node) return;
    if (m.geometry && !m.geometry.userData?.shared && !(m.isMesh && m.material === prefabMaterial())) m.geometry.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mt of mats) if (!shared.has(mt)) { mt.map?.dispose?.(); mt.dispose?.(); }
  });
}
