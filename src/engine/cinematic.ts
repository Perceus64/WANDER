import * as THREE from 'three';
import { EASES, type Cinematic } from './types';

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), p3 = new THREE.Vector3();

const cr = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);

/** Evaluate the camera track at time t. Positions follow a Catmull-Rom path, rotations slerp. */
export function sampleCinematic(c: Cinematic, t: number, cam: THREE.PerspectiveCamera): boolean {
  const k = [...c.keys].sort((a, b) => a.t - b.t);
  if (!k.length) return false;
  let i = 0;
  while (i < k.length - 2 && t > k[i + 1].t) i++;
  const a = k[i], b = k[Math.min(i + 1, k.length - 1)];
  const span = Math.max(1e-6, b.t - a.t);
  const u = (EASES[b.ease] ?? EASES.linear)(THREE.MathUtils.clamp((t - a.t) / span, 0, 1));
  p0.fromArray(k[Math.max(i - 1, 0)].pos); p1.fromArray(a.pos); p2.fromArray(b.pos); p3.fromArray(k[Math.min(i + 2, k.length - 1)].pos);
  cam.position.set(cr(p0.x, p1.x, p2.x, p3.x, u), cr(p0.y, p1.y, p2.y, p3.y, u), cr(p0.z, p1.z, p2.z, p3.z, u));
  cam.quaternion.copy(qa.fromArray(a.quat).slerp(qb.fromArray(b.quat), u));
  const fov = a.fov + (b.fov - a.fov) * u;
  if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
  return true;
}
