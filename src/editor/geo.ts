// Real-world data import: elevation tiles, OpenStreetMap features, heightmaps
// (PNG/RAW/SRTM .hgt/GeoTIFF) and GeoJSON. Everything runs in the browser.
import * as THREE from 'three';
import { CHUNK, validSize } from '../engine/terrain';
import { DEFAULT_LAYERS, type GeoRef, type TerrainMeta } from '../engine/types';
import type { Editor } from './editor';

export type BBox = [number, number, number, number]; // west, south, east, north (degrees, WGS84)
const M_LAT = 110540, M_LON = 111320;

/** Adapter for an elevation tile service. Add entries here to support more providers. */
export interface ElevationProvider { id: string; name: string; attribution: string; license: string; maxZoom: number; encoding: 'terrarium'; url(z: number, x: number, y: number): string }
export const PROVIDERS: ElevationProvider[] = [
  {
    id: 'aws-terrarium', name: 'Terrain Tiles on AWS Open Data (Mapzen Terrarium)', maxZoom: 15, encoding: 'terrarium',
    attribution: 'Elevation: Mapzen Terrain Tiles hosted by AWS Open Data. Contains data from SRTM (NASA/USGS), GMTED2010, ETOPO1, 3DEP and other open sources.',
    license: 'Open data – attribution required (see github.com/tilezen/joerd/blob/master/docs/attribution.md)',
    url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  },
];
export const OSM_ATTRIBUTION = 'Map data © OpenStreetMap contributors, ODbL 1.0';

export interface Place { name: string; lat: number; lon: number; bbox?: BBox }

