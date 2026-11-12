//! WANDER core engine module.
//!
//! Plain C-ABI exports (no wasm-bindgen) so the module builds with nothing but
//! `cargo build --target wasm32-unknown-unknown`. The TypeScript side
//! (`src/engine/wasm.ts`) wraps these exports.
//!
//! Terrain layout: `w * h` height samples in metres, row-major (z rows),
//! centred on the world origin, `cell` metres apart. Eight material weights
//! (u8) per sample drive vertex colours.
#![allow(clippy::missing_safety_doc, clippy::too_many_arguments)]

mod occlusion;
use occlusion::Occlusion;
use std::alloc::{alloc, dealloc, Layout};

pub const LAYERS: usize = 8;

pub struct Terrain {
    w: usize,
    h: usize,
    cell: f32,
    exag: f32,
    heights: Vec<f32>,
    original: Vec<f32>,
    has_original: bool,
    splat: Vec<u8>,
    dirty: [i32; 4],
    pos: Vec<f32>,
    nor: Vec<f32>,
    col: Vec<f32>,
    idx: Vec<u32>,
}

// ---------------------------------------------------------------- memory

#[no_mangle]
pub extern "C" fn w_alloc(bytes: usize) -> *mut u8 {
    if bytes == 0 {
        return core::ptr::null_mut();
    }
    unsafe { alloc(Layout::from_size_align_unchecked(bytes, 8)) }
}

#[no_mangle]
pub unsafe extern "C" fn w_free(ptr: *mut u8, bytes: usize) {
    if !ptr.is_null() && bytes > 0 {
        dealloc(ptr, Layout::from_size_align_unchecked(bytes, 8));
    }
}

// ---------------------------------------------------------------- noise

