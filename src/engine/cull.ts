// Distance culling for objects tagged with `userData.cullDist` (metres). Frustum culling
// is automatic; this additionally stops far-away small things from being drawn at all.
import * as THREE from 'three';

const c = new THREE.Vector3();

export function cullByDistance(root: THREE.Object3D, cam: THREE.Vector3, scale = 1) {
  root.traverse((o: any) => {
    const d = o.userData.cullDist;
    if (!d) return;
    const bs: THREE.Sphere | null = o.boundingSphere ?? o.geometry?.boundingSphere ?? null;
    if (!bs) return;
    c.copy(bs.center).applyMatrix4(o.matrixWorld);
    o.visible = !o.userData.occluded && c.distanceTo(cam) - bs.radius * o.matrixWorld.getMaxScaleOnAxis() < d * scale;
  });
}
