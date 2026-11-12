//! Occlusion culling. Large static boxes (walls, floors, buildings) and the terrain act as
//! occluders; every candidate object is tested by casting sight lines from the eye to its
//! bounding box. An object is reported hidden only when every line is blocked, from the
//! current eye position and from a predicted one, so things about to come into view stay drawn.

use crate::Terrain;

struct Occluder {
    owner: u32,
    c: [f32; 3],
    h: [f32; 3],
    ax: f32,
    az: f32,
    /// Radius of the bounding sphere, for a quick reject.
    r: f32,
}

#[derive(Default)]
pub struct Occlusion {
    boxes: Vec<Occluder>,
    scratch: Vec<u32>,
}

/// Floats per target in the input buffer: centre xyz, half-size xyz, owner id.
pub const TARGET_STRIDE: usize = 7;

impl Occlusion {
    pub fn clear(&mut self) {
        self.boxes.clear();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add(&mut self, owner: u32, c: [f32; 3], h: [f32; 3], ax: f32, az: f32) {
        let r = (h[0] * h[0] + h[1] * h[1] + h[2] * h[2]).sqrt();
        self.boxes.push(Occluder { owner, c, h, ax, az, r });
    }

    pub fn len(&self) -> usize {
        self.boxes.len()
    }
    pub fn is_empty(&self) -> bool {
        self.boxes.is_empty()
    }

    /// Does the segment a→b pass through the box (ignoring the first and last few percent)?
    fn blocks(o: &Occluder, a: [f32; 3], b: [f32; 3]) -> bool {
        let la = Self::local(o, a);
        let lb = Self::local(o, b);
        let (mut t0, mut t1) = (0.02f32, 0.97f32);
        for k in 0..3 {
            let d = lb[k] - la[k];
            if d.abs() < 1e-7 {
                if la[k].abs() > o.h[k] {
                    return false;
                }
                continue;
            }
            let (mut n, mut f) = ((-o.h[k] - la[k]) / d, (o.h[k] - la[k]) / d);
            if n > f {
                std::mem::swap(&mut n, &mut f);
            }
            if n > t0 {
                t0 = n;
            }
            if f < t1 {
                t1 = f;
            }
            if t0 > t1 {
                return false;
            }
        }
        true
    }

    fn local(o: &Occluder, p: [f32; 3]) -> [f32; 3] {
        let (dx, dz) = (p[0] - o.c[0], p[2] - o.c[2]);
        [dx * o.ax + dz * o.az, p[1] - o.c[1], -dx * o.az + dz * o.ax]
    }

    fn inside(o: &Occluder, p: [f32; 3], grow: f32) -> bool {
        let l = Self::local(o, p);
        l[0].abs() <= o.h[0] + grow && l[1].abs() <= o.h[1] + grow && l[2].abs() <= o.h[2] + grow
    }

    /// Is the sight line under ground somewhere along the way? Samples the heightfield with a margin.
    fn terrain_blocks(t: &Terrain, a: [f32; 3], b: [f32; 3]) -> bool {
        let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let len = (d[0] * d[0] + d[2] * d[2]).sqrt();
        let step = (t.cell * 1.5).max(1.0);
        let n = (len / step) as usize;
        if n < 3 {
            return false;
        }
        for i in 1..n {
            let f = i as f32 / n as f32;
            if f > 0.93 {
                break;
            }
            let (x, y, z) = (a[0] + d[0] * f, a[1] + d[1] * f, a[2] + d[2] * f);
            if y < t.height_at(x, z) - 0.6 {
                return true;
            }
        }
        false
    }

    /// Test `n` targets. `out[i]` becomes 1 when target i is hidden from both eye positions.
    pub fn test(&mut self, terrain: Option<&Terrain>, eyes: [[f32; 3]; 2], targets: &[f32], out: &mut [u8]) {
        let n = out.len().min(targets.len() / TARGET_STRIDE);
        let two = (eyes[0][0] - eyes[1][0]).abs() + (eyes[0][1] - eyes[1][1]).abs() + (eyes[0][2] - eyes[1][2]).abs() > 0.05;
        let mut cand = std::mem::take(&mut self.scratch);
        for i in 0..n {
            let t = &targets[i * TARGET_STRIDE..(i + 1) * TARGET_STRIDE];
            let (c, h, owner) = ([t[0], t[1], t[2]], [t[3], t[4], t[5]], t[6] as u32);
            let tr = (h[0] * h[0] + h[1] * h[1] + h[2] * h[2]).sqrt();
            let mut hidden = true;
            'eyes: for (e, eye) in eyes.iter().enumerate() {
                if e == 1 && !two {
                    break;
                }
                let to = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]];
                let dist = (to[0] * to[0] + to[1] * to[1] + to[2] * to[2]).sqrt();
                // Close objects, and objects the eye is inside of, are always drawn.
                if dist < tr + 4.0 {
                    hidden = false;
                    break;
                }
                // Occluders that can matter lie near the corridor between the eye and the target.
                cand.clear();
                for (k, o) in self.boxes.iter().enumerate() {
                    if o.owner == owner || Self::inside(o, *eye, 0.3) {
                        continue;
                    }
                    let oc = [o.c[0] - eye[0], o.c[1] - eye[1], o.c[2] - eye[2]];
                    let along = (oc[0] * to[0] + oc[1] * to[1] + oc[2] * to[2]) / dist;
                    if along < -o.r || along > dist + o.r {
                        continue;
                    }
                    let f = (along / dist).clamp(0.0, 1.0);
                    let off = [oc[0] - to[0] * f, oc[1] - to[1] * f, oc[2] - to[2] * f];
                    if (off[0] * off[0] + off[1] * off[1] + off[2] * off[2]).sqrt() > o.r + tr {
                        continue;
                    }
                    // An occluder touching the target (a wall the picture hangs on) must not hide it.
                    if Self::inside(o, c, h[0].max(h[1]).max(h[2]) + 0.05) {
                        continue;
                    }
                    cand.push(k as u32);
                }
                if cand.is_empty() && terrain.is_none() {
                    hidden = false;
                    break;
                }
                // First the centre and the eight corners. If the ground alone hides all of them, the object is
                // behind a hill and we are done.
                let mut all_terrain = terrain.is_some();
                for s in 0..9 {
                    let p = if s == 0 {
                        c
                    } else {
                        let b = s - 1;
                        [
                            c[0] + if b & 1 == 0 { -h[0] } else { h[0] } * 0.94,
                            c[1] + if b & 2 == 0 { -h[1] } else { h[1] } * 0.94,
                            c[2] + if b & 4 == 0 { -h[2] } else { h[2] } * 0.94,
                        ]
                    };
                    let by_ground = terrain.is_some_and(|tn| Self::terrain_blocks(tn, *eye, p));
                    all_terrain &= by_ground;
                    if !by_ground && !cand.iter().any(|&k| Self::blocks(&self.boxes[k as usize], *eye, p)) {
                        hidden = false;
                        break 'eyes;
                    }
                }
                if all_terrain || cand.is_empty() {
                    continue;
                }
                // Walls are involved: sample a denser grid through the box (a point about every 0.8 m) so that
                // anything showing through a window or doorway is caught.
                let steps = |half: f32, cap: usize| -> usize { ((half * 2.0 / 0.8).ceil() as usize + 1).clamp(2, cap) };
                let (nx, ny, nz) = (steps(h[0], 7), steps(h[1], 4), steps(h[2], 7));
                let at = |k: usize, n: usize, half: f32| -> f32 { (k as f32 / (n - 1) as f32 * 2.0 - 1.0) * half * 0.94 };
                for q in 0..nx * ny * nz {
                    let p = [c[0] + at(q % nx, nx, h[0]), c[1] + at((q / nx) % ny, ny, h[1]), c[2] + at(q / (nx * ny), nz, h[2])];
                    if !cand.iter().any(|&k| Self::blocks(&self.boxes[k as usize], *eye, p)) && !terrain.is_some_and(|tn| Self::terrain_blocks(tn, *eye, p)) {
                        hidden = false;
                        break 'eyes;
                    }
                }
            }
            out[i] = hidden as u8;
        }
        self.scratch = cand;
    }
}