fn hash(x: i32, y: i32, seed: u32) -> f32 {
    let mut h = (x as u32).wrapping_mul(374_761_393)
        ^ (y as u32).wrapping_mul(668_265_263)
        ^ seed.wrapping_mul(2_246_822_519);
    h = (h ^ (h >> 13)).wrapping_mul(1_274_126_177);
    h ^= h >> 16;
    (h & 0x00ff_ffff) as f32 / 16_777_215.0
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    if (b - a).abs() < 1e-9 {
        return if x < a { 0.0 } else { 1.0 };
    }
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn vnoise(x: f32, y: f32, seed: u32) -> f32 {
    let xf = x.floor();
    let yf = y.floor();
    let fx = x - xf;
    let fy = y - yf;
    let u = fx * fx * (3.0 - 2.0 * fx);
    let v = fy * fy * (3.0 - 2.0 * fy);
    let (xi, yi) = (xf as i32, yf as i32);
    lerp(
        lerp(hash(xi, yi, seed), hash(xi + 1, yi, seed), u),
        lerp(hash(xi, yi + 1, seed), hash(xi + 1, yi + 1, seed), u),
        v,
    )
}

fn fbm(mut x: f32, mut y: f32, seed: u32, octaves: u32) -> f32 {
    let mut amp = 0.5;
    let mut sum = 0.0;
    let mut norm = 0.0;
    for o in 0..octaves {
        sum += amp * vnoise(x, y, seed.wrapping_add(o * 101));
        norm += amp;
        amp *= 0.5;
        x = x * 2.03 + 17.1;
        y = y * 2.03 - 9.7;
    }
    sum / norm
}

// ---------------------------------------------------------------- terrain

impl Terrain {
    fn new(w: usize, h: usize, cell: f32) -> Self {
        let n = w * h;
        let mut splat = vec![0u8; n * LAYERS];
        for i in 0..n {
            splat[i * LAYERS] = 255;
        }
        Terrain {
            w,
            h,
            cell,
            exag: 1.0,
            heights: vec![0.0; n],
            original: Vec::new(),
            has_original: false,
            splat,
            dirty: [0; 4],
            pos: Vec::new(),
            nor: Vec::new(),
            col: Vec::new(),
            idx: Vec::new(),
        }
    }

    #[inline]
    fn at(&self, i: i32, j: i32) -> f32 {
        let i = i.clamp(0, self.w as i32 - 1) as usize;
        let j = j.clamp(0, self.h as i32 - 1) as usize;
        self.heights[j * self.w + i]
    }

    #[inline]
    fn to_grid(&self, x: f32, z: f32) -> (f32, f32) {
        (
            x / self.cell + (self.w as f32 - 1.0) * 0.5,
            z / self.cell + (self.h as f32 - 1.0) * 0.5,
        )
    }

    pub fn height_at(&self, x: f32, z: f32) -> f32 {
        let (gx, gz) = self.to_grid(x, z);
        let gx = gx.clamp(0.0, self.w as f32 - 1.0);
        let gz = gz.clamp(0.0, self.h as f32 - 1.0);
        let i = gx.floor() as i32;
        let j = gz.floor() as i32;
        let fx = gx - i as f32;
        let fz = gz - j as f32;
        let a = lerp(self.at(i, j), self.at(i + 1, j), fx);
        let b = lerp(self.at(i, j + 1), self.at(i + 1, j + 1), fx);
        lerp(a, b, fz) * self.exag
    }

    fn normal(&self, i: i32, j: i32, step: i32) -> [f32; 3] {
        let hx = (self.at(i + step, j) - self.at(i - step, j)) * self.exag;
        let hz = (self.at(i, j + step) - self.at(i, j - step)) * self.exag;
        let d = 2.0 * step as f32 * self.cell;
        let (nx, ny, nz) = (-hx, d, -hz);
        let l = (nx * nx + ny * ny + nz * nz).sqrt().max(1e-9);
        [nx / l, ny / l, nz / l]
    }

    pub fn generate(&mut self, seed: u32, amplitude: f32, frequency: f32, octaves: u32) {
        for j in 0..self.h {
            for i in 0..self.w {
                let x = i as f32 * self.cell * frequency;
                let y = j as f32 * self.cell * frequency;
                let base = fbm(x, y, seed, octaves);
                let ridge = 1.0 - (2.0 * fbm(x * 0.5 + 31.0, y * 0.5 + 7.0, seed ^ 0x9e37, octaves) - 1.0).abs();
                let m = fbm(x * 0.25, y * 0.25, seed ^ 0x51f1, 3);
                let v = lerp(base, ridge * ridge, smoothstep(0.45, 0.7, m));
                self.heights[j * self.w + i] = (v - 0.35).max(-0.1) * amplitude;
            }
        }
    }

    fn brush_bounds(&self, x: f32, z: f32, radius: f32) -> (f32, f32, i32, i32, i32, i32) {
        let (gx, gz) = self.to_grid(x, z);
        let r = radius / self.cell;
        let i0 = ((gx - r).floor() as i32).max(0);
        let i1 = ((gx + r).ceil() as i32).min(self.w as i32 - 1);
        let j0 = ((gz - r).floor() as i32).max(0);
        let j1 = ((gz + r).ceil() as i32).min(self.h as i32 - 1);
        (gx, gz, i0, i1, j0, j1)
    }

    /// mode: 0 raise, 1 lower, 2 smooth, 3 flatten (towards `target`, world metres)
    pub fn brush(&mut self, mode: u32, x: f32, z: f32, radius: f32, strength: f32, target: f32) {
        let (gx, gz, i0, i1, j0, j1) = self.brush_bounds(x, z, radius);
        self.dirty = [i0, j0, i1, j1];
        let r = (radius / self.cell).max(1e-6);
        let tgt = target / self.exag.max(1e-6);
        for j in j0..=j1 {
            for i in i0..=i1 {
                let dx = (i as f32 - gx) / r;
                let dz = (j as f32 - gz) / r;
                let d2 = dx * dx + dz * dz;
                if d2 >= 1.0 {
                    continue;
                }
                let f = (1.0 - d2) * (1.0 - d2);
                let k = j as usize * self.w + i as usize;
                let hcur = self.heights[k];
                self.heights[k] = match mode {
                    0 => hcur + strength * f,
                    1 => hcur - strength * f,
                    2 => {
                        let avg = (self.at(i - 1, j) + self.at(i + 1, j) + self.at(i, j - 1) + self.at(i, j + 1) + hcur) / 5.0;
                        hcur + (avg - hcur) * (strength.min(1.0)) * f
                    }
                    _ => hcur + (tgt - hcur) * (strength.min(1.0)) * f,
                };
            }
        }
    }

    pub fn paint(&mut self, layer: usize, x: f32, z: f32, radius: f32, strength: f32) {
        let (gx, gz, i0, i1, j0, j1) = self.brush_bounds(x, z, radius);
        self.dirty = [i0, j0, i1, j1];
        let r = (radius / self.cell).max(1e-6);
        let layer = layer.min(LAYERS - 1);
        for j in j0..=j1 {
            for i in i0..=i1 {
                let dx = (i as f32 - gx) / r;
                let dz = (j as f32 - gz) / r;
                let d2 = dx * dx + dz * dz;
                if d2 >= 1.0 {
                    continue;
                }
                let f = ((1.0 - d2) * strength).clamp(0.0, 1.0);
                let k = (j as usize * self.w + i as usize) * LAYERS;
                let mut wts = [0f32; LAYERS];
                for l in 0..LAYERS {
                    wts[l] = self.splat[k + l] as f32 * (1.0 - f);
                }
                wts[layer] += 255.0 * f;
                self.write_weights(k, &wts);
            }
        }
    }

    fn write_weights(&mut self, k: usize, wts: &[f32; LAYERS]) {
        let sum: f32 = wts.iter().sum();
        if sum <= 0.0 {
            self.splat[k] = 255;
            for l in 1..LAYERS {
                self.splat[k + l] = 0;
            }
            return;
        }
        for l in 0..LAYERS {
            self.splat[k + l] = (wts[l] / sum * 255.0).round() as u8;
        }
    }

    /// Automatic material blending by slope and elevation.
    /// grass(0) base, sand(2) below `sand_h`, rock(3) on slopes steeper than
    /// `rock_slope` degrees, snow(4) above `snow_h` (world metres).
    pub fn auto_paint(&mut self, rock_slope: f32, snow_h: f32, sand_h: f32) {
        for j in 0..self.h as i32 {
            for i in 0..self.w as i32 {
                let n = self.normal(i, j, 1);
                let slope = n[1].clamp(-1.0, 1.0).acos().to_degrees();
                let y = self.at(i, j) * self.exag;
                let rock = smoothstep(rock_slope - 8.0, rock_slope + 8.0, slope);
                let band = ((snow_h - sand_h).abs() * 0.08).max(1.0);
                let snow = smoothstep(snow_h - band, snow_h + band, y) * (1.0 - rock * 0.6);
                let sand = (1.0 - smoothstep(sand_h - band * 0.5, sand_h + band * 0.5, y)) * (1.0 - rock);
                let mut wts = [0f32; LAYERS];
                wts[3] = rock * (1.0 - snow);
                wts[4] = snow;
                wts[2] = sand * (1.0 - snow);
                wts[0] = (1.0 - wts[3] - wts[4] - wts[2]).max(0.0);
                let k = (j as usize * self.w + i as usize) * LAYERS;
                self.write_weights(k, &wts);
            }
        }
        self.dirty = [0, 0, self.w as i32 - 1, self.h as i32 - 1];
    }

    fn color(&self, i: i32, j: i32, palette: &[f32]) -> [f32; 3] {
        let i = i.clamp(0, self.w as i32 - 1) as usize;
        let j = j.clamp(0, self.h as i32 - 1) as usize;
        let k = (j * self.w + i) * LAYERS;
        let mut c = [0f32; 3];
        for l in 0..LAYERS {
            let wgt = self.splat[k + l] as f32 / 255.0;
            if wgt > 0.0 {
                c[0] += palette[l * 3] * wgt;
                c[1] += palette[l * 3 + 1] * wgt;
                c[2] += palette[l * 3 + 2] * wgt;
            }
        }
        // subtle per-cell variation so flat colours do not band
        let v = 0.94 + 0.12 * hash(i as i32, j as i32, 7);
        [c[0] * v, c[1] * v, c[2] * v]
    }

    /// Build a chunk mesh covering cells [i0, i0+ci] x [j0, j0+cj] sampled every `step` cells.
    pub fn chunk(&mut self, i0: i32, j0: i32, ci: i32, cj: i32, step: i32, palette: &[f32]) {
        let step = step.max(1);
        let nx = (ci / step + 1) as usize;
        let nz = (cj / step + 1) as usize;
        let mut pos = std::mem::take(&mut self.pos);
        let mut nor = std::mem::take(&mut self.nor);
        let mut col = std::mem::take(&mut self.col);
        let mut idx = std::mem::take(&mut self.idx);
        pos.clear();
        nor.clear();
        col.clear();
        idx.clear();
        let ox = (self.w as f32 - 1.0) * 0.5;
        let oz = (self.h as f32 - 1.0) * 0.5;
        for b in 0..nz {
            for a in 0..nx {
                let i = i0 + a as i32 * step;
                let j = j0 + b as i32 * step;
                pos.push((i as f32 - ox) * self.cell);
                pos.push(self.at(i, j) * self.exag);
                pos.push((j as f32 - oz) * self.cell);
                nor.extend_from_slice(&self.normal(i, j, step));
                col.extend_from_slice(&self.color(i, j, palette));
            }
        }
        for b in 0..nz - 1 {
            for a in 0..nx - 1 {
                let v00 = (b * nx + a) as u32;
                let v10 = v00 + 1;
                let v01 = v00 + nx as u32;
                let v11 = v01 + 1;
                idx.extend_from_slice(&[v00, v01, v10, v10, v01, v11]);
            }
        }
        // skirts hide cracks between neighbouring chunks at different LODs
        let drop = self.cell * step as f32 * 2.0 + 0.5;
        let mut ring: Vec<u32> = Vec::with_capacity(2 * (nx + nz));
        for a in 0..nx {
            ring.push(a as u32);
        }
        for b in 1..nz {
            ring.push((b * nx + nx - 1) as u32);
        }
        for a in (0..nx - 1).rev() {
            ring.push(((nz - 1) * nx + a) as u32);
        }
        for b in (1..nz - 1).rev() {
            ring.push((b * nx) as u32);
        }
        let base = (pos.len() / 3) as u32;
        for &v in &ring {
            let p = v as usize * 3;
            pos.push(pos[p]);
            pos.push(pos[p + 1] - drop);
            pos.push(pos[p + 2]);
            for q in 0..3 {
                nor.push(nor[p + q]);
            }
            for q in 0..3 {
                col.push(col[p + q]);
            }
        }
        let n = ring.len() as u32;
        for k in 0..n {
            let a = ring[k as usize];
            let b = ring[((k + 1) % n) as usize];
            let c = base + k;
            let d = base + (k + 1) % n;
            idx.extend_from_slice(&[a, b, c, b, d, c, a, c, b, b, c, d]);
        }
        self.pos = pos;
        self.nor = nor;
        self.col = col;
        self.idx = idx;
    }

    /// Ray march against the height field. Returns distance along the ray or -1.
    pub fn raycast(&self, o: [f32; 3], d: [f32; 3], max_dist: f32) -> f32 {
        let step = (self.cell * 0.5).max(0.05);
        let half_x = (self.w as f32 - 1.0) * 0.5 * self.cell;
        let half_z = (self.h as f32 - 1.0) * 0.5 * self.cell;
        let mut t = 0.0f32;
        let mut prev_t = 0.0f32;
        let mut prev_above = true;
        let mut first = true;
        while t <= max_dist {
            let x = o[0] + d[0] * t;
            let y = o[1] + d[1] * t;
            let z = o[2] + d[2] * t;
            let inside = x.abs() <= half_x && z.abs() <= half_z;
            if inside {
                let above = y > self.height_at(x, z);
                if !above {
                    if first {
                        return -1.0;
                    }
                    if !prev_above {
                        return t;
                    }
                    let (mut lo, mut hi) = (prev_t, t);
                    for _ in 0..16 {
                        let mid = 0.5 * (lo + hi);
                        let my = o[1] + d[1] * mid;
                        if my > self.height_at(o[0] + d[0] * mid, o[2] + d[2] * mid) {
                            lo = mid;
                        } else {
                            hi = mid;
                        }
                    }
                    return hi;
                }
                prev_above = above;
                first = false;
            } else {
                prev_above = true;
                first = false;
            }
            prev_t = t;
            // take larger steps when far above the surface
            t += step.max(t * 0.01);
        }
        -1.0
    }
}

// ---------------------------------------------------------------- exports

#[no_mangle]
pub extern "C" fn terrain_new(w: u32, h: u32, cell: f32) -> *mut Terrain {
    Box::into_raw(Box::new(Terrain::new(w as usize, h as usize, cell)))
}
#[no_mangle]
pub unsafe extern "C" fn terrain_free(t: *mut Terrain) {
    if !t.is_null() {
        drop(Box::from_raw(t));
    }
}
#[no_mangle]
pub unsafe extern "C" fn terrain_heights(t: *mut Terrain) -> *mut f32 {
    (*t).heights.as_mut_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn terrain_splat(t: *mut Terrain) -> *mut u8 {
    (*t).splat.as_mut_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn terrain_original(t: *mut Terrain) -> *mut f32 {
    let t = &mut *t;
    if t.has_original {
        t.original.as_mut_ptr()
    } else {
        core::ptr::null_mut()
    }
}
/// Allocate (zeroed) storage for the original heights so JS can copy saved data in.
#[no_mangle]
pub unsafe extern "C" fn terrain_alloc_original(t: *mut Terrain) -> *mut f32 {
    let t = &mut *t;
    t.original = vec![0.0; t.w * t.h];
    t.has_original = true;
    t.original.as_mut_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn terrain_snapshot_original(t: *mut Terrain) {
    let t = &mut *t;
    t.original = t.heights.clone();
    t.has_original = true;
}
#[no_mangle]
pub unsafe extern "C" fn terrain_restore_original(t: *mut Terrain) -> i32 {
    let t = &mut *t;
    if !t.has_original {
        return 0;
    }
    t.heights.copy_from_slice(&t.original);
    t.dirty = [0, 0, t.w as i32 - 1, t.h as i32 - 1];
    1
}
#[no_mangle]
pub unsafe extern "C" fn terrain_set_exag(t: *mut Terrain, e: f32) {
    (*t).exag = e.max(0.01);
}
#[no_mangle]
pub unsafe extern "C" fn terrain_generate(t: *mut Terrain, seed: u32, amplitude: f32, frequency: f32, octaves: u32) {
    (*t).generate(seed, amplitude, frequency, octaves.clamp(1, 10));
}
#[no_mangle]
pub unsafe extern "C" fn terrain_brush(t: *mut Terrain, mode: u32, x: f32, z: f32, radius: f32, strength: f32, target: f32) {
    (*t).brush(mode, x, z, radius, strength, target);
}
#[no_mangle]
pub unsafe extern "C" fn terrain_paint(t: *mut Terrain, layer: u32, x: f32, z: f32, radius: f32, strength: f32) {
    (*t).paint(layer as usize, x, z, radius, strength);
}
#[no_mangle]
pub unsafe extern "C" fn terrain_auto_paint(t: *mut Terrain, rock_slope: f32, snow_h: f32, sand_h: f32) {
    (*t).auto_paint(rock_slope, snow_h, sand_h);
}
#[no_mangle]
pub unsafe extern "C" fn terrain_dirty(t: *mut Terrain, k: u32) -> i32 {
    (*t).dirty[(k & 3) as usize]
}
#[no_mangle]
pub unsafe extern "C" fn terrain_height_at(t: *mut Terrain, x: f32, z: f32) -> f32 {
    (*t).height_at(x, z)
}
#[no_mangle]
pub unsafe extern "C" fn terrain_min(t: *mut Terrain) -> f32 {
    let t = &*t;
    t.heights.iter().cloned().fold(f32::INFINITY, f32::min) * t.exag
}
#[no_mangle]
pub unsafe extern "C" fn terrain_max(t: *mut Terrain) -> f32 {
    let t = &*t;
    t.heights.iter().cloned().fold(f32::NEG_INFINITY, f32::max) * t.exag
}
#[no_mangle]
pub unsafe extern "C" fn terrain_chunk(t: *mut Terrain, i0: i32, j0: i32, ci: i32, cj: i32, step: i32, palette: *const f32) {
    let pal = core::slice::from_raw_parts(palette, LAYERS * 3);
    (*t).chunk(i0, j0, ci, cj, step, pal);
}
#[no_mangle]
pub unsafe extern "C" fn terrain_mesh_pos(t: *mut Terrain) -> *const f32 {
    (*t).pos.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn terrain_mesh_nor(t: *mut Terrain) -> *const f32 {
    (*t).nor.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn terrain_mesh_col(t: *mut Terrain) -> *const f32 {
    (*t).col.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn terrain_mesh_idx(t: *mut Terrain) -> *const u32 {
    (*t).idx.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn terrain_mesh_vcount(t: *mut Terrain) -> u32 {
    ((*t).pos.len() / 3) as u32
}
#[no_mangle]
pub unsafe extern "C" fn terrain_mesh_icount(t: *mut Terrain) -> u32 {
    (*t).idx.len() as u32
}
#[no_mangle]
pub unsafe extern "C" fn terrain_raycast(t: *mut Terrain, ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32, max_dist: f32) -> f32 {
    (*t).raycast([ox, oy, oz], [dx, dy, dz], max_dist)
}

// ---------------------------------------------------------------- geo data

/// Decode Mapzen/AWS "terrarium" RGB elevation tiles into metres.
#[no_mangle]
pub unsafe extern "C" fn decode_terrarium(rgba: *const u8, pixels: u32, out: *mut f32) {
    let src = core::slice::from_raw_parts(rgba, pixels as usize * 4);
    let dst = core::slice::from_raw_parts_mut(out, pixels as usize);
    for (i, d) in dst.iter_mut().enumerate() {
        let r = src[i * 4] as f32;
        let g = src[i * 4 + 1] as f32;
        let b = src[i * 4 + 2] as f32;
        *d = if src[i * 4 + 3] == 0 { f32::NAN } else { r * 256.0 + g + b / 256.0 - 32768.0 };
    }
}

pub fn resample_grid(src: &[f32], sw: usize, sh: usize, xs: &[f32], ys: &[f32], out: &mut [f32]) {
    let get = |i: i32, j: i32| -> f32 {
        let i = i.clamp(0, sw as i32 - 1) as usize;
        let j = j.clamp(0, sh as i32 - 1) as usize;
        src[j * sw + i]
    };
    for (b, &y) in ys.iter().enumerate() {
        let j = y.floor() as i32;
        let fy = y - j as f32;
        for (a, &x) in xs.iter().enumerate() {
            let i = x.floor() as i32;
            let fx = x - i as f32;
            let v = [get(i, j), get(i + 1, j), get(i, j + 1), get(i + 1, j + 1)];
            out[b * xs.len() + a] = if v.iter().any(|q| q.is_nan()) {
                let near = get((x + 0.5) as i32, (y + 0.5) as i32);
                if near.is_nan() {
                    v.iter().cloned().find(|q| !q.is_nan()).unwrap_or(f32::NAN)
                } else {
                    near
                }
            } else {
                lerp(lerp(v[0], v[1], fx), lerp(v[2], v[3], fx), fy)
            };
        }
    }
}

/// Bilinear resample of a `sw*sh` raster at the pixel coordinates `xs` (len ow) / `ys` (len oh).
#[no_mangle]
pub unsafe extern "C" fn resample(src: *const f32, sw: u32, sh: u32, xs: *const f32, ow: u32, ys: *const f32, oh: u32, out: *mut f32) {
    let s = core::slice::from_raw_parts(src, (sw * sh) as usize);
    let xs = core::slice::from_raw_parts(xs, ow as usize);
    let ys = core::slice::from_raw_parts(ys, oh as usize);
    let o = core::slice::from_raw_parts_mut(out, (ow * oh) as usize);
    resample_grid(s, sw as usize, sh as usize, xs, ys, o);
}

/// Replace NaN / no-data samples. Returns the number of samples patched.
#[no_mangle]
pub unsafe extern "C" fn fill_missing(data: *mut f32, len: u32, nodata: f32) -> u32 {
    let d = core::slice::from_raw_parts_mut(data, len as usize);
    let mut min = f32::INFINITY;
    for &v in d.iter() {
        if !v.is_nan() && v != nodata && v < min {
            min = v;
        }
    }
    if !min.is_finite() {
        min = 0.0;
    }
    let mut n = 0;
    // propagate the last valid sample along rows, fall back to the minimum
    let mut last = min;
    for v in d.iter_mut() {
        if v.is_nan() || *v == nodata {
            *v = last;
            n += 1;
        } else {
            last = *v;
        }
    }
    n
}

// ---------------------------------------------------------------- occlusion culling

#[no_mangle]
pub extern "C" fn occ_new() -> *mut Occlusion {
    Box::into_raw(Box::new(Occlusion::default()))
}
#[no_mangle]
pub unsafe extern "C" fn occ_free(o: *mut Occlusion) {
    if !o.is_null() {
        drop(Box::from_raw(o));
    }
}
#[no_mangle]
pub unsafe extern "C" fn occ_clear(o: *mut Occlusion) {
    (*o).clear();
}
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn occ_add(o: *mut Occlusion, owner: u32, cx: f32, cy: f32, cz: f32, hx: f32, hy: f32, hz: f32, ax: f32, az: f32) {
    (*o).add(owner, [cx, cy, cz], [hx, hy, hz], ax, az);
}
/// `targets`: n × 7 floats (centre, half-size, owner). `out`: n bytes, 1 = hidden. `terrain` may be null.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn occ_test(o: *mut Occlusion, terrain: *const Terrain, ex: f32, ey: f32, ez: f32, px: f32, py: f32, pz: f32, targets: *const f32, n: u32, out: *mut u8) {
    let t = std::slice::from_raw_parts(targets, n as usize * occlusion::TARGET_STRIDE);
    let res = std::slice::from_raw_parts_mut(out, n as usize);
    (*o).test(terrain.as_ref(), [[ex, ey, ez], [px, py, pz]], t, res);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_height_and_raise() {
        let mut t = Terrain::new(65, 65, 2.0);
        assert_eq!(t.height_at(0.0, 0.0), 0.0);
        t.brush(0, 0.0, 0.0, 10.0, 5.0, 0.0);
        assert!((t.height_at(0.0, 0.0) - 5.0).abs() < 1e-4);
        assert_eq!(t.height_at(40.0, 40.0), 0.0);
        t.exag = 2.0;
        assert!((t.height_at(0.0, 0.0) - 10.0).abs() < 1e-4);
    }

    #[test]
    fn chunk_counts() {
        let mut t = Terrain::new(65, 65, 1.0);
        let pal = [0.5f32; 24];
        t.chunk(0, 0, 32, 32, 1, &pal);
        let ring = 4 * 32;
        assert_eq!(t.pos.len() / 3, 33 * 33 + ring);
        assert_eq!(t.idx.len(), 32 * 32 * 6 + ring * 12);
        assert!(t.idx.iter().all(|&i| (i as usize) < t.pos.len() / 3));
        t.chunk(32, 32, 32, 32, 4, &pal);
        assert_eq!(t.pos.len() / 3, 9 * 9 + 32);
    }

    #[test]
    fn raycast_hits_ground() {
        let t = Terrain::new(65, 65, 1.0);
        let d = t.raycast([0.0, 10.0, 0.0], [0.0, -1.0, 0.0], 100.0);
        assert!((d - 10.0).abs() < 0.05, "{d}");
        assert!(t.raycast([0.0, 10.0, 0.0], [0.0, 1.0, 0.0], 100.0) < 0.0);
    }

    #[test]
    fn paint_keeps_weights_normalised() {
        let mut t = Terrain::new(33, 33, 1.0);
        t.paint(3, 0.0, 0.0, 5.0, 1.0);
        let k = (16 * 33 + 16) * LAYERS;
        let s: u32 = t.splat[k..k + LAYERS].iter().map(|&v| v as u32).sum();
        assert!((250..=260).contains(&s));
        assert_eq!(t.splat[k + 3], 255);
    }

    #[test]
    fn terrarium_and_resample() {
        // 32768 + 100.5 m -> r=128, g=100, b=128
        let px = [128u8, 100, 128, 255];
        let mut out = [0f32; 1];
        unsafe { decode_terrarium(px.as_ptr(), 1, out.as_mut_ptr()) };
        assert!((out[0] - 100.5).abs() < 1e-3);
        let src = [0.0, 10.0, 0.0, 10.0];
        let mut o = [0f32; 1];
        resample_grid(&src, 2, 2, &[0.5], &[0.5], &mut o);
        assert!((o[0] - 5.0).abs() < 1e-5);
    }

    #[test]
    fn occlusion_hides_only_what_is_fully_blocked() {
        let mut o = Occlusion::default();
        // A 10 m wide, 3 m tall wall at x = 5 facing the eye at the origin.
        o.add(1, [5.0, 1.5, 0.0], [0.1, 1.5, 5.0], 1.0, 0.0);
        let eye = [0.0, 1.6, 0.0];
        let targets = [
            10.0, 0.5, 0.0, 0.5, 0.5, 0.5, 2.0, // crate straight behind the wall: hidden
            10.0, 6.0, 0.0, 0.5, 0.5, 0.5, 3.0, // high above the wall: visible
            10.0, 0.5, 20.0, 0.5, 0.5, 0.5, 4.0, // far to the side: visible
            5.3, 1.5, 0.0, 0.05, 0.4, 0.5, 5.0, // picture hanging on the wall: never hidden by the wall it touches
            5.0, 1.5, 0.0, 0.1, 1.5, 5.0, 1.0, // the wall itself: visible
            -10.0, 0.5, 0.0, 0.5, 0.5, 0.5, 6.0, // behind the eye, nothing in between: visible
        ];
        let mut out = [9u8; 6];
        o.test(None, [eye, eye], &targets, &mut out);
        assert_eq!(out, [1, 0, 0, 0, 0, 0]);
        // Predicted eye position past the end of the wall reveals the crate.
        o.test(None, [eye, [0.0, 1.6, 14.0]], &targets, &mut out);
        assert_eq!(out[0], 0);
        // Standing inside an occluder never hides anything.
        o.add(7, [0.0, 1.5, 0.0], [2.0, 2.0, 2.0], 1.0, 0.0);
        o.test(None, [eye, eye], &targets, &mut out);
        assert_eq!(out[0], 1); // still hidden by the wall, the enclosing box is ignored
    }

    #[test]
    fn terrain_hides_objects_behind_a_hill() {
        let mut t = Terrain::new(129, 129, 2.0);
        // A ridge 30 m high across x = 0.
        for j in 0..129usize {
            for i in 60..69usize {
                t.heights[j * 129 + i] = 30.0;
            }
        }
        let mut o = Occlusion::default();
        let eye = [-80.0, 2.0, 0.0];
        let targets = [80.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 80.0, 120.0, 0.0, 1.0, 1.0, 1.0, 2.0, -40.0, 1.0, 10.0, 1.0, 1.0, 1.0, 3.0];
        let mut out = [9u8; 3];
        o.test(Some(&t), [eye, eye], &targets, &mut out);
        assert_eq!(out, [1, 0, 0]);
    }
}