export async function searchPlace(q: string): Promise<Place[]> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Place search failed (${r.status}). Try again in a moment.`);
  return (await r.json()).map((p: any) => ({ name: p.display_name, lat: +p.lat, lon: +p.lon, bbox: p.boundingbox ? [+p.boundingbox[2], +p.boundingbox[0], +p.boundingbox[3], +p.boundingbox[1]] : undefined }));
}

export interface GeoPlan { bbox: BBox; lat0: number; lon0: number; w: number; h: number; cell: number; widthM: number; heightM: number; zoom: number; tiles: number; tx0: number; ty0: number; tx1: number; ty1: number; mPerLon: number }

const lon2px = (lon: number, z: number) => ((lon + 180) / 360) * 256 * 2 ** z;
const lat2px = (lat: number, z: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 256 * 2 ** z;

/** Work out grid size, cell size and tile coverage for a selected rectangle. `samples` = grid points on the long side. */
export function planImport(sel: BBox, samples: number, maxZoom = 15): GeoPlan {
  const lat0 = (sel[1] + sel[3]) / 2, lon0 = (sel[0] + sel[2]) / 2, mPerLon = M_LON * Math.cos((lat0 * Math.PI) / 180);
  const selW = (sel[2] - sel[0]) * mPerLon, selH = (sel[3] - sel[1]) * M_LAT;
  const n = validSize(samples), cell = Math.max(selW, selH) / (n - 1);
  const w = validSize(selW / cell + 1), h = validSize(selH / cell + 1);
  const widthM = (w - 1) * cell, heightM = (h - 1) * cell;
  const bbox: BBox = [lon0 - widthM / 2 / mPerLon, lat0 - heightM / 2 / M_LAT, lon0 + widthM / 2 / mPerLon, lat0 + heightM / 2 / M_LAT];
  let zoom = Math.round(Math.log2((156543.03 * Math.cos((lat0 * Math.PI) / 180)) / cell));
  zoom = THREE.MathUtils.clamp(zoom, 1, maxZoom);
  let t: number[];
  for (;;) {
    t = [Math.floor(lon2px(bbox[0], zoom) / 256), Math.floor(lat2px(bbox[3], zoom) / 256), Math.floor(lon2px(bbox[2], zoom) / 256), Math.floor(lat2px(bbox[1], zoom) / 256)];
    if ((t[2] - t[0] + 1) * (t[3] - t[1] + 1) <= 64 || zoom <= 1) break;
    zoom--;
  }
  return { bbox, lat0, lon0, w, h, cell, widthM, heightM, zoom, tx0: t[0], ty0: t[1], tx1: t[2], ty1: t[3], tiles: (t[2] - t[0] + 1) * (t[3] - t[1] + 1), mPerLon };
}

/** Download + decode + stitch elevation tiles, then resample them onto the terrain grid (decode/resample run in WASM). */
export async function fetchElevation(ed: Editor, plan: GeoPlan, prov: ElevationProvider, progress: (done: number, total: number) => void): Promise<{ heights: Float32Array; missing: number; failedTiles: number }> {
  const core = ed.core, { tx0, ty0, tx1, ty1, zoom: z } = plan;
  const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1, mw = cols * 256, mh = rows * 256;
  const mosaic = new Float32Array(mw * mh).fill(NaN);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const jobs: [number, number][] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let done = 0, failed = 0;
  const wrap = 2 ** z;
  const worker = async () => {
    for (let j = jobs.pop(); j; j = jobs.pop()) {
      const [tx, ty] = j;
      try {
        const res = await fetch(prov.url(z, ((tx % wrap) + wrap) % wrap, ty));
        if (!res.ok) throw new Error(String(res.status));
        const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        g.clearRect(0, 0, 256, 256);
        g.drawImage(bmp, 0, 0);
        bmp.close();
        const px = g.getImageData(0, 0, 256, 256).data;
        const src = core.put(px), out = core.alloc(256 * 256 * 4);
        core.ex.decode_terrarium(src, 256 * 256, out);
        const tile = core.f32(out, 256 * 256);
        for (let r = 0; r < 256; r++) mosaic.set(tile.subarray(r * 256, r * 256 + 256), ((ty - ty0) * 256 + r) * mw + (tx - tx0) * 256);
        core.free(src, px.byteLength); core.free(out, 256 * 256 * 4);
      } catch { failed++; }
      progress(++done, cols * rows);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (failed === cols * rows) throw new Error('No elevation tiles could be downloaded. Check your connection or try another data source.');

  const xs = new Float32Array(plan.w), ys = new Float32Array(plan.h);
  for (let i = 0; i < plan.w; i++) xs[i] = lon2px(plan.bbox[0] + (i * plan.cell) / plan.mPerLon, z) - tx0 * 256 - 0.5;
  for (let j = 0; j < plan.h; j++) ys[j] = lat2px(plan.bbox[3] - (j * plan.cell) / M_LAT, z) - ty0 * 256 - 0.5; // row 0 = north = -Z
  const heights = resample(ed, mosaic, mw, mh, xs, ys);
  const p = core.put(heights);
  const missing = core.ex.fill_missing(p, heights.length, -32768);
  heights.set(core.f32(p, heights.length));
  core.free(p, heights.byteLength);
  return { heights, missing, failedTiles: failed };
}

function resample(ed: Editor, src: Float32Array, sw: number, sh: number, xs: Float32Array, ys: Float32Array): Float32Array {
  const core = ed.core, a = core.put(src), b = core.put(xs), c = core.put(ys), o = core.alloc(xs.length * ys.length * 4);
  core.ex.resample(a, sw, sh, b, xs.length, c, ys.length, o);
  const out = core.f32(o, xs.length * ys.length).slice();
  core.free(a, src.byteLength); core.free(b, xs.byteLength); core.free(c, ys.byteLength); core.free(o, out.byteLength);
  return out;
}

function installHeights(ed: Editor, w: number, h: number, cell: number, heights: Float32Array, exag: number, geo?: Omit<GeoRef, 'baseElevation' | 'minElevation' | 'maxElevation'>) {
  let min = Infinity, max = -Infinity;
  for (const v of heights) { if (v < min) min = v; if (v > max) max = v; }
  if (!isFinite(min)) throw new Error('The elevation data contains no valid samples.');
  for (let i = 0; i < heights.length; i++) heights[i] -= min; // world y = 0 at the lowest point; true elevation = y / exaggeration + baseElevation
  const meta: TerrainMeta = {
    w, h, cell, exaggeration: exag, layers: structuredClone(DEFAULT_LAYERS), hasOriginal: true, viewDistance: Math.max(800, Math.min(6000, Math.max(w, h) * cell * 0.7)),
    geo: geo ? { ...geo, baseElevation: min, minElevation: min, maxElevation: max } : undefined,
  };
  ed.setTerrainData(meta, heights, true);
  return { min, max };
}

export function installGeoTerrain(ed: Editor, plan: GeoPlan, heights: Float32Array, exag: number, prov: ElevationProvider) {
  return installHeights(ed, plan.w, plan.h, plan.cell, heights, exag, { bbox: plan.bbox, zoom: plan.zoom, source: prov.name, attribution: prov.attribution, crs: 'EPSG:4326 (WGS84) → local metric tangent plane, north = −Z' });
}

// ---------------------------------------------------------------- OSM features

export interface FeatureOpts { roads: boolean; water: boolean; buildings: boolean }

export async function fetchOSM(b: BBox, o: FeatureOpts): Promise<any[]> {
  const box = `(${b[1]},${b[0]},${b[3]},${b[2]})`, parts: string[] = [];
  if (o.roads) parts.push(`way["highway"]${box};`);
  if (o.water) parts.push(`way["waterway"~"^(river|stream|canal)$"]${box};way["natural"~"^(water|coastline)$"]${box};`);
  if (o.buildings) parts.push(`way["building"]${box};`);
  if (!parts.length) return [];
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(`[out:json][timeout:40];(${parts.join('')});out geom 6000;`), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!r.ok) throw new Error(`OpenStreetMap feature download failed (${r.status}). The public Overpass server may be busy – terrain was imported, features were skipped.`);
  return (await r.json()).elements ?? [];
}

const ROAD_W: Record<string, number> = { motorway: 14, trunk: 12, primary: 10, secondary: 8, tertiary: 7, residential: 6, unclassified: 6, service: 4, living_street: 5, pedestrian: 4, track: 3, path: 1.6, footway: 1.8, cycleway: 2, steps: 1.6, bridleway: 2 };

/** Turn line/polygon features into editable scene objects. `toLocal` maps lon/lat to world x/z. */
export function buildFeatures(ed: Editor, feats: { tags: Record<string, string>; pts: [number, number][] }[], label: string) {
  const t = ed.terrain, inside = (p: number[]) => !t || t.inside(p[0], p[1]);
  const root = ed.spawn('group', `Imported: ${label}`, { folder: true });
  const folder = (n: string) => ed.spawn('group', n, { folder: true }, [0, 0, 0], root.id).id;
  let fr = '', fw = '', fb = '';
  const count = { roads: 0, water: 0, buildings: 0, skipped: 0 };
  const thin = (pts: number[][], min: number) => pts.filter((p, i) => i === 0 || i === pts.length - 1 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > min);
  for (const f of feats) {
    const tg = f.tags ?? {};
    let pts = f.pts.filter(inside);
    if (pts.length < 2) { count.skipped++; continue; }
    const rel = (ps: number[][]) => ps.map((p) => [Math.round((p[0] - pts[0][0]) * 100) / 100, Math.round((p[1] - pts[0][1]) * 100) / 100]);
    const pos: [number, number, number] = [pts[0][0], 0, pts[0][1]];
    const closed = f.pts.length > 3 && f.pts[0][0] === f.pts[f.pts.length - 1][0] && f.pts[0][1] === f.pts[f.pts.length - 1][1];
    if (tg.building && closed && pts.length >= 4) {
      if (count.buildings >= 1200) { count.skipped++; continue; }
      const height = parseFloat(tg.height) || (parseFloat(tg['building:levels']) || 2) * 3.2;
      ed.spawn('poly', tg.name || 'Building', { points: rel(pts.slice(0, -1)), height: Math.round(height * 10) / 10, color: '#b9b2a6' }, pos, (fb ||= folder('Buildings')));
      count.buildings++;
    } else if (tg.natural === 'water' && closed && pts.length >= 4) {
      ed.spawn('poly', tg.name || 'Lake', { points: rel(thin(pts.slice(0, -1), 2)), height: 0, color: '#3b78a8', opacity: 0.82 }, pos, (fw ||= folder('Water')));
      count.water++;
    } else if (tg.waterway || tg.natural === 'coastline') {
      const coast = tg.natural === 'coastline';
      ed.spawn('road', tg.name || (coast ? 'Coastline' : tg.waterway === 'river' ? 'River' : 'Stream'), { points: rel(thin(pts, 4)), width: coast ? 3 : tg.waterway === 'river' ? 14 : 3.5, kindOf: coast ? 'road' : 'river', color: coast ? '#d8c690' : '#3b78a8' }, pos, (fw ||= folder('Water')));
      count.water++;
    } else if (tg.highway) {
      if (count.roads >= 900) { count.skipped++; continue; }
      const wd = ROAD_W[tg.highway] ?? 5, foot = wd <= 3;
      ed.spawn('road', tg.name || (foot ? 'Path' : 'Road'), { points: rel(thin(pts, foot ? 2 : 4)), width: wd, color: foot ? '#8a7558' : '#3c3d40', kindOf: 'road' }, pos, (fr ||= folder('Roads and paths')));
      count.roads++;
    } else count.skipped++;
  }
  if (!root.children.length) ed.remove([root.id]);
  return count;
}

export const lonLatToLocal = (plan: { lon0: number; lat0: number; mPerLon: number }) => (lon: number, lat: number): [number, number] => [(lon - plan.lon0) * plan.mPerLon, -(lat - plan.lat0) * M_LAT];

export function osmToFeatures(elements: any[], plan: GeoPlan) {
  const tl = lonLatToLocal(plan);
  return elements.filter((e) => e.type === 'way' && e.geometry).map((e) => ({ tags: e.tags ?? {}, pts: e.geometry.map((g: any) => tl(g.lon, g.lat)) as [number, number][] }));
}

export function importGeoJSON(ed: Editor, text: string, name: string) {
  const gj = JSON.parse(text), feats: { tags: Record<string, string>; pts: [number, number][] }[] = [], all: number[][] = [];
  const list = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', properties: {}, geometry: gj }];
  const lines: { props: any; coords: number[][]; poly: boolean }[] = [];
  for (const f of list) {
    const g = f.geometry, p = f.properties ?? {};
    if (!g) continue;
    if (g.type === 'LineString') lines.push({ props: p, coords: g.coordinates, poly: false });
    else if (g.type === 'MultiLineString') g.coordinates.forEach((c: number[][]) => lines.push({ props: p, coords: c, poly: false }));
    else if (g.type === 'Polygon') lines.push({ props: p, coords: g.coordinates[0], poly: true });
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((c: number[][][]) => lines.push({ props: p, coords: c[0], poly: true }));
  }
  lines.forEach((l) => all.push(...l.coords));
  if (!all.length) throw new Error('No line or polygon features found in this GeoJSON file.');
  if (all.some((c) => Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90)) throw new Error('GeoJSON coordinates must be longitude/latitude (WGS84, EPSG:4326). Reproject the file first.');
  const geo = ed.scene.terrain?.geo;
  const lon0 = geo ? (geo.bbox[0] + geo.bbox[2]) / 2 : all.reduce((a, c) => a + c[0], 0) / all.length;
  const lat0 = geo ? (geo.bbox[1] + geo.bbox[3]) / 2 : all.reduce((a, c) => a + c[1], 0) / all.length;
  const tl = lonLatToLocal({ lon0, lat0, mPerLon: M_LON * Math.cos((lat0 * Math.PI) / 180) });
  for (const l of lines) {
    const p = l.props, tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(p)) if (v != null) tags[k] = String(v);
    if (l.poly && !tags.building && tags.natural !== 'water') { if (/lake|water|pond|reservoir/i.test(`${tags.type ?? ''} ${tags.water ?? ''} ${tags.name ?? ''}`)) tags.natural = 'water'; else tags.building = 'yes'; }
    if (!l.poly && !tags.highway && !tags.waterway) tags.highway = 'residential';
    feats.push({ tags, pts: l.coords.map((c) => tl(c[0], c[1])) });
  }
  ed.checkpoint();
  const c = buildFeatures(ed, feats, name);
  ed.touch();
  return c;
}

// ---------------------------------------------------------------- rasters (user files)

export interface Raster { w: number; h: number; data: Float32Array; cellX?: number; cellY?: number; bbox?: BBox; source: string; note?: string; normalized?: boolean }

export async function rasterFromImage(file: Blob, name: string): Promise<Raster> {
  const bmp = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data, data = new Float32Array(c.width * c.height);
  for (let i = 0; i < data.length; i++) data[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
  return { w: c.width, h: c.height, data, source: name, normalized: true, note: 'Image heightmaps are read at 8 bits per channel (256 height steps). Use RAW 16-bit or GeoTIFF for smoother terrain.' };
}

export async function rasterFromRaw(file: Blob, name: string): Promise<Raster> {
  const buf = await file.arrayBuffer(), hgt = /\.hgt$/i.test(name);
  const n16 = Math.sqrt(buf.byteLength / 2), n8 = Math.sqrt(buf.byteLength);
  if (Number.isInteger(n16)) {
    const dv = new DataView(buf), data = new Float32Array(n16 * n16);
    if (hgt) {
      for (let i = 0; i < data.length; i++) { const v = dv.getInt16(i * 2, false); data[i] = v === -32768 ? NaN : v; }
      const m = name.match(/([NS])(\d{2})([EW])(\d{3})/i);
      const arc = n16 === 3601 ? 1 : 3, r: Raster = { w: n16, h: n16, data, source: `SRTM ${arc}″ (${name})`, cellY: (arc / 3600) * M_LAT };
      if (m) {
        const lat = (m[1].toUpperCase() === 'S' ? -1 : 1) * +m[2], lon = (m[3].toUpperCase() === 'W' ? -1 : 1) * +m[4];
        r.bbox = [lon, lat, lon + 1, lat + 1];
        r.cellX = (arc / 3600) * M_LON * Math.cos(((lat + 0.5) * Math.PI) / 180);
      } else r.cellX = r.cellY;
      return r;
    }
    for (let i = 0; i < data.length; i++) data[i] = dv.getUint16(i * 2, true) / 65535;
    return { w: n16, h: n16, data, source: name, normalized: true };
  }
  if (Number.isInteger(n8)) {
    const u = new Uint8Array(buf), data = new Float32Array(u.length);
    for (let i = 0; i < u.length; i++) data[i] = u[i] / 255;
    return { w: n8, h: n8, data, source: name, normalized: true };
  }
  throw new Error('RAW heightmaps must be square, 8-bit or 16-bit little-endian (for example 1025×1025).');
}

export async function rasterFromGeoTiff(file: Blob, name: string): Promise<Raster> {
  const { fromArrayBuffer } = await import('geotiff');
  const tiff = await fromArrayBuffer(await file.arrayBuffer()), img = await tiff.getImage();
  const w = img.getWidth(), h = img.getHeight();
  if (w * h > 64e6) throw new Error('This GeoTIFF is larger than 64 megapixels. Crop or downsample it first (for example with QGIS or gdal_translate).');
  const band = (await img.readRasters({ samples: [0] }))[0] as ArrayLike<number>;
  const data = Float32Array.from(band as any), nodata = img.getGDALNoData();
  if (nodata !== null) for (let i = 0; i < data.length; i++) if (data[i] === nodata) data[i] = NaN;
  const r: Raster = { w, h, data, source: `GeoTIFF (${name})` };
  try {
    const bb = img.getBoundingBox(), keys: any = img.getGeoKeys() ?? {};
    const geographic = keys.GTModelTypeGeoKey === 2 || (Math.abs(bb[0]) <= 180 && Math.abs(bb[2]) <= 180 && Math.abs(bb[1]) <= 90 && Math.abs(bb[3]) <= 90);
    if (geographic) {
      const lat = (bb[1] + bb[3]) / 2;
      r.bbox = [bb[0], bb[1], bb[2], bb[3]];
      r.cellX = ((bb[2] - bb[0]) / w) * M_LON * Math.cos((lat * Math.PI) / 180);
      r.cellY = ((bb[3] - bb[1]) / h) * M_LAT;
    } else {
      r.cellX = (bb[2] - bb[0]) / w; r.cellY = (bb[3] - bb[1]) / h;
      r.note = 'Projected coordinate system: pixel size is taken as metres. Roads and other map features cannot be aligned automatically for projected rasters.';
    }
  } catch { r.note = 'No georeferencing found: set the cell size manually.'; }
  return r;
}

/** Fit a raster onto a valid terrain grid with uniform metric cells and install it. */
export function installRaster(ed: Editor, r: Raster, o: { maxSamples: number; cell: number; heightScale: number; exag: number }) {
  const cx = r.cellX ?? o.cell, cy = r.cellY ?? o.cell;
  const widthM = (r.w - 1) * cx, heightM = (r.h - 1) * cy;
  const n = validSize(Math.min(o.maxSamples, Math.max(r.w, r.h)));
  const cell = Math.max(widthM, heightM) / (n - 1);
  const fit = (m: number) => Math.max(CHUNK, Math.floor(m / cell / CHUNK + 1e-6) * CHUNK) + 1; // crop instead of stretching: keeps the horizontal scale exact
  const w = fit(widthM), h = fit(heightM);
  const x0 = (widthM - (w - 1) * cell) / 2, y0 = (heightM - (h - 1) * cell) / 2;
  const xs = Float32Array.from({ length: w }, (_, i) => Math.min(r.w - 1, Math.max(0, (x0 + i * cell) / cx)));
  const ys = Float32Array.from({ length: h }, (_, j) => Math.min(r.h - 1, Math.max(0, (y0 + j * cell) / cy)));
  const heights = resample(ed, r.data, r.w, r.h, xs, ys);
  let missing = 0;
  for (let i = 0; i < heights.length; i++) if (Number.isNaN(heights[i])) missing++;
  if (missing) { const p = ed.core.put(heights); ed.core.ex.fill_missing(p, heights.length, -32768); heights.set(ed.core.f32(p, heights.length)); ed.core.free(p, heights.byteLength); }
  if (r.normalized) for (let i = 0; i < heights.length; i++) heights[i] *= o.heightScale;
  let geo: Parameters<typeof installHeights>[6];
  if (r.bbox) {
    const lat0 = (r.bbox[1] + r.bbox[3]) / 2, lon0 = (r.bbox[0] + r.bbox[2]) / 2, mLon = M_LON * Math.cos((lat0 * Math.PI) / 180);
    geo = { bbox: [lon0 - ((w - 1) * cell) / 2 / mLon, lat0 - ((h - 1) * cell) / 2 / M_LAT, lon0 + ((w - 1) * cell) / 2 / mLon, lat0 + ((h - 1) * cell) / 2 / M_LAT], zoom: 0, source: r.source, attribution: 'User-provided elevation data – check the licence of your source.', crs: 'EPSG:4326 (WGS84) → local metric tangent plane, north = −Z' };
  }
  const mm = installHeights(ed, w, h, cell, heights, o.exag, geo);
  return { w, h, cell, missing, ...mm };
}
