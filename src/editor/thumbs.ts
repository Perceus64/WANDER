// Small rendered previews for the asset library (built-in prefabs and imported models).
import * as THREE from 'three';
import { prefabGeometry, prefabMaterial } from '../engine/prefabs';

let renderer: THREE.WebGLRenderer | null = null, scene: THREE.Scene, camera: THREE.PerspectiveCamera, holder: THREE.Group;
const cache = new Map<string, string>();

function setup(size: number) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(28, 1, 0.01, 5000);
    const sun = new THREE.DirectionalLight(0xfff4e0, 3.2);
    sun.position.set(3, 6, 4);
    holder = new THREE.Group();
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x6a5f55, 1.5), sun, holder);
  }
  renderer.setSize(size, size, false);
}

/** Render any object to a PNG data URL, framed to fill the picture. The object is not modified. */
export function renderThumb(obj: THREE.Object3D, size = 96): string {
  setup(size);
  holder.add(obj);
  const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.01);
  const d = (r / Math.sin((camera.fov * Math.PI) / 360)) * 1.02;
  camera.position.copy(c).add(new THREE.Vector3(0.62, 0.42, 0.78).normalize().multiplyScalar(d));
  camera.near = d / 100; camera.far = d * 4;
  camera.lookAt(c);
  camera.updateProjectionMatrix();
  renderer!.render(scene, camera);
  holder.remove(obj);
  return renderer!.domElement.toDataURL('image/png');
}

export const prefabThumb = (key: string) => cache.get(key);

/** Generate missing previews a few at a time so the interface never stalls. Calls `onBatch` after each batch. */
export function warmThumbs(keys: string[], onBatch: () => void) {
  const todo = keys.filter((k) => !cache.has(k));
  let stopped = false;
  const step = () => {
    if (stopped) return;
    for (const k of todo.splice(0, 6)) {
      try { cache.set(k, renderThumb(new THREE.Mesh(prefabGeometry(k), prefabMaterial()))); } catch { cache.set(k, ''); }
    }
    onBatch();
    if (todo.length) setTimeout(step, 16);
    else if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer = null; }
  };
  if (todo.length) setTimeout(step, 60);
  return () => { stopped = true; };
}

/** Larger one-off preview of a built-in asset (used by tests and support tooling). */
export const prefabPreview = (key: string, size = 256) => renderThumb(new THREE.Mesh(prefabGeometry(key), prefabMaterial()), size);
(globalThis as any).wanderPrefabPreview = prefabPreview;
