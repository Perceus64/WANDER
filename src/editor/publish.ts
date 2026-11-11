// Publishing: validation report + generation of a standalone, static web build.
import { strToU8, zipSync } from 'fflate';
import { PREFAB_MAP } from '../engine/prefabs';
import type { Obj, Project } from '../engine/types';
import type { Editor } from './editor';
import { download } from './storage';

export interface Issue { level: 'error' | 'warn' | 'tip'; area: string; text: string; ids?: string[] }

const ASSET_KEYS = ['asset', 'texture', 'image', 'audio', 'video', 'media'];
const TARGET_ACTIONS = ['info', 'playAudio', 'stopAudio', 'door', 'teleport', 'show', 'hide', 'elevator', 'platform'];

export function usedAssets(p: Project): Set<string> {
  const used = new Set<string>();
  for (const o of Object.values(p.scene.objects)) for (const k of ASSET_KEYS) { const v = o.props[k]; if (typeof v === 'string' && v && !/^https?:/.test(v)) used.add(v); }
  return used;
}

export function validate(ed: Editor, quick = false): Issue[] {
  const s = ed.scene, out: Issue[] = [], objs = Object.values(s.objects);
  const add = (level: Issue['level'], area: string, text: string, ids?: string[]) => out.push({ level, area, text, ids });
  const by = (f: (o: Obj) => boolean) => objs.filter(f);

  // player spawn
  const spawns = by((o) => o.kind === 'spawn');
  if (!spawns.length) add('warn', 'Player', 'No player spawn point. Visitors will start at the centre of the world – drag a “Player spawn” from the library to choose the start.');
  if (spawns.length > 1) add('tip', 'Player', `${spawns.length} spawn points found; the first visible one is used.`, spawns.map((o) => o.id));

  // assets
  for (const o of objs)
    for (const k of ASSET_KEYS) {
      const v = o.props[k];
      if (typeof v !== 'string' || !v || /^https?:/.test(v)) continue;
      if (!s.assets[v] || !ed.blobs.has(v)) add('error', 'Assets', `“${o.name}” uses a ${k} file that is missing from the project.`, [o.id]);
    }
  for (const a of Object.values(s.assets)) {
    const b = ed.blobs.get(a.id);
    if (a.type === 'model' && b && !/\.glb$/i.test(a.file ?? 'x.glb')) add('warn', 'Assets', `Model “${a.name}” is not a .glb file. Models with external textures or buffers will not load in published builds.`);
    if (a.meta && a.meta.tris > 150000) add('warn', 'Performance', `Model “${a.name}” has ${a.meta.tris.toLocaleString()} triangles. Select it and use Optimise model in the Inspector to reduce it.`);
    if (a.meta && a.meta.maxTexture > 2048) add('warn', 'Performance', `Model “${a.name}” has ${a.meta.maxTexture}px textures. Optimise it to 1024–2048px to save memory and loading time.`);
    if (a.size > 15e6) add('warn', 'Performance', `“${a.name}” is ${(a.size / 1e6).toFixed(1)} MB. Large files slow down loading – compress or reduce it.`);
  }
  const noAudio = by((o) => o.kind === 'audio' && !o.props.asset);
  if (noAudio.length) add('warn', 'Audio', `${noAudio.length} audio source(s) have no sound file assigned.`, noAudio.map((o) => o.id));
  const noModel = by((o) => o.kind === 'model' && !o.props.asset);
  if (noModel.length) add('error', 'Assets', `${noModel.length} model object(s) have no model file.`, noModel.map((o) => o.id));

  // references
  const cin = new Set(s.cinematics.map((c) => c.id)), rules = new Set(s.events.map((r) => r.id));
  for (const r of s.events) {
    const tt = r.trigger.type;
    if (['enterZone', 'leaveZone', 'near', 'interact', 'collect', 'elevatorArrive'].includes(tt) && r.trigger.target && !s.objects[r.trigger.target]) add('error', 'Events', `Event “${r.name}”: its trigger object was deleted.`);
    if (['enterZone', 'leaveZone', 'near'].includes(tt) && !r.trigger.target) add('error', 'Events', `Event “${r.name}” has no trigger object selected.`);
    if (tt === 'cinematicEnd' && r.trigger.target && !cin.has(r.trigger.target)) add('error', 'Events', `Event “${r.name}” waits for a cinematic that no longer exists.`);
    if (!r.actions.length) add('warn', 'Events', `Event “${r.name}” has no THEN actions, so nothing will happen.`);
    for (const a of r.actions) {
      if (TARGET_ACTIONS.includes(a.type) && (!a.target || !s.objects[a.target])) add('error', 'Events', `Event “${r.name}”: the “${a.type}” action points to a missing object.`);
      if (a.type === 'cinematic' && !cin.has(a.id)) add('error', 'Events', `Event “${r.name}” plays a cinematic that no longer exists.`);
      if ((a.type === 'enableRule' || a.type === 'disableRule') && !rules.has(a.rule)) add('error', 'Events', `Event “${r.name}” enables/disables an event that no longer exists.`);
    }
  }
  for (const c of s.cinematics) {
    if (c.keys.length < 2) add('warn', 'Cinematics', `Cinematic “${c.name}” needs at least two camera keyframes to move.`);
    if (c.audio && !s.objects[c.audio]) add('error', 'Cinematics', `Cinematic “${c.name}” uses an audio source that was deleted.`);
    if (!s.events.some((r) => r.actions.some((a) => a.type === 'cinematic' && a.id === c.id))) add('tip', 'Cinematics', `Cinematic “${c.name}” is never started. Add an event with a “Play cinematic” action.`);
  }

  // terrain
  const t = ed.terrain;
  if (t) {
    let bad = 0;
    if (!quick) { const h = t.copyHeights(); for (let i = 0; i < h.length; i++) if (!Number.isFinite(h[i])) bad++; }
    if (bad) add('error', 'Terrain', `Terrain contains ${bad} invalid height samples. Re-import the elevation data or smooth the affected area.`);
    if (t.meta.w * t.meta.h > 1025 * 1025) add('warn', 'Performance', `Terrain has ${(t.meta.w * t.meta.h / 1e6).toFixed(1)} million samples (${((t.meta.w * t.meta.h * 12) / 1e6).toFixed(0)} MB download). Consider a lower resolution.`);
  } else if (!by((o) => o.kind === 'floor' || (o.kind === 'primitive' && o.props.solid !== false)).length) add('warn', 'World', 'There is no terrain and no floor. Visitors will walk on an invisible flat ground at height 0.');

  // interactions
  const targeted = new Set(s.events.map((r) => r.trigger.target).filter(Boolean));
  const idle = by((o) => o.props.interactable && !targeted.has(o.id));
  if (idle.length) add('warn', 'Interactions', `${idle.length} interactable object(s) have no event attached, so using them does nothing.`, idle.map((o) => o.id));
  const zones = by((o) => o.kind === 'trigger' && !targeted.has(o.id));
  if (zones.length) add('warn', 'Interactions', `${zones.length} trigger zone(s) are not used by any event.`, zones.map((o) => o.id));
  const emptyInfo = by((o) => o.kind === 'info' && !String(o.props.title).trim() && !String(o.props.body).trim());
  if (emptyInfo.length) add('warn', 'Interactions', `${emptyInfo.length} information box(es) are empty.`, emptyInfo.map((o) => o.id));
  const evInfo = by((o) => o.kind === 'info' && o.props.activation === 'event' && !s.events.some((r) => r.actions.some((a) => a.type === 'info' && a.target === o.id)));
  if (evInfo.length) add('warn', 'Interactions', `${evInfo.length} information box(es) are set to “shown by event” but no event shows them.`, evInfo.map((o) => o.id));
  const locked = by((o) => o.kind === 'door' && o.props.locked && !s.events.some((r) => r.actions.some((a) => a.type === 'door' && a.target === o.id && ['unlock', 'open', 'toggle'].includes(a.mode))));
  if (locked.length) add('tip', 'Interactions', `${locked.length} locked door(s) can never be opened (no event unlocks them). That is fine if intended.`, locked.map((o) => o.id));
  const elev = by((o) => o.kind === 'elevator' && o.props.floors.length < 2);
  if (elev.length) add('warn', 'Interactions', 'An elevator has fewer than two floors.', elev.map((o) => o.id));

  // performance
  const lights = by((o) => o.visible && (o.kind === 'light' || (o.kind === 'prefab' && !!PREFAB_MAP[o.props.prefab]?.light && o.props.lightOn !== false))).length;
  if (lights > 16) add('warn', 'Performance', `${lights} dynamic lights. More than ~16 visibly slows down rendering on laptops – switch some lamps off (Inspector → Light on).`);
  const shadowLights = by((o) => o.kind === 'light' && o.props.castShadow).length;
  if (shadowLights > 2) add('warn', 'Performance', `${shadowLights} lights cast shadows. Keep shadow-casting lights to one or two.`);
  const inst = by((o) => o.kind === 'scatter').reduce((n, o) => n + o.props.items.length / 4, 0);
  if (inst > 40000) add('warn', 'Performance', `${Math.round(inst)} scattered objects. Above ~40,000 the frame rate drops on integrated graphics.`);
  if (objs.length > 4000) add('warn', 'Performance', `${objs.length} separate objects. Use the scatter brush for repeated props – it draws thousands in one call.`);
  const bytes = [...usedAssets(ed.project)].reduce((n, id) => n + (s.assets[id]?.size ?? 0), 0);
  if (bytes > 60e6) add('warn', 'Performance', `Assets total ${(bytes / 1e6).toFixed(0)} MB. Aim for under 60 MB so the experience loads quickly.`);
  const unused = Object.values(s.assets).filter((a) => !usedAssets(ed.project).has(a.id));
  if (unused.length) add('tip', 'Optimization', `${unused.length} imported file(s) are not used and will be left out of the build automatically.`);
  if (s.env.shadows && s.env.fogDensity > 0.02) add('tip', 'Optimization', 'Dense fog hides distant shadows – you can switch shadows off for a free speed-up.');
  if (t && t.meta.viewDistance > 3000) add('tip', 'Optimization', 'Terrain view distance is above 3 km. Lowering it (World tab) reduces the number of active terrain chunks.');
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function indexHtml(p: Project, hasThumb: boolean) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><link rel="icon" href="data:,">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.name)}</title>
<meta name="description" content="${esc(p.description || p.name)}">
<meta name="generator" content="WANDER">
<meta property="og:title" content="${esc(p.name)}">
${hasThumb ? '<meta property="og:image" content="thumbnail.jpg">' : ''}
<style>
html,body{margin:0;height:100%;background:#0b0c0e;overflow:hidden}
#wander{position:fixed;inset:0}
#splash{position:fixed;inset:0;display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center;color:#f1f1ee;font:300 34px system-ui,sans-serif;letter-spacing:.1em;${hasThumb ? 'background:linear-gradient(rgba(8,9,11,.78),rgba(8,9,11,.9)),url(thumbnail.jpg) center/cover' : 'background:#0b0c0e'}}
#splash i{width:220px;height:3px;background:rgba(255,255,255,.15);border-radius:2px;overflow:hidden}
#splash i:after{content:"";display:block;width:30%;height:100%;background:#e8a33d;animation:l 1.1s linear infinite}
@keyframes l{from{margin-left:-30%}to{margin-left:100%}}
</style>
</head>
<body>
<div id="wander"></div>
<div id="splash">${esc(p.name)}<i></i></div>
<noscript>This experience needs JavaScript and WebAssembly.</noscript>
<script type="module" src="./player.js"></script>
</body>
</html>
`;
}

const README = (p: Project) => `${p.name}
${'='.repeat(p.name.length)}
Published with WANDER.

How to put this online
----------------------
Upload every file in this folder to any static web host (GitHub Pages, Netlify,
Cloudflare Pages, an S3 bucket, your own server). No backend is required.

To test locally, serve the folder over http – browsers do not load WebAssembly
from file:// URLs. For example:  python3 -m http.server 8080   then open
http://localhost:8080

Contents
--------
index.html        the page visitors open
player.js         the WANDER runtime
wander_core.wasm  the engine core (WebAssembly)
project.json      your world
assets/           terrain data and the media files your world uses
`;

async function runtimeFile(name: string): Promise<Uint8Array> {
  const r = await fetch(new URL(`runtime/${name}`, document.baseURI));
  if (!r.ok) throw new Error(`The runtime file “${name}” is missing from this WANDER installation (${r.status}).`);
  return new Uint8Array(await r.arrayBuffer());
}

export interface BuildReport { files: { name: string; bytes: number }[]; total: number; blob: Blob; fileName: string }

/** Generate the standalone web build as a zip. */
export async function publish(ed: Editor): Promise<BuildReport> {
  const p: Project = structuredClone(ed.project);
  const used = usedAssets(p);
  for (const id of Object.keys(p.scene.assets)) if (!used.has(id)) delete p.scene.assets[id];
  p.prefabs = [];
  const thumb = p.thumbnail;
  delete p.thumbnail;
  if (p.scene.terrain) p.scene.terrain.hasOriginal = false;
  const files: Record<string, Uint8Array> = {};
  const [js, wasm] = await Promise.all([runtimeFile('player.js'), runtimeFile('wander_core.wasm')]);
  files['player.js'] = js;
  files['wander_core.wasm'] = wasm;
  files['project.json'] = strToU8(JSON.stringify(p));
  for (const [key, blob] of ed.allBlobs(false)) if (key.startsWith('terrain/') || used.has(key)) files[`assets/${key}`] = new Uint8Array(await blob.arrayBuffer());
  if (thumb?.startsWith('data:image/jpeg;base64,')) files['thumbnail.jpg'] = Uint8Array.from(atob(thumb.split(',')[1]), (c) => c.charCodeAt(0));
  files['index.html'] = strToU8(indexHtml(p, !!files['thumbnail.jpg']));
  files['README.txt'] = strToU8(README(p));
  files['.nojekyll'] = new Uint8Array();
  const zipped = zipSync(files, { level: 6 });
  const list = Object.entries(files).map(([name, d]) => ({ name, bytes: d.length })).sort((a, b) => b.bytes - a.bytes);
  return { files: list, total: list.reduce((n, f) => n + f.bytes, 0), blob: new Blob([zipped], { type: 'application/zip' }), fileName: `${p.name.replace(/[^\w-]+/g, '_') || 'world'}-web-build.zip` };
}

export async function exportAssets(ed: Editor) {
  const files: Record<string, Uint8Array> = {};
  for (const a of Object.values(ed.scene.assets)) {
    const b = ed.blobs.get(a.id);
    if (b) files[a.file ?? `${a.name}.${a.mime.split('/')[1] ?? 'bin'}`] = new Uint8Array(await b.arrayBuffer());
  }
  if (!Object.keys(files).length) return false;
  download(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), `${ed.project.name.replace(/[^\w-]+/g, '_')}-assets.zip`);
  return true;
}

/** World data for use in other tools: scene JSON, raw float32 heights and a 16-bit RAW heightmap. */
export function exportWorldData(ed: Editor) {
  const files: Record<string, Uint8Array> = { 'scene.json': strToU8(JSON.stringify(ed.scene, null, 1)) };
  const t = ed.terrain;
  if (t) {
    const h = t.copyHeights(), [mn, mx] = t.minMax(), ex = t.meta.exaggeration, raw = new Uint16Array(h.length);
    for (let i = 0; i < h.length; i++) raw[i] = Math.round(((h[i] * ex - mn) / Math.max(mx - mn, 1e-6)) * 65535);
    files['terrain/heights.f32'] = new Uint8Array(h.buffer);
    files['terrain/heightmap_16bit.raw'] = new Uint8Array(raw.buffer);
    files['terrain/terrain.json'] = strToU8(JSON.stringify({ ...t.meta, heightmapRange: [mn, mx], rowOrder: 'north to south (row 0 = −Z)', heightsUnit: 'metres above world y=0, before vertical exaggeration' }, null, 1));
  }
  download(new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' }), `${ed.project.name.replace(/[^\w-]+/g, '_')}-world-data.zip`);
}
