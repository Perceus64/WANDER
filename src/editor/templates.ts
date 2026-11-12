// Starter worlds. Every template is built through the same Editor API the UI
// uses, so each one is a fully editable project (not a baked sample scene).
import * as THREE from 'three';
import { ENV_PRESETS, uid, type CamKey, type Cinematic, type EventRule, type Obj, type Vec3 } from '../engine/types';
import type { Editor } from './editor';
import * as geo from './geo';

export interface Template { key: string; name: string; blurb: string; build(ed: Editor): void | Promise<void> }

const rnd = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const env = (ed: Editor, name: string) => Object.assign(ed.scene.env, structuredClone(ENV_PRESETS[name]));
const rule = (ed: Editor, name: string, trigger: EventRule['trigger'], actions: EventRule['actions'], once = true, conditions: EventRule['conditions'] = []) => {
  const r: EventRule = { id: uid('e'), name, enabled: true, once, trigger, conditions, actions };
  ed.scene.events.push(r);
  return r;
};
const camKey = (t: number, pos: Vec3, look: Vec3, fov = 55, ease = 'easeInOut'): CamKey => {
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(...pos), new THREE.Vector3(...look), new THREE.Vector3(0, 1, 0)));
  return { t, pos, quat: q.toArray() as CamKey['quat'], fov, ease };
};
const cinematic = (ed: Editor, name: string, duration: number, keys: CamKey[], extra: Partial<Cinematic> = {}) => {
  const c: Cinematic = { id: uid('c'), name, duration, keys, subtitles: [], title: '', fadeIn: 1, fadeOut: 1, audio: '', letterbox: true, ...extra };
  ed.scene.cinematics.push(c);
  return c;
};
const ground = (ed: Editor, x: number, z: number) => ed.heightAt(x, z);
const prefab = (ed: Editor, key: string, x: number, z: number, rotY = 0, parent: string | null = null, y?: number, name?: string) =>
  ed.spawn('prefab', name ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), { prefab: key }, [x, y ?? (parent ? 0 : ground(ed, x, z)), z], parent, { rot: [0, rotY, 0] });
const info = (ed: Editor, title: string, body: string, pos: Vec3, props: Record<string, any> = {}, parent: string | null = null) => ed.spawn('info', title, { title, body, ...props }, pos, parent);
const spawnAt = (ed: Editor, x: number, z: number, yaw = 0, y?: number) => ed.spawn('spawn', 'Player spawn', {}, [x, y ?? ground(ed, x, z), z], null, { rot: [0, yaw, 0] });

function scatter(ed: Editor, key: string, name: string, n: number, radius: number, seed: number, keepClear: (x: number, z: number) => boolean = () => false, minS = 0.8, maxS = 1.5) {
  const r = rnd(seed), items: number[] = [], mm = ed.terrain?.minMax() ?? [0, 0];
  const waterline = mm[1] - mm[0] > 1 ? 0.4 : -Infinity;
  for (let i = 0; i < n * 3 && items.length < n * 4; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (keepClear(x, z) || (ed.terrain && (!ed.terrain.inside(x, z) || ed.heightAt(x, z) < waterline))) continue;
    items.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100, Math.round((minS + r() * (maxS - minS)) * 100) / 100, Math.round(r() * 628) / 100);
  }
  return ed.spawn('scatter', name, { prefab: key, items });
}

/** A rectangular room made of four editable walls, a floor and (optionally) a ceiling slab. */
function room(ed: Editor, name: string, cx: number, y: number, cz: number, w: number, d: number, H: number, o: { ceiling?: boolean; floor?: boolean; color?: string; floorColor?: string; parent?: string | null } = {}) {
  const t = 0.2, g = ed.spawn('group', name, { room: true, height: H }, [cx, y, cz], o.parent ?? null);
  const wall = (n: string, pos: Vec3, rotY: number, length: number) => ed.spawn('wall', n, { length, height: H, thickness: t, color: o.color ?? '#d9d5cc' }, pos, g.id, { rot: [0, rotY, 0] });
  const walls = {
    north: wall('Wall north', [-w / 2 - t / 2, 0, -d / 2], 0, w + t), south: wall('Wall south', [-w / 2 - t / 2, 0, d / 2], 0, w + t),
    west: wall('Wall west', [-w / 2, 0, -d / 2 + t / 2], -90, d - t), east: wall('Wall east', [w / 2, 0, -d / 2 + t / 2], -90, d - t),
  };
  if (o.floor !== false) ed.spawn('floor', 'Floor', { width: w + t, depth: d + t, thickness: 0.2, color: o.floorColor ?? '#8d857a' }, [0, 0.05, 0], g.id);
  if (o.ceiling !== false) ed.spawn('floor', 'Ceiling', { width: w + t, depth: d + t, thickness: 0.2, color: '#e8e6e0' }, [0, H + 0.2, 0], g.id);
  return { g, walls };
}

/** Cut a door or window into a wall at `at` metres from the wall's start. */
function opening(ed: Editor, wall: Obj, kind: 'door' | 'window', at: number, props: Record<string, any> = {}) {
  const o = ed.insertOpening(wall.id, kind, undefined, props)!;
  o.pos = [at, o.pos[1], 0];
  ed.afterTransform(o.id);
  return o;
}

const flatten = (ed: Editor, x: number, z: number, radius: number) => { const y = ground(ed, x, z); for (let i = 0; i < 5; i++) ed.terrain?.brush(3, x, z, radius, 1, y); };
const start = (ed: Editor, objective: string, message: string) => rule(ed, 'Welcome', { type: 'start' }, [{ type: 'objective', text: objective }, { type: 'message', text: message, seconds: 6 }]);


// ---- generated media, so the showcase needs no downloads -------------------

function pngFile(name: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): File {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const bin = atob(c.toDataURL('image/png').split(',')[1]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: 'image/png' });
}

/** Minimal animated GIF writer (128-colour palette, literal LZW codes). `pixel` returns a palette index. */
function gifFile(name: string, w: number, h: number, frames: number, delayCs: number, palette: number[][], pixel: (x: number, y: number, f: number) => number): File {
  const out: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8, 0xf6, 0, 0];
  for (let i = 0; i < 128; i++) out.push(...(palette[i] ?? [0, 0, 0]));
  out.push(0x21, 0xff, 0x0b, ...Array.from('NETSCAPE2.0', (ch) => ch.charCodeAt(0)), 3, 1, 0, 0, 0);
  for (let f = 0; f < frames; f++) {
    out.push(0x21, 0xf9, 4, 0, delayCs & 255, delayCs >> 8, 0, 0, 0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, 7);
    const codes: number[] = [];
    for (let i = 0; i < w * h; i++) { if (i % 100 === 0) codes.push(128); codes.push(pixel(i % w, (i / w) | 0, f) & 127); }
    codes.push(129);
    for (let i = 0; i < codes.length; i += 255) { const part = codes.slice(i, i + 255); out.push(part.length, ...part); }
    out.push(0);
  }
  out.push(0x3b);
  return new File([new Uint8Array(out)], name, { type: 'image/gif' });
}

function wavFile(name: string, seconds: number, sample: (t: number) => number): File {
  const rate = 22050, n = Math.floor(seconds * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample(i / rate))) * 32000, true);
  return new File([buf], name, { type: 'audio/wav' });
}

/** Every major WANDER feature in one small, guided world. */
function buildShowcase(ed: Editor) {
  const TAU = Math.PI * 2;
  // -- generated assets
  const poster = ed.addAsset(pngFile('Showcase poster.png', 640, 360, (g) => {
    const gr = g.createLinearGradient(0, 0, 640, 360);
    gr.addColorStop(0, '#16324f'); gr.addColorStop(1, '#e8a33d');
    g.fillStyle = gr; g.fillRect(0, 0, 640, 360);
    g.fillStyle = '#0d1b2a'; g.beginPath(); g.moveTo(0, 360); g.lineTo(170, 150); g.lineTo(290, 290); g.lineTo(420, 110); g.lineTo(640, 360); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.fillText('WANDER', 36, 86);
    g.font = '24px sans-serif'; g.fillText('This screen shows an imported image', 38, 124);
  }), 'image');
  const BARS = [[0, 0, 0], [214, 58, 47], [232, 163, 61], [240, 220, 80], [72, 170, 90], [52, 110, 200], [130, 80, 170], [255, 255, 255]];
  const loopGif = ed.addAsset(gifFile('Colour bars.gif', 128, 72, 8, 12, BARS, (x, y, f) => (y > 56 ? (Math.abs(x - 8 - f * 16) < 8 ? 7 : 0) : ((x + f * 16) >> 4) % 6 + 1)), 'image');
  const pad = ed.addAsset(wavFile('Ambient pad.wav', 6, (t) => { const env2 = 0.5 - 0.5 * Math.cos((t / 6) * TAU); return 0.22 * env2 * (Math.sin(t * TAU * 220) + Math.sin(t * TAU * 277.2) + Math.sin(t * TAU * 329.6)) / 2; }), 'audio');
  const chime = ed.addAsset(wavFile('Chime.wav', 1.6, (t) => 0.5 * Math.exp(-t * 3) * (Math.sin(t * TAU * 880) + 0.5 * Math.sin(t * TAU * 1320))), 'audio');
  const theme = ed.addAsset(wavFile('Flyover theme.wav', 8, (t) => { const note = [262, 330, 392, 523, 392, 330, 294, 262][Math.floor(t) % 8], k = t % 1; return 0.3 * Math.exp(-k * 2.2) * (Math.sin(t * TAU * note) + 0.4 * Math.sin(t * TAU * note * 2)); }), 'audio');

  // -- terrain: generated, then sculpted and painted with the same brushes the editor uses
  ed.createTerrain({ size: 257, cell: 2, seed: 23, amplitude: 22, frequency: 0.006, flat: false });
  const T = ed.terrain!;
  flatten(ed, 0, 6, 46);
  for (let i = 0; i < 7; i++) T.brush(0, -95, -95, 60, 6);              // a sculpted mountain
  for (let i = 0; i < 6; i++) T.brush(1, 62, 22, 24, 1.3);              // a lake bed
  for (let i = 0; i < 3; i++) T.brush(2, 62, 22, 30, 1);
  const y0 = ground(ed, 0, 0), lakeY = ground(ed, 62, 22) + 3.2;
  T.autoPaint(34, y0 + 30, y0 - 50);
  for (let i = 0; i < 6; i++) { T.paint(2, 62, 22, 30, 1); T.paint(6, 0, 22, 13, 1); T.paint(7, 0, 0, 9, 1); }
  Object.assign(ed.scene.env, structuredClone(ENV_PRESETS['Sunny afternoon']), { bloom: 0.18, saturation: 1.1, contrast: 1.03 });
  ed.project.envPresets['Showcase glow'] = { ...structuredClone(ENV_PRESETS.Sunset), bloom: 0.7, saturation: 1.25 };
  ed.spawn('water', 'Lake', { width: 70, depth: 70, color: '#2f6f9a', opacity: 0.72 }, [62, lakeY, 22]);

  // -- roads, vegetation, street furniture
  ed.spawn('road', 'Approach road', { points: [[0, 0], [0, -30]], width: 5, sidewalks: true }, [0, 0, 44]);
  ed.spawn('road', 'Viewpoint path', { points: [[0, 0], [-12, -6], [-26, -4], [-40, -14]], width: 2, color: '#8a7a5c' }, [-8, 0, 16]);
  ed.spawn('road', 'Lake path', { points: [[0, 0], [14, 2], [28, 0]], width: 2, color: '#8a7a5c' }, [8, 0, 18]);
  const clear = (x: number, z: number) => Math.hypot(x, z - 8) < 34 || Math.hypot(x - 62, z - 22) < 30 || (x < -8 && x > -52 && z > -4 && z < 20);
  scatter(ed, 'tree_pine', 'Pine forest', 420, 240, 51, clear); scatter(ed, 'tree_oak', 'Oaks', 120, 150, 52, clear); scatter(ed, 'bush', 'Bushes', 160, 120, 53, clear);
  scatter(ed, 'grass_tuft', 'Meadow grass', 900, 90, 54, (x, z) => Math.hypot(x, z) < 12 || Math.abs(x) < 3.5 && z > 12); scatter(ed, 'flowers', 'Wildflowers', 300, 70, 55, (x, z) => Math.hypot(x, z - 6) < 16); scatter(ed, 'rock', 'Rocks', 80, 200, 56, clear, 0.6, 2.2);
  prefab(ed, 'street_lamp', 3.6, 34, 180); prefab(ed, 'street_lamp', -3.6, 22, 0); prefab(ed, 'bench', 4.4, 28, -90); prefab(ed, 'trash_bin', 4.4, 30.5); prefab(ed, 'sign_post', -3.8, 15, 0); prefab(ed, 'bicycle', -4.2, 30, 20);
  prefab(ed, 'fountain', 9, 24); prefab(ed, 'boat', 50, 26, 40, null, lakeY - 0.2); prefab(ed, 'bench', 40, 19, 90);
  ed.spawn('audio', 'Fountain ambience', { asset: pad, volume: 0.7, loop: true, positional: true, refDistance: 5, maxDistance: 38, autoplay: true, fade: 1 }, [9, ground(ed, 9, 24) + 1.2, 24]);
  const chimeSrc = ed.spawn('audio', 'Chime (played by events)', { asset: chime, volume: 0.9, loop: false, positional: false, autoplay: false, fade: 0 }, [0, y0 + 2, 10]);
  const music = ed.spawn('audio', 'Flyover music (played by the cinematic)', { asset: theme, volume: 0.8, loop: false, positional: false, autoplay: false, fade: 1 }, [0, y0 + 2, 12]);

  // -- two-storey building: walls with cut openings, stairs, elevator, furniture, lights, screens
  const b = ed.spawn('group', 'Showcase building', {}, [0, y0, 0]);
  const g0 = room(ed, 'Ground floor', 0, 0, 0, 12, 10, 3.2, { ceiling: false, color: '#e6e1d6', floorColor: '#8a8378', parent: b.id });
  opening(ed, g0.walls.south, 'door', 6.1, { style: 'sliding', auto: true, width: 1.5, color: '#3d4b5c' });
  opening(ed, g0.walls.north, 'window', 6, { width: 2 }); opening(ed, g0.walls.west, 'window', 7, { width: 1.6 });
  const slab = (n: string, x: number, z: number, w: number, d: number) => ed.spawn('floor', n, { width: w, depth: d, thickness: 0.2, color: '#9a948a' }, [x, 3.4, z], b.id);
  slab('Slab main', 0.5, 0, 7.6, 10.2); slab('Slab west', -4.7, 1.275, 2.8, 7.65); slab('Slab north-east', 5.2, -3.3, 1.8, 3.6); slab('Slab south-east', 5.2, 4.3, 1.8, 1.6);
  const g1 = room(ed, 'Upper floor', 0, 3.4, 0, 12, 10, 3, { floor: false, color: '#dcd6c8', parent: b.id });
  opening(ed, g1.walls.south, 'window', 3, { width: 1.8 }); opening(ed, g1.walls.south, 'window', 9, { width: 1.8 });
  ed.spawn('stairs', 'Stairs', { width: 1.4, rise: 3.35, run: 5, steps: 18 }, [5.1, 0.05, 3.5], b.id, { rot: [0, 180, 0] });
  const lift = ed.spawn('elevator', 'Elevator', { floors: [{ name: 'Ground', y: 0.05 }, { name: 'Office', y: 3.4 }] }, [-4.5, 0, -3.5], b.id);
  ed.spawn('text', 'Entrance sign', { text: 'WANDER SHOWCASE', width: 4.4, height: 0.6, color: '#ffffff', background: '#20242c' }, [0, 2.45, 5.14], b.id);
  ed.spawn('screen', 'TV (animated GIF)', { media: loopGif, width: 2.4, height: 1.35 }, [3.2, 1.1, -4.86], b.id);
  ed.spawn('screen', 'Poster screen (image)', { media: poster, width: 2.6, height: 1.46 }, [1, 4.4, -4.86], b.id);
  prefab(ed, 'sofa', 3.2, -1.6, 180, b.id, 0.05); prefab(ed, 'rug', 3.2, -3, 0, b.id, 0.06); prefab(ed, 'floor_lamp', 1.2, -4.3, 0, b.id, 0.05); prefab(ed, 'potted_plant', -5.2, 4.2, 0, b.id, 0.05);
  prefab(ed, 'statue', -2, 2.4, 140, b.id, 0.05, 'Marble statue'); prefab(ed, 'rope_barrier', -2, 3.6, 0, b.id, 0.05); prefab(ed, 'display_case', 1, 3.6, 0, b.id, 0.05);
  ed.spawn('light', 'Statue spotlight', { type: 'spot', color: '#fff1d6', intensity: 22, range: 8, angle: 32 }, [-2, 3.1, 2.4], b.id, { rot: [-90, 0, 0] });
  ed.spawn('light', 'Lobby light', { type: 'point', color: '#ffe2b0', intensity: 5, range: 12 }, [1, 2.8, -1], b.id);
  ed.spawn('light', 'Office light', { type: 'point', color: '#fff4e0', intensity: 5, range: 12 }, [0, 6.1, 0], b.id);
  prefab(ed, 'desk', 2, 2.5, 180, b.id, 3.4); prefab(ed, 'chair', 2, 1.5, 0, b.id, 3.4); prefab(ed, 'bookshelf', -1.5, -4.6, 0, b.id, 3.4); prefab(ed, 'clock', -3, -4.85, 0, b.id, 5.2);
  const statueInfo = info(ed, 'Marble statue', 'A **museum exhibit** box: title, formatted text, colours and a template.\n\nPress the key shown on screen to open it.', [-2, 1.6, 3.3], { template: 'museum', activation: 'key', distance: 3 }, b.id);
  const welcome = info(ed, 'Welcome inside', 'This box is set to appear *only when an event shows it* – here, when you walk through the door.\n\nTake the **stairs** or the **elevator** to the office.', [0, 1.6, 2], { activation: 'event', marker: false, template: 'education', distance: 4 }, b.id);
  info(ed, 'Screens', 'The TV plays an animated GIF and the screen upstairs shows an image. Import your own GIF, picture or video and choose it in the Inspector.', [3.2, 1.4, -3.4], { distance: 2.6 }, b.id);
  const crystal = (n: string, pos: Vec3, parent: string | null = null) => ed.spawn('primitive', n, { shape: 'sphere', color: '#57e0ff', emissive: 2.2, roughness: 0.2, solid: false, collectible: true, note: 'It is warm to the touch. One of three hidden in the showcase.' }, pos, parent, { scale: [0.32, 0.32, 0.32] });
  const c1 = crystal('Crystal (office)', [2, 4.55, 2.5], b.id);
  const lobby = ed.spawn('trigger', 'Lobby zone', { size: [11, 3, 9] }, [0, 0, 0], b.id);

  // -- shed: a locked door opened by a lever
  const shedY = ground(ed, -18, 8), shed = room(ed, 'Locked shed', -18, shedY, 8, 4, 4, 2.6, { color: '#7a5a3c', floorColor: '#5b4330' });
  const shedDoor = opening(ed, shed.walls.east, 'door', 2, { locked: true, color: '#3f3027' });
  const lever = ed.spawn('prefab', 'Shed lever', { prefab: 'lever', interactable: true, prompt: 'Pull the lever' }, [-14.6, ground(ed, -14.6, 11), 11]);
  const c2 = crystal('Crystal (shed)', [0, 1, 0], shed.g.id);
  prefab(ed, 'crate', -1.2, -1.2, 10, shed.g.id, 0.05); prefab(ed, 'barrel', 1.2, -1.3, 0, shed.g.id, 0.05);
  // -- garage: a lifting door toggled by a push button
  const garY = ground(ed, 18, 6), gar = room(ed, 'Garage', 18, garY, 6, 5, 6, 2.8, { color: '#b9bec4', floorColor: '#6d6d6d' });
  const garDoor = opening(ed, gar.walls.south, 'door', 2.6, { style: 'garage', width: 2.6, height: 2.3, color: '#8d949c' });
  const button = ed.spawn('prefab', 'Garage button', { prefab: 'button_panel', interactable: true, prompt: 'Press the button' }, [21.2, garY, 9.3]);
  prefab(ed, 'car', 0, -0.4, 0, gar.g.id, 0.05);
  // -- viewing deck reached by a moving platform
  const dx = -16, dz = -16, deckY = ground(ed, dx, dz);
  const deck = ed.spawn('group', 'Viewing deck', {}, [dx, deckY, dz]);
  ed.spawn('floor', 'Deck', { width: 5, depth: 5, thickness: 0.25, color: '#7a6a55' }, [0, 4, 0], deck.id);
  ed.spawn('wall', 'Support west', { length: 5, height: 3.75, thickness: 0.3, color: '#6d6458' }, [-2.3, 0, 2.5], deck.id, { rot: [0, 90, 0] });
  ed.spawn('wall', 'Support north', { length: 5, height: 3.75, thickness: 0.3, color: '#6d6458' }, [-2.5, 0, -2.3], deck.id);
  ed.spawn('platform', 'Deck lift', { size: [2, 0.25, 2], offset: [0, 3.6, 0], speed: 1.2, pause: 3, mode: 'loop', color: '#6d7e91' }, [3.6, 0.4, 0], deck.id);
  const c3 = crystal('Crystal (deck)', [-1, 4.9, -1], deck.id);
  info(ed, 'Viewing deck', 'You rode a **moving platform**. Set its travel, speed and pause in the Inspector; events can also start and stop platforms.', [0, 5.4, 0.5], { distance: 3 }, deck.id);

  // -- teleport pads, a hidden reward, zones
  const padProps = { shape: 'cylinder', color: '#b46bff', emissive: 1.6, solid: false, interactable: true };
  const padA = ed.spawn('primitive', 'Teleport pad (plaza)', { ...padProps, prompt: 'Teleport to the lake' }, [-9, ground(ed, -9, 26) + 0.05, 26], null, { scale: [1.6, 0.08, 1.6] });
  const padB = ed.spawn('primitive', 'Teleport pad (lake)', { ...padProps, prompt: 'Teleport back to the plaza' }, [38, ground(ed, 38, 16) + 0.05, 16], null, { scale: [1.6, 0.08, 1.6] });
  const trophy = ed.spawn('prefab', 'Golden trophy (hidden until all crystals are found)', { prefab: 'vase', color: '#ffcf40' }, [0, ground(ed, 0, 12), 12], null, { visible: false, scale: [2, 2, 2] });
  const lakeZone = ed.spawn('trigger', 'Lake zone', { size: [44, 8, 44] }, [58, lakeY - 2, 22]);
  const vx = -48, vz = 2, viewZone = ed.spawn('trigger', 'Viewpoint zone', { size: [6, 4, 6] }, [vx, ground(ed, vx, vz), vz]);
  prefab(ed, 'info_board', vx - 1, vz - 3, 30);
  info(ed, 'Real places', 'This landscape was generated and sculpted, but World → Import real place builds terrain from real elevation data, with roads, rivers and buildings.', [vx - 1, ground(ed, vx - 1, vz - 3) + 1.7, vz - 3], { template: 'history' });
  spawnAt(ed, 0, 40, 0);

  // -- cinematic: camera keyframes, title, subtitles, music
  const fly = cinematic(ed, 'Flyover', 16, [
    camKey(0, [vx, ground(ed, vx, vz) + 3, vz], [0, y0 + 3, 0], 55), camKey(5, [-10, y0 + 34, 62], [0, y0, 0], 60), camKey(10, [52, y0 + 20, 58], [62, lakeY, 22], 55), camKey(16, [0, y0 + 2.2, 30], [0, y0 + 2.5, 0], 50),
  ], { title: 'WANDER', audio: music.id, subtitles: [{ t: 1.5, d: 3.5, text: 'Cinematics are camera keyframes on a timeline.' }, { t: 6, d: 3.5, text: 'Add titles, subtitles, fades and music.' }, { t: 11, d: 4, text: 'When it ends, control returns to the player.' }] });

  // -- events: every trigger type and most actions
  rule(ed, 'Welcome', { type: 'start' }, [{ type: 'objective', text: 'Find 3 glowing crystals (0/3)' }, { type: 'dialogue', speaker: 'Guide', text: 'Welcome to the WANDER showcase. Everything here was made in the editor – open the Events tab to see how.', seconds: 7 }, { type: 'wait', seconds: 7 }, { type: 'message', text: 'Follow the road to the building. E interacts, J opens the journal, V switches camera.', seconds: 7 }]);
  const hint = rule(ed, 'Hint after a while', { type: 'timer', value: 75 }, [{ type: 'message', text: 'Hint: crystals are in the office upstairs, in the locked shed, and on the viewing deck.', seconds: 9 }]);
  rule(ed, 'Enter the building', { type: 'enterZone', target: lobby.id }, [{ type: 'info', target: welcome.id }, { type: 'checkpoint' }]);
  rule(ed, 'Leave the building', { type: 'leaveZone', target: lobby.id }, [{ type: 'subtitle', text: 'Outside: try the lever by the shed, the garage button and the purple teleport pad.', seconds: 6 }]);
  rule(ed, 'Near the statue', { type: 'near', target: statueInfo.id, value: 3.5 }, [{ type: 'dialogue', speaker: 'Guide', text: 'Exhibits can explain themselves. Look at the marker and press the key.', seconds: 5 }]);
  rule(ed, 'Elevator arrives', { type: 'elevatorArrive', target: lift.id }, [{ type: 'message', text: 'Elevator: floors, speed, doors and chime are all set in the Inspector.', seconds: 4 }]);
  rule(ed, 'Lever unlocks the shed', { type: 'interact', target: lever.id }, [{ type: 'door', target: shedDoor.id, mode: 'unlock' }, { type: 'door', target: shedDoor.id, mode: 'open' }, { type: 'playAudio', target: chimeSrc.id }, { type: 'message', text: 'The shed door swings open.', seconds: 4 }]);
  rule(ed, 'Button toggles the garage', { type: 'interact', target: button.id }, [{ type: 'door', target: garDoor.id, mode: 'toggle' }], false);
  rule(ed, 'Teleport to lake', { type: 'interact', target: padA.id }, [{ type: 'teleport', target: padB.id }], false);
  rule(ed, 'Teleport to plaza', { type: 'interact', target: padB.id }, [{ type: 'teleport', target: padA.id }], false);
  rule(ed, 'Rain at the lake', { type: 'enterZone', target: lakeZone.id }, [{ type: 'environment', preset: 'Rainy' }, { type: 'subtitle', text: 'Events can change the weather and atmosphere.', seconds: 5 }], false);
  rule(ed, 'Sun away from the lake', { type: 'leaveZone', target: lakeZone.id }, [{ type: 'environment', preset: 'Sunny afternoon' }], false);
  rule(ed, 'Viewpoint cinematic', { type: 'enterZone', target: viewZone.id }, [{ type: 'cinematic', id: fly.id }]);
  rule(ed, 'After the flyover', { type: 'cinematicEnd', target: fly.id }, [{ type: 'message', text: 'That was a cinematic. Its camera path is in the Cinematic timeline tab.', seconds: 6 }]);
  for (const [i, c] of [c1, c2, c3].entries()) rule(ed, `Crystal ${i + 1} collected`, { type: 'collect', target: c.id }, [{ type: 'playAudio', target: chimeSrc.id }, { type: 'setVar', name: 'crystals', op: 'add', value: 1 }, { type: 'disableRule', rule: hint.id }]);
  rule(ed, 'One crystal', { type: 'variable', name: 'crystals' }, [{ type: 'objective', text: 'Find 3 glowing crystals (1/3)' }], true, [{ name: 'crystals', op: '=', value: 1 }]);
  rule(ed, 'Two crystals', { type: 'variable', name: 'crystals' }, [{ type: 'objective', text: 'Find 3 glowing crystals (2/3)' }], true, [{ name: 'crystals', op: '=', value: 2 }]);
  rule(ed, 'All crystals found', { type: 'variable', name: 'crystals' }, [{ type: 'objective', text: 'Return to the plaza' }, { type: 'show', target: trophy.id }, { type: 'environment', preset: 'Showcase glow' }, { type: 'dialogue', speaker: 'Guide', text: 'All three! A golden trophy has appeared on the plaza, and the sky changed to a saved custom preset.', seconds: 8 }, { type: 'wait', seconds: 8 }, { type: 'objective', text: '' }, { type: 'message', text: 'That is the tour. Press Esc, stop the preview and start changing things.', seconds: 10 }], true, [{ name: 'crystals', op: '>=', value: 3 }]);
}

/** A furnished computer lab: rows of workstations, teaching wall, server corner, printing area and a short guided activity. */
function buildComputerLab(ed: Editor) {
  const slide = ed.addAsset(pngFile('Lesson slide.png', 960, 540, (g) => {
    g.fillStyle = '#10243d'; g.fillRect(0, 0, 960, 540);
    g.fillStyle = '#e8a33d'; g.fillRect(0, 0, 960, 12); g.fillRect(60, 150, 120, 6);
    g.fillStyle = '#fff'; g.font = 'bold 58px sans-serif'; g.fillText('Lesson 1: How networks work', 60, 120);
    g.font = '32px sans-serif';
    ['Every computer in this lab connects to the switch', 'The switch connects to the server rack and router', 'The router connects the lab to the internet'].forEach((t, i) => { g.fillStyle = '#e8a33d'; g.fillRect(64, 222 + i * 70, 14, 14); g.fillStyle = '#dfe8f2'; g.fillText(t, 100, 240 + i * 70); });
    g.fillStyle = '#7f93aa'; g.font = '24px sans-serif'; g.fillText('Replace this slide: select the screen and choose your own image, GIF or video', 60, 500);
  }), 'image');
  const BARS = [[16, 36, 61], [63, 217, 106], [232, 163, 61], [255, 255, 255], [42, 93, 148]];
  const status = ed.addAsset(gifFile('Server status.gif', 96, 54, 10, 14, BARS, (x, y, f) => (y < 8 ? 4 : y > 44 ? (x < 8 + f * 9 ? 2 : 0) : x > 6 && x < 90 && (y - 12) % 8 < 5 ? ((((x >> 3) * 7 + ((y - 12) >> 3) * 5 + f) % 9 < 6 ? 1 : 0)) : 0)), 'image');

  ed.createTerrain({ size: 65, cell: 4, seed: 3, amplitude: 0, frequency: 0.01, flat: true });
  Object.assign(ed.scene.env, structuredClone(ENV_PRESETS['Sunny afternoon']), { bloom: 0.12 });
  const W = 14, D = 10, H = 3.2, F = 0.05;
  const { g, walls } = room(ed, 'Computer lab', 0, 0, 0, W, D, H, { color: '#e9ecef', floorColor: '#5f6b78' });
  const at = (key: string, x: number, z: number, rotY = 0, y = F, name?: string) => prefab(ed, key, x, z, rotY, g.id, y, name);
  const door = opening(ed, walls.south, 'door', 11.5, { style: 'sliding', auto: true, width: 1.5, color: '#3d4b5c' });
  [2.4, 5, 7.6].forEach((a) => opening(ed, walls.west, 'window', a, { width: 1.8, height: 1.4 }));
  opening(ed, walls.east, 'window', 3, { width: 1.8, height: 1.4 });

  // Student rows: twelve complete workstations facing the teaching wall.
  const rows = ed.spawn('group', 'Student workstations', { folder: true }, [0, 0, 0], g.id);
  let n = 0;
  for (const z of [-1.3, 0.9, 3.1]) for (const x of [-5.6, -3.7, -1.3, 0.6]) prefab(ed, 'workstation', x, z, 0, rows.id, F, `Workstation ${++n}`);

  // Teaching wall: projected lesson, whiteboard, clock, teacher's desk and a ceiling projector.
  ed.spawn('screen', 'Lesson screen', { media: slide, width: 3.4, height: 1.92, frame: '#22252a' }, [-1.6, 0.95, -4.86], g.id);
  at('whiteboard', 2.4, -4.87); at('clock', 4.4, -4.86, 0, 0.8);
  at('workstation', 4.6, -3.1, 180, F, 'Teacher’s desk'); at('desk_phone', 5.1, -3.3, 180, 0.81); at('desk_lamp', 4.1, -3.35, 180, 0.81);
  at('projector', -1.6, -1.6, 180, 2.86, 'Ceiling projector');
  ed.spawn('primitive', 'Projector mount', { shape: 'cylinder', color: '#2a2e35', solid: false }, [-1.6, 3.08, -1.6], g.id, { scale: [0.05, 0.24, 0.05] });

  // Server corner (south-east) with a live status display.
  at('server_rack', 6.45, 3.9, -90); at('server_rack', 6.45, 2.95, -90, F, 'Server rack 2'); at('filing_cabinet', 6.6, 1.9, -90); at('network_switch', 6.55, 1.9, -90, 1.38); at('router', 6.55, 1.9, -90, 1.43);
  ed.spawn('screen', 'Server status display', { media: status, width: 0.96, height: 0.54, fit: 'stretch' }, [6.86, 1.75, 0.6], g.id, { rot: [0, -90, 0] });
  // Printing and break area (west wall and south-west corner).
  at('copier', -6.5, 4.2, 90); at('table', -6.4, 2.6, 90); at('desk_printer', -6.4, 2.9, 90, 0.83); at('waste_bin', -6.6, 1.6); at('water_cooler', -6.6, -4.4, 90); at('potted_plant', -6.5, -3.5);
  at('lockers', -3.4, 4.72, 180); at('lockers', -2.45, 4.72, 180, F, 'Lockers 2'); at('notice_board', 0.4, 4.88, 180); at('bookcase_office', 2.2, 4.75, 180); at('potted_plant', 6.4, -4.4); at('waste_bin', 5.6, 4.5);
  // Laptop bar along the east wall.
  at('table', 6.45, -1.4, 90, F, 'Laptop bar'); at('laptop', 6.45, -1.75, -90, 0.83); at('laptop', 6.45, -1.0, -90, 0.83, 'Laptop 2'); at('visitor_chair', 5.7, -1.75, 90); at('visitor_chair', 5.7, -1.0, 90, F, 'Visitor chair 2');
  const lights = ed.spawn('group', 'Ceiling lights', {}, [0, 0, 0], g.id);
  for (const [x, z] of [[-3.5, -2], [3.5, -2], [-3.5, 2.4], [3.5, 2.4]]) prefab(ed, 'ceiling_light', x, z, 0, lights.id, H);

  // Outside: approach, sign and a little greenery.
  ed.spawn('text', 'Lab sign', { text: 'COMPUTER LAB', width: 3.6, height: 0.55, color: '#ffffff', background: '#10243d' }, [4.4, 2.45, 5.14], g.id);
  ed.spawn('road', 'Path to the lab', { points: [[0, 0], [0, -11]], width: 2.4, color: '#8a8f96' }, [4.4, 0, 17]);
  prefab(ed, 'street_lamp', 6.6, 9, 180); prefab(ed, 'bench', 2, 7.2, 0); prefab(ed, 'bicycle', 8.6, 6.2, 20); prefab(ed, 'trash_bin', 6.4, 6.2);
  scatter(ed, 'tree_oak', 'Trees', 46, 110, 71, (x, z) => Math.abs(x) < 11 && z > -9 && z < 22); scatter(ed, 'bush', 'Hedges', 60, 40, 72, (x, z) => Math.abs(x) < 9 && Math.abs(z) < 7.5 || Math.abs(x - 4.4) < 2.5 && z > 0);
  spawnAt(ed, 4.4, 15, 0);

  // Information points.
  info(ed, 'Today’s lesson', 'The lesson screen plays any image, GIF or video.\n\n**Try it:** select the screen in the editor and choose your own slides under *Plays*.', [-1.6, 1.5, -3.6], { template: 'education', activation: 'key', distance: 3.2 }, g.id);
  info(ed, 'Server corner', 'Two racks, a switch and the Wi-Fi router. Everything in the lab connects here.\n\nThe small display shows an animated status GIF.', [5.6, 1.5, 3.2], { distance: 2.2, template: 'object' }, g.id);
  info(ed, 'Printing area', 'Photocopier and a desktop printer. Add your own print rules or opening hours here.', [-5.6, 1.5, 3.4], { distance: 2.2 }, g.id);
  info(ed, 'Workstation', 'Each workstation is a single library object (desk, chair, PC, monitor, keyboard and mouse). The separate pieces are in the **Office** and **Computers** categories if you want a different layout.', [-1.3, 1.25, -0.9], { activation: 'click', distance: 3 }, g.id);

  // Activity: find three USB drives; a switch dims the lights for the presentation; a short tour on entry.
  const usb = (name: string, pos: Vec3, note: string) => ed.spawn('primitive', name, { shape: 'box', color: '#ff5d7a', emissive: 1.8, solid: false, collectible: true, note }, pos, g.id, { scale: [0.07, 0.025, 0.2] });
  const drives = [usb('USB drive (teacher)', [4.2, 0.83, -2.9], 'Labelled “Lesson plans”.'), usb('USB drive (server)', [6.55, 1.44, 2.1], 'Labelled “Backups – do not remove”. Oops.'), usb('USB drive (laptop bar)', [6.3, 0.85, -1.4], 'Labelled “Group project, final FINAL v3”.')];
  const sw = ed.spawn('prefab', 'Light switch', { prefab: 'button_panel', interactable: true, prompt: 'Dim the lights for the presentation' }, [3.2, 0, 4.86], g.id, { rot: [0, 180, 0] });
  const entry = ed.spawn('trigger', 'Entrance zone', { size: [2.4, 3, 1.6] }, [4.4, 0, 4], g.id);
  const serverZone = ed.spawn('trigger', 'Server zone', { size: [2.2, 3, 3.4] }, [5.9, 0, 3], g.id);
  const tour = cinematic(ed, 'Lab tour', 12, [camKey(0, [4.4, 1.7, 4.2], [-1.6, 1.6, -4.8]), camKey(4, [5.5, 2.5, -0.5], [-4, 0.9, 1]), camKey(8, [-5.8, 2.4, -3.6], [1, 0.9, 2.5]), camKey(12, [0, 1.9, 4], [-1.6, 1.8, -4.8], 45)],
    { title: 'COMPUTER LAB', subtitles: [{ t: 1.5, d: 3, text: 'Twelve workstations face the teaching wall.' }, { t: 5, d: 3, text: 'Servers and network gear sit in the corner.' }, { t: 8.5, d: 3, text: 'Three USB drives were left behind. Can you find them?' }] });
  rule(ed, 'Welcome', { type: 'start' }, [{ type: 'objective', text: 'Enter the computer lab' }, { type: 'message', text: 'The door opens by itself. E interacts, J opens the journal.', seconds: 6 }]);
  rule(ed, 'Tour on entry', { type: 'enterZone', target: entry.id }, [{ type: 'cinematic', id: tour.id }]);
  rule(ed, 'After the tour', { type: 'cinematicEnd', target: tour.id }, [{ type: 'objective', text: 'Find the 3 USB drives (0/3)' }, { type: 'checkpoint' }, { type: 'dialogue', speaker: 'Instructor', text: 'Welcome. Take a look around, and if you spot any USB drives, please collect them.', seconds: 6 }]);
  rule(ed, 'Dim the lights', { type: 'interact', target: sw.id }, [{ type: 'hide', target: lights.id }, { type: 'environment', preset: 'Night' }, { type: 'subtitle', text: 'Lights dimmed for the presentation – they come back in 15 seconds.', seconds: 5 }, { type: 'wait', seconds: 15 }, { type: 'show', target: lights.id }, { type: 'environment', preset: 'Sunny afternoon' }], false);
  rule(ed, 'Server corner notice', { type: 'enterZone', target: serverZone.id }, [{ type: 'subtitle', text: 'Server corner: authorised staff only.', seconds: 4 }], false);
  drives.forEach((d, i) => rule(ed, `Drive ${i + 1} collected`, { type: 'collect', target: d.id }, [{ type: 'setVar', name: 'drives', op: 'add', value: 1 }]));
  [1, 2].forEach((k) => rule(ed, `${k} drive${k > 1 ? 's' : ''} found`, { type: 'variable', name: 'drives' }, [{ type: 'objective', text: `Find the 3 USB drives (${k}/3)` }], true, [{ name: 'drives', op: '=', value: k }]));
  rule(ed, 'All drives found', { type: 'variable', name: 'drives' }, [{ type: 'objective', text: '' }, { type: 'dialogue', speaker: 'Instructor', text: 'All three – thank you! The lab is yours. Stop the preview to rearrange it or add your own lesson.', seconds: 9 }], true, [{ name: 'drives', op: '>=', value: 3 }]);
  void door;
}

/**
 * AUST Achrafieh campus sample. Ground elevation is downloaded for the campus location when the
 * world is created; the blocks, parking, lawn and court are traced from the campus block plan.
 * Positions are measured on that plan (about 0.207 m per pixel, taken from the basketball court)
 * and assume the plan is drawn north-up.
 */
async function buildAustCampus(ed: Editor) {
  const LAT = 33.884, LON = 35.52016, HALF = 170, S = 0.207;
  const m = (px: number, py: number): [number, number] => [Math.round((px - 345) * S * 100) / 100, Math.round((py - 253) * S * 100) / 100];
  const r2 = (v: number) => Math.round(v * 100) / 100;

  // ---- 1. real-world elevation (falls back to gentle generated ground when offline)
  let real = false;
  try {
    const dLat = HALF / 110540, dLon = HALF / (111320 * Math.cos((LAT * Math.PI) / 180));
    const plan = geo.planImport([LON - dLon, LAT - dLat, LON + dLon, LAT + dLat], 257), prov = geo.PROVIDERS[0];
    const res = await Promise.race([geo.fetchElevation(ed, plan, prov, () => {}), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))]);
    geo.installGeoTerrain(ed, plan, res.heights, 1, prov);
    for (let i = 0; i < 3; i++) ed.terrain!.brush(2, 0, 0, HALF * 1.6, 1); // the source data is ~30 m per sample: soften the steps
    real = true;
  } catch {
    ed.createTerrain({ size: 257, cell: 1.33, seed: 7, amplitude: 5, frequency: 0.004, flat: false });
    ed.toast('Elevation for Achrafieh could not be downloaded, so the campus was built on gently sloping placeholder ground. With a connection, use World → Import real place → Replace to load the real elevation; everything stays on the ground.', 'error');
  }
  const T = ed.terrain!, gy = (x: number, z: number) => ed.heightAt(x, z);
  Object.assign(ed.scene.env, structuredClone(ENV_PRESETS['Sunny afternoon']), { bloom: 0.1, fogDensity: 0.0008 });

  // ---- 2. ground surfaces painted onto the terrain
  const inside = (pts: [number, number][], x: number, z: number) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const yard = ([[262, 288], [300, 230], [305, 140], [345, 135], [400, 118], [400, 55], [455, 50], [500, 32], [560, 26], [600, 60], [645, 150], [668, 240], [662, 330], [668, 470], [600, 482], [435, 472], [435, 345], [300, 398], [190, 392], [188, 335], [262, 326]] as [number, number][]).map(([a, b]) => m(a, b));
  const courtC = m(507, 433), courtY = gy(courtC[0], courtC[1]);
  for (let i = 0; i < 6; i++) T.brush(3, courtC[0], courtC[1], 19, 1, courtY);
  for (let x = -34; x <= 70; x += 2.5) for (let z = -50; z <= 50; z += 2.5) if (inside(yard, x, z)) for (let i = 0; i < 3; i++) T.paint(7, x, z, 3, 1);
  const grass = (px: number, py: number, rad: number) => { const [x, z] = m(px, py); for (let i = 0; i < 5; i++) T.paint(0, x, z, rad, 1); };
  for (let a = 0; a < 6.28; a += 0.5) grass(577 + Math.cos(a) * 26, 255 + Math.sin(a) * 18, 4.2);
  grass(577, 255, 6);
  ([[612, 118], [632, 140], [650, 168], [664, 200], [672, 235], [674, 270], [668, 300], [650, 322], [618, 334], [585, 342], [556, 350]] as [number, number][]).forEach(([a, b]) => grass(a, b, 4.2));
  grass(272, 292, 2.2);

  // ---- 3. the blocks, traced from the plan (heights are placeholders: set the real number of storeys in the Inspector)
  const campus = ed.spawn('group', 'AUST Achrafieh campus', { folder: true }, [0, 0, 0]);
  const blocks = ed.spawn('group', 'Blocks', { folder: true }, [0, 0, 0], campus.id), labels = ed.spawn('group', 'Signs and information', { folder: true }, [0, 0, 0], campus.id);
  const BLOCKS: [string, number, string, [number, number][], [number, number]][] = [
    ['Block A', 17.5, '#d8d2c4', [[585, 388], [648, 380], [668, 468], [628, 478], [585, 440]], [572, 420]],
    ['Block B', 21, '#d8d2c4', [[500, 38], [545, 30], [570, 45], [590, 95], [585, 140], [560, 170], [530, 162], [515, 122]], [545, 185]],
    ['Block M', 10.5, '#d8d2c4', [[405, 58], [450, 58], [450, 100], [405, 100]], [428, 112]],
    ['Block L', 17.5, '#d9a05b', [[455, 130], [505, 120], [520, 165], [500, 185], [465, 192], [448, 160]], [488, 204]],
    ['Block N', 17.5, '#d9a05b', [[368, 160], [425, 148], [442, 185], [430, 205], [385, 210], [365, 190]], [408, 222]],
    ['Block I', 17.5, '#d9a05b', [[310, 150], [345, 143], [362, 200], [350, 222], [318, 215], [303, 180]], [338, 236]],
    ['Block H', 14, '#d8d2c4', [[300, 280], [345, 268], [358, 318], [318, 338], [296, 318]], [372, 300]],
    ['Block G', 7, '#d8d2c4', [[238, 322], [275, 318], [290, 345], [280, 362], [240, 362]], [300, 352]],
    ['CCE Workshop', 5, '#c9c4b8', [[192, 340], [236, 346], [236, 364], [298, 374], [292, 392], [205, 388], [190, 365]], [262, 402]],
    ['Small building (unlabelled on the plan)', 4, '#e3ded2', [[352, 234], [400, 224], [407, 252], [360, 262]], [380, 272]],
  ];
  for (const [name, height, color, px, sign] of BLOCKS) {
    const pts = px.map(([a, b]) => m(a, b)), cx = pts.reduce((n, q) => n + q[0], 0) / pts.length, cz = pts.reduce((n, q) => n + q[1], 0) / pts.length;
    ed.spawn('poly', name, { points: pts.map(([x, z]) => [r2(x - cx), r2(z - cz)]), height, color, opacity: 1, windows: height > 6 }, [r2(cx), 0, r2(cz)], blocks.id);
    const [sx, sz] = m(sign[0], sign[1]), y = gy(sx, sz), short = name.replace(/ \(.*/, '');
    ed.spawn('text', `${short} sign`, { text: short.toUpperCase(), width: Math.max(2.2, short.length * 0.3), height: 0.55, color: '#ffffff', background: '#123a6b' }, [sx, r2(y + 1.9), sz], labels.id, { rot: [0, Math.atan2(sx - cx, sz - cz) * 57.3, 0] });
    ed.spawn('primitive', `${short} sign post`, { shape: 'cylinder', color: '#55606c', solid: false }, [sx, r2(y + 0.95), sz], labels.id, { scale: [0.08, 1.9, 0.08] });
    if (!name.startsWith('Small')) info(ed, short, `**${short}**, traced from the campus block plan.\n\nReplace this text with the departments, labs and offices in this block. The building height is a placeholder – set it in the Inspector.`, [sx, r2(y + 1.5), sz + 0.4], { distance: 4, template: 'education' }, labels.id);
  }

  // ---- 4. parking, lawn, palms, garden and the basketball court
  const land = ed.spawn('group', 'Grounds', { folder: true }, [0, 0, 0], campus.id);
  const put = (key: string, px: number, py: number, rot = 0, name?: string) => { const [x, z] = m(px, py); return prefab(ed, key, x, z, rot, land.id, gy(x, z), name); };
  ([[447, 210], [468, 200], [490, 191], [514, 182]] as [number, number][]).forEach(([a, b], i) => put('tree_palm', a, b, i * 50, `Palm ${i + 1}`));
  put('potted_plant', 427, 220);
  ([[468, 352], [482, 366], [496, 354], [476, 378], [548, 340], [562, 350], [575, 338]] as [number, number][]).forEach(([a, b]) => put('bush', a, b));
  ([[625, 130], [655, 185], [672, 250], [660, 312]] as [number, number][]).forEach(([a, b], i) => put('tree_oak', a, b, i * 70));
  put('tree_oak', 560, 250, 20); put('tree_oak', 598, 262, 140); put('bench', 577, 300, 180); put('bench', 540, 215, 0); put('street_lamp', 520, 300, 90); put('street_lamp', 420, 300, -90); put('trash_bin', 590, 300);
  ([[412, 278], [428, 276], [444, 274], [476, 300], [492, 298]] as [number, number][]).forEach(([a, b], i) => put('car', a, b, i < 3 ? 8 : 100, `Parked car ${i + 1}`));
  ed.spawn('text', 'Parking sign', { text: 'PARKING', width: 2.4, height: 0.6, color: '#ffffff', background: '#1d5fa8' }, [m(456, 240)[0], r2(gy(...m(456, 240)) + 2), m(456, 240)[1]], labels.id);
  const court = ed.addAsset(pngFile('Basketball court.png', 560, 300, (g) => {
    g.fillStyle = '#b9bcc0'; g.fillRect(0, 0, 560, 300);
    g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.strokeRect(12, 12, 536, 276);
    g.beginPath(); g.moveTo(280, 12); g.lineTo(280, 288); g.stroke(); g.beginPath(); g.arc(280, 150, 38, 0, 6.3); g.stroke();
    for (const sx of [12, 548]) { const d = sx === 12 ? 1 : -1; g.strokeRect(sx, 102, 112 * d, 96); g.beginPath(); g.arc(sx + 112 * d, 150, 38, 0, 6.3); g.stroke(); g.beginPath(); g.arc(sx + 30 * d, 150, 132, -1.25, 1.25, d < 0); g.stroke(); }
  }), 'image');
  ed.spawn('primitive', 'Basketball court', { shape: 'plane', color: '#ffffff', texture: court, roughness: 0.9 }, [courtC[0], r2(courtY + 0.04), courtC[1]], land.id, { scale: [30, 1, 16] });
  for (const sx of [-1, 1]) {
    ed.spawn('primitive', 'Hoop post', { shape: 'cylinder', color: '#2a2e35' }, [r2(courtC[0] + sx * 15.4), r2(courtY + 1.6), courtC[1]], land.id, { scale: [0.16, 3.2, 0.16] });
    ed.spawn('primitive', 'Backboard', { shape: 'box', color: '#f2f2f0', solid: false }, [r2(courtC[0] + sx * 14.5), r2(courtY + 3.2), courtC[1]], land.id, { scale: [0.08, 1.05, 1.8] });
    ed.spawn('primitive', 'Hoop arm', { shape: 'box', color: '#2a2e35', solid: false }, [r2(courtC[0] + sx * 14.95), r2(courtY + 3.1), courtC[1]], land.id, { scale: [0.9, 0.08, 0.08] });
    ed.spawn('primitive', 'Hoop', { shape: 'cylinder', color: '#e8642a', solid: false }, [r2(courtC[0] + sx * 14.15), r2(courtY + 3.0), courtC[1]], land.id, { scale: [0.46, 0.04, 0.46] });
  }

  // ---- 5. surrounding streets, approximated from the grey bands on the plan
  const street = (name: string, px: [number, number][], width: number) => { const pts = px.map(([a, b]) => m(a, b)); ed.spawn('road', name, { points: pts.map(([x, z]) => [r2(x - pts[0][0]), r2(z - pts[0][1])]), width, sidewalks: false }, [pts[0][0], 0, pts[0][1]], land.id); };
  street('Street (north)', [[0, 228], [110, 172], [215, 98], [330, 58], [460, 22], [560, 0]], 7);
  street('Street (west)', [[18, 0], [18, 500]], 7);
  street('Street (north-west)', [[215, 0], [215, 98]], 6);
  street('Campus entrance drive', [[330, 62], [340, 128], [372, 236], [430, 268]], 4.5);

  // ---- 6. visitor start, a campus tour and guidance
  const [sx, sz] = m(455, 300);
  spawnAt(ed, sx, sz, 0);
  const board = put('info_board', 440, 318, 160, 'Campus map board');
  board.props.interactable = true; board.props.prompt = 'Start the campus flyover';
  const top = (px: number, py: number, up: number): Vec3 => { const [x, z] = m(px, py); return [x, r2(gy(x, z) + up), z]; };
  const tour = cinematic(ed, 'Campus flyover', 18, [camKey(0, top(455, 320, 3), top(455, 200, 6)), camKey(5, top(600, 420, 38), top(470, 250, 0), 60), camKey(10, top(330, 60, 34), top(430, 240, 0), 60), camKey(14, top(230, 420, 30), top(400, 250, 2), 58), camKey(18, top(455, 330, 2.2), top(455, 200, 6), 50)],
    { title: 'AUST · ACHRAFIEH', subtitles: [{ t: 1.5, d: 3.5, text: 'Blocks I, N and L line the north side of the parking.' }, { t: 6, d: 3.5, text: 'Block B and Block A stand on the east side, beside the lawn and the court.' }, { t: 11, d: 4, text: 'Blocks H and G and the CCE Workshop are to the south-west.' }] });
  rule(ed, 'Welcome', { type: 'start' }, [{ type: 'objective', text: 'Explore the campus' }, { type: 'message', text: real ? 'The ground follows real elevation data for Achrafieh. Walk up to a sign to read about a block.' : 'Walk up to a sign to read about a block.', seconds: 7 }, { type: 'wait', seconds: 7 }, { type: 'message', text: 'Use the map board beside you for a flyover of the campus.', seconds: 6 }]);
  rule(ed, 'Flyover from the map board', { type: 'interact', target: board.id }, [{ type: 'cinematic', id: tour.id }], false);
  rule(ed, 'After the flyover', { type: 'cinematicEnd', target: tour.id }, [{ type: 'objective', text: '' }], false);
  ed.project.description = 'AUST Achrafieh campus sample: blocks traced from the campus plan on real-world elevation.';
  T.markAllDirty();
  ed.terrainChanged();
  ed.viewport?.frameAll();
}

export const TEMPLATES: Template[] = [
  { key: 'showcase', name: 'Feature showcase', blurb: 'A guided tour of everything: terrain, a two-storey building, machinery, screens, events, a cinematic and more.', build: buildShowcase },
  { key: 'blank', name: 'Empty world', blurb: 'A clean grid. Start from nothing.', build(ed) { spawnAt(ed, 0, 6, 0); } },
  {
    key: 'walking', name: 'Walking simulator', blurb: 'Rolling hills, a trail, points of interest and a summit viewpoint.',
    build(ed) {
      ed.createTerrain({ size: 257, cell: 2, seed: 11, amplitude: 46, frequency: 0.006, flat: false });
      env(ed, 'Sunny afternoon');
      const pts = [[0, 60], [-18, 20], [10, -20], [40, -60], [30, -110]];
      ed.spawn('road', 'Trail', { points: pts.map((p) => [p[0] - pts[0][0], p[1] - pts[0][1]]), width: 2.2, color: '#8a7558' }, [pts[0][0], 0, pts[0][1]]);
      const nearTrail = (x: number, z: number) => pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < 9);
      scatter(ed, 'tree_pine', 'Pine forest', 420, 240, 3, nearTrail);
      scatter(ed, 'tree_oak', 'Oak trees', 120, 200, 5, nearTrail);
      scatter(ed, 'rock', 'Rocks', 90, 230, 8, nearTrail, 0.6, 2.2);
      scatter(ed, 'grass_tuft', 'Grass', 900, 120, 9, () => false, 0.8, 1.6);
      spawnAt(ed, 0, 62, 0);
      prefab(ed, 'info_board', -2.5, 55, 20);
      info(ed, 'The old trail', 'This path has been walked for centuries. Follow it to the viewpoint at the end.\n\n**Tip:** hold Shift to run.', [-2.5, ground(ed, -2.5, 55) + 1.6, 55]);
      prefab(ed, 'bench', 12, -18, 200);
      info(ed, 'Resting place', 'A quiet bench. Information boxes like this one appear when you walk close.', [12, ground(ed, 12, -18) + 1.5, -18], { template: 'history' });
      const zone = ed.spawn('trigger', 'Viewpoint zone', { size: [14, 6, 14] }, [30, ground(ed, 30, -108) - 1, -108]);
      prefab(ed, 'campfire', 31, -106);
      const y = ground(ed, 30, -110);
      const c = cinematic(ed, 'Viewpoint', 10, [camKey(0, [30, y + 3, -100], [30, y + 2, -140]), camKey(5, [10, y + 22, -120], [40, y, -60]), camKey(10, [60, y + 30, -70], [0, y - 10, 0])], { title: 'THE VIEWPOINT', subtitles: [{ t: 3, d: 5, text: 'From up here the whole valley opens up.' }] });
      rule(ed, 'Reach the viewpoint', { type: 'enterZone', target: zone.id }, [{ type: 'objective', text: '' }, { type: 'cinematic', id: c.id }]);
      rule(ed, 'After the view', { type: 'cinematicEnd', target: c.id }, [{ type: 'message', text: 'You reached the viewpoint. Keep exploring!', seconds: 6 }, { type: 'checkpoint' }]);
      start(ed, 'Follow the trail to the viewpoint', 'Welcome. Follow the trail north.');
    },
  },
  {
    key: 'landscape', name: 'Open-world landscape', blurb: 'A 2 km mountain landscape with streamed terrain and forests.',
    build(ed) {
      ed.createTerrain({ size: 513, cell: 4, seed: 42, amplitude: 260, frequency: 0.0016, flat: false });
      env(ed, 'Sunset');
      ed.scene.env.fogDensity = 0.0006;
      ed.spawn('water', 'Lake', { width: 2048, depth: 2048 }, [0, 2.2, 0]);
      scatter(ed, 'tree_pine', 'Pine forest', 6000, 900, 21, () => false, 1.2, 2.6);
      scatter(ed, 'boulder', 'Boulders', 500, 900, 22, () => false, 0.8, 3);
      let sx = 0, sz = 0;
      for (let i = 0, r = rnd(4); i < 400 && ground(ed, sx, sz) < 8; i++) { sx = (r() - 0.5) * 600; sz = (r() - 0.5) * 600; }
      spawnAt(ed, sx, sz, 0);
      start(ed, 'Explore the landscape', 'A large streamed world: only nearby terrain is loaded.');
    },
  },
  {
    key: 'museum', name: 'Virtual museum', blurb: 'A gallery hall with exhibits on pedestals and museum information boxes.',
    build(ed) {
      env(ed, 'Overcast');
      const { g, walls } = room(ed, 'Exhibition hall', 0, 0, 0, 22, 14, 4.6, { color: '#efece6', floorColor: '#6f6557' });
      opening(ed, walls.south, 'door', 11, { style: 'sliding', auto: true, width: 1.8, color: '#3a3f47' });
      [4, 8, 14, 18].forEach((x) => opening(ed, walls.north, 'window', x, { width: 1.6, height: 1.8 }));
      const ex = [['statue', 'Marble figure', 'Carved around 300 BC. Notice the weight resting on one leg – a pose sculptors called *contrapposto*.'], ['vase', 'Storage amphora', 'Used to carry olive oil across the sea. The pointed base let it stand in sand.'], ['skeleton_fossil', 'Fossil remains', 'Found in 1962. About **70 million** years old.'], ['display_case', 'Coin collection', 'Bronze and silver coins from four different centuries.']];
      ex.forEach(([key, title, body], i) => {
        const x = -7.5 + i * 5;
        if (key === 'vase') { prefab(ed, 'pedestal', x, 0, 0, g.id, 0.05); prefab(ed, key, x, 0, 0, g.id, 1.11, title); } else prefab(ed, key, x, 0, 0, g.id, 0.05, title);
        prefab(ed, 'rope_barrier', x, 1.4, 0, g.id, 0.05);
        info(ed, title, body, [x, 1.9, 0.9], { template: 'museum', font: 'serif', distance: 3.2, background: '#f4efe4', text: '#2a2620', color: '#8a2632' }, g.id);
        ed.spawn('light', 'Spotlight', { type: 'spot', intensity: 60, range: 9, angle: 32, color: '#fff1d6' }, [x, 4.4, 0.4], g.id);
      });
      [-8, -3, 3, 8].forEach((x, i) => { prefab(ed, 'painting', x, -6.86, 0, g.id, 0.3, `Painting ${i + 1}`); });
      info(ed, 'The landscape room', 'Four landscapes by an unknown painter. Press the key shown to read more.', [0, 1.7, -6.3], { template: 'museum', activation: 'key', distance: 4 }, g.id);
      prefab(ed, 'bench', 0, 3.5, 180, g.id, 0.05);
      spawnAt(ed, 0, 11, 0);
      const zone = ed.spawn('trigger', 'Entrance zone', { size: [6, 3, 3] }, [0, 0, 5.5]);
      rule(ed, 'Greeting', { type: 'enterZone', target: zone.id }, [{ type: 'dialogue', speaker: 'Guide', text: 'Welcome to the museum. Walk up to any exhibit to learn about it.', seconds: 6 }]);
      start(ed, 'Visit all four exhibits', 'The museum doors open automatically.');
    },
  },
  {
    key: 'historical', name: 'Historical recreation', blurb: 'Ruins on a hill with historical notes – replace them with your own site.',
    build(ed) {
      ed.createTerrain({ size: 129, cell: 2, seed: 77, amplitude: 14, frequency: 0.008, flat: false });
      env(ed, 'Sunset');
      flatten(ed, 0, 0, 26);
      const y = (x: number, z: number) => ground(ed, x, z);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, x = Math.cos(a) * 9, z = Math.sin(a) * 9; if (i !== 2) prefab(ed, 'column', x, z); }
      prefab(ed, 'arch', 0, 9, 0);
      prefab(ed, 'ruin_wall', -14, -4, 70); prefab(ed, 'ruin_wall', 13, -8, 20); prefab(ed, 'rock_slab', 3, -2, 30); prefab(ed, 'statue', 0, 0);
      info(ed, 'The temple precinct', 'Eight columns once carried a timber roof. Seven still stand.\n\nThe statue at the centre was added about two hundred years later.', [0, y(0, 0) + 2.6, 1], { template: 'history', font: 'serif' });
      info(ed, 'Outer wall', 'These stones were quarried from the hill behind you.', [-14, y(-14, -4) + 2, -3], { template: 'history', font: 'serif' });
      scatter(ed, 'tree_oak', 'Olive grove', 60, 100, 6, (x, z) => Math.hypot(x, z) < 22);
      scatter(ed, 'grass_tuft', 'Dry grass', 500, 60, 7);
      spawnAt(ed, 0, 30, 0);
      start(ed, 'Walk up to the ruins', 'A historical site. Each marker tells part of its story.');
    },
  },
  {
    key: 'abandoned', name: 'Abandoned building', blurb: 'Two floors, stairs, a working elevator, and an arrival cinematic.',
    build(ed) {
      env(ed, 'Abandoned atmosphere');
      ed.createTerrain({ size: 65, cell: 4, seed: 1, amplitude: 0, frequency: 0.01, flat: true });
      const b = ed.spawn('group', 'Building', {}, [0, 0, 0]);
      const g0 = room(ed, 'Ground floor', 0, 0, 0, 12, 10, 3.2, { ceiling: false, color: '#a9a595', floorColor: '#5d5a52', parent: b.id });
      const door = opening(ed, g0.walls.south, 'door', 6.1, { color: '#4a4038' });
      opening(ed, g0.walls.north, 'window', 6, { width: 2 });
      // upper floor slab with openings for the elevator shaft and the stairwell
      const slab = (n: string, x: number, z: number, w: number, d: number) => ed.spawn('floor', n, { width: w, depth: d, thickness: 0.2, color: '#77736a' }, [x, 3.4, z], b.id);
      slab('Slab main', 0.5, 0, 7.6, 10.2); slab('Slab west', -4.7, 1.275, 2.8, 7.65); slab('Slab north-east', 5.2, -3.3, 1.8, 3.6); slab('Slab south-east', 5.2, 4.3, 1.8, 1.6);
      const g1 = room(ed, 'Upper floor', 0, 3.4, 0, 12, 10, 3, { floor: false, color: '#b3ae9c', parent: b.id });
      opening(ed, g1.walls.south, 'window', 3, { width: 1.8 }); opening(ed, g1.walls.south, 'window', 9, { width: 1.8 });
      ed.spawn('stairs', 'Stairs', { width: 1.4, rise: 3.35, run: 5, steps: 18 }, [5.1, 0.05, 3.5], b.id, { rot: [0, 180, 0] });
      const lift = ed.spawn('elevator', 'Elevator', { floors: [{ name: 'G', y: 0.05 }, { name: '1', y: 3.4 }] }, [-4.5, 0, -3.5], b.id);
      prefab(ed, 'crate', -1, -3.4, 15, b.id, 0.05); prefab(ed, 'barrel', 0.4, -3.9, 0, b.id, 0.05); prefab(ed, 'desk', 2, 2.5, 180, b.id, 3.4); prefab(ed, 'bookshelf', -1, -4.6, 0, b.id, 3.4); prefab(ed, 'lantern', 0, 0, 0, b.id, 0.05);
      const note = ed.spawn('prefab', 'Torn notebook', { prefab: 'vase', collectible: true, note: '“…they shut the power off in March. The lift still runs on the backup line.”' }, [2, 4.2, 2.5], b.id);
      info(ed, 'Caretaker’s office', 'Dust on everything except the desk. Someone has been here recently.', [0, 5, 0], { distance: 3.5 }, b.id);
      scatter(ed, 'tree_dead', 'Dead trees', 40, 90, 12, (x, z) => Math.abs(x) < 12 && Math.abs(z) < 16);
      scatter(ed, 'grass_tuft', 'Weeds', 500, 60, 13, (x, z) => Math.abs(x) < 6.2 && Math.abs(z) < 5.2);
      spawnAt(ed, 0, 16, 0);
      const zone = ed.spawn('trigger', 'Doorway zone', { size: [3, 3, 2.4] }, [0.1, 0, 3.6], b.id);
      const c = cinematic(ed, 'Arrival', 9, [camKey(0, [0, 1.7, 3.8], [-3, 1.5, -3]), camKey(4.5, [1.5, 2.1, 1], [-4.5, 1.6, -3.5]), camKey(9, [-1, 1.8, 0], [5, 2.6, 0])], { title: 'THE ANNEX', subtitles: [{ t: 2, d: 3, text: 'Nobody has been here for years.' }, { t: 5.5, d: 3, text: 'Or so they said.' }] });
      rule(ed, 'Arrival cinematic', { type: 'enterZone', target: zone.id }, [{ type: 'cinematic', id: c.id }]);
      rule(ed, 'After arrival', { type: 'cinematicEnd', target: c.id }, [{ type: 'objective', text: 'Find the caretaker’s notebook upstairs' }, { type: 'message', text: 'Take the stairs or the elevator.', seconds: 5 }]);
      rule(ed, 'Elevator arrives', { type: 'elevatorArrive', target: lift.id }, [{ type: 'message', text: 'The elevator shudders to a stop.', seconds: 3 }], false);
      rule(ed, 'Notebook found', { type: 'collect', target: note.id }, [{ type: 'objective', text: '' }, { type: 'dialogue', speaker: 'Notebook', text: '“The lift still runs on the backup line.” – so someone kept the power on.', seconds: 7 }, { type: 'wait', seconds: 7 }, { type: 'end', title: 'To be continued', text: 'This is a template – open the Events tab to see how it works.' }]);
      start(ed, 'Enter the building', 'The door is unlocked. Press E to open it.');
      void door;
    },
  },
  {
    key: 'nature', name: 'Nature exploration', blurb: 'A forest clearing with collectibles and a simple “find them all” goal.',
    build(ed) {
      ed.createTerrain({ size: 193, cell: 2, seed: 5, amplitude: 28, frequency: 0.007, flat: false });
      env(ed, 'Foggy morning');
      const clear = (x: number, z: number) => Math.hypot(x, z) < 10;
      scatter(ed, 'tree_birch', 'Birch wood', 500, 180, 31, clear); scatter(ed, 'tree_pine', 'Pines', 300, 180, 32, clear); scatter(ed, 'bush', 'Bushes', 260, 150, 33, clear); scatter(ed, 'fern', 'Ferns', 700, 110, 34); scatter(ed, 'flowers', 'Wildflowers', 500, 90, 35);
      prefab(ed, 'campfire', 0, 0); prefab(ed, 'bench', 2.5, 1, -110);
      const r = rnd(9);
      for (let i = 0; i < 5; i++) { const a = r() * 6.28, d = 14 + r() * 28, x = Math.cos(a) * d, z = Math.sin(a) * d; ed.spawn('prefab', `Glowing mushroom ${i + 1}`, { prefab: 'lantern', collectible: true, note: 'It hums faintly.' }, [x, ground(ed, x, z), z]); }
      rule(ed, 'All mushrooms found', { type: 'variable', name: 'collected' }, [{ type: 'objective', text: '' }, { type: 'message', text: 'You found all five glowing mushrooms!', seconds: 8 }, { type: 'environment', preset: 'Sunny afternoon' }], true, [{ name: 'collected', op: '>=', value: 5 }]);
      spawnAt(ed, 3, 6, 20);
      start(ed, 'Find 5 glowing mushrooms', 'Something glows between the trees…');
    },
  },
  {
    key: 'campus', name: 'Virtual campus', blurb: 'Buildings, roads with sidewalks, street furniture and wayfinding.',
    build(ed) {
      ed.createTerrain({ size: 129, cell: 3, seed: 2, amplitude: 0, frequency: 0.01, flat: true });
      env(ed, 'Sunny afternoon');
      ed.spawn('road', 'Main avenue', { points: [[0, 0], [0, -160]], width: 8, sidewalks: true }, [0, 0, 80]);
      ed.spawn('road', 'Cross street', { points: [[0, 0], [160, 0]], width: 7, sidewalks: true }, [-80, 0, 0]);
      const blocks: [string, string, number, number, number][] = [['office_block', 'Science building', -26, -30, 90], ['office_block', 'Library', 26, -34, -90], ['tower', 'Administration tower', -28, 34, 90], ['warehouse', 'Workshop', 30, 30, -90], ['shop', 'Campus café', 14, 52, -90], ['church', 'Old chapel', -22, 68, 90]];
      blocks.forEach(([k, n, x, z, r]) => { prefab(ed, k, x, z, r, null, undefined, n); prefab(ed, 'info_board', x > 0 ? 8 : -8, z, x > 0 ? -90 : 90); info(ed, n, `Welcome to the ${n.toLowerCase()}. Replace this text with opening hours, departments or a map.`, [x > 0 ? 8 : -8, 1.7, z], { template: 'education' }); });
      for (let z = -70; z <= 70; z += 20) { prefab(ed, 'street_lamp', 6.2, z, 180).props.lightOn = false; prefab(ed, 'street_lamp', -6.2, z + 10, 0).props.lightOn = false; }
      [[7, 12, -90], [-7, -14, 90], [7, -44, -90]].forEach(([x, z, r]) => prefab(ed, 'bench', x, z, r));
      prefab(ed, 'fountain', 14, 14); prefab(ed, 'car', 2, 40, 0); prefab(ed, 'bicycle', -7.4, 20, 30);
      scatter(ed, 'tree_oak', 'Campus trees', 90, 150, 14, (x, z) => Math.abs(x) < 9 || Math.abs(z) < 8 || blocks.some((b) => Math.hypot(b[2] - x, b[3] - z) < 16));
      spawnAt(ed, 0, 74, 0);
      start(ed, 'Tour the campus', 'Walk up to a board to read about each building.');
    },
  },
  {
    key: 'archviz', name: 'Architectural visualization', blurb: 'A furnished two-room house you can walk through and restyle.',
    build(ed) {
      ed.createTerrain({ size: 65, cell: 3, seed: 3, amplitude: 0, frequency: 0.01, flat: true });
      env(ed, 'Sunny afternoon');
      const h = ed.spawn('group', 'House', {}, [0, 0, 0]);
      const a = room(ed, 'Living room', 0, 0, 0, 8, 6, 2.8, { color: '#f2efe9', floorColor: '#b08d62', parent: h.id });
      const k = room(ed, 'Bedroom', 6.6, 0, 0, 5, 6, 2.8, { color: '#e9ece8', floorColor: '#c4b59a', parent: h.id });
      opening(ed, a.walls.south, 'door', 2, { color: '#2f3b46' });
      opening(ed, a.walls.south, 'window', 5.6, { width: 2.4, height: 1.5 }); opening(ed, a.walls.north, 'window', 4, { width: 3, height: 1.6 });
      opening(ed, a.walls.east, 'door', 2.6, {}); opening(ed, k.walls.west, 'door', 2.6, { style: 'sliding' });
      opening(ed, k.walls.east, 'window', 2.8, { width: 2 });
      const L = a.g.id, B = k.g.id;
      prefab(ed, 'sofa', -1.5, -2.2, 0, L, 0.05); prefab(ed, 'rug', -1.5, -0.6, 0, L, 0.05); prefab(ed, 'tv', -1.5, 2.5, 180, L, 0.05); prefab(ed, 'table', 2.2, -1.6, 90, L, 0.05); prefab(ed, 'chair', 1.2, -1.6, 90, L, 0.05); prefab(ed, 'chair', 3.2, -1.6, -90, L, 0.05); prefab(ed, 'floor_lamp', -3.5, -2.4, 0, L, 0.05); prefab(ed, 'potted_plant', 3.5, 2.4, 0, L, 0.05); prefab(ed, 'bookshelf', -3.7, 0.5, 90, L, 0.05);
      prefab(ed, 'bed', 0.4, -1.6, 0, B, 0.05); prefab(ed, 'wardrobe', -1.6, 2.5, 180, B, 0.05); prefab(ed, 'desk', 1.6, 2.4, 180, B, 0.05); prefab(ed, 'ceiling_light', 0, 0, 0, B, 2.8); prefab(ed, 'ceiling_light', 0, 0, 0, L, 2.8);
      scatter(ed, 'bush', 'Hedge', 40, 22, 15, (x, z) => Math.abs(x - 3) < 8.5 && Math.abs(z) < 4.5);
      prefab(ed, 'tree_birch', -8, 6); prefab(ed, 'tree_oak', 13, -7); prefab(ed, 'car', -7, -2, 10);
      info(ed, 'Living room', '8 × 6 m, ceiling height 2.8 m. Select any wall in the editor to change its material or add windows.', [0, 1.8, 0], { activation: 'key', template: 'object' }, L);
      spawnAt(ed, -2, 9, 0);
      start(ed, 'Walk through the house', 'Doors open with E.');
    },
  },
  {
    key: 'story', name: 'Interactive storytelling', blurb: 'Dialogue, objectives, variables, a locked door and an ending.',
    build(ed) {
      ed.createTerrain({ size: 97, cell: 2, seed: 19, amplitude: 10, frequency: 0.01, flat: false });
      env(ed, 'Night');
      flatten(ed, 0, 0, 14);
      const y = ground(ed, 0, 0);
      const c = room(ed, 'Cabin', 0, y, 0, 6, 5, 2.6, { color: '#7a5a3c', floorColor: '#5b4330' });
      const door = opening(ed, c.walls.south, 'door', 3.1, { locked: true, color: '#3f3027' });
      opening(ed, c.walls.east, 'window', 2.4, {});
      prefab(ed, 'bed', -1.8, -1.2, 0, c.g.id, 0.05); prefab(ed, 'table', 1.4, -1.4, 0, c.g.id, 0.05); prefab(ed, 'lantern', 1.4, -1.4, 0, c.g.id, 0.86);
      const letter = ed.spawn('prefab', 'Letter', { prefab: 'picture_frame', interactable: true, prompt: 'Read the letter' }, [1.4, -0.6, -2.35], c.g.id);
      const key = ed.spawn('prefab', 'Rusty key', { prefab: 'pebbles', collectible: true, note: 'Heavy, cold, and exactly the right size for the cabin door.' }, [6, ground(ed, 6, 9), 9]);
      prefab(ed, 'campfire', 4, 8); prefab(ed, 'bench', 5.5, 6.5, -140); prefab(ed, 'street_lamp', -3, 6, 90);
      scatter(ed, 'tree_pine', 'Dark forest', 380, 90, 41, (x, z) => Math.hypot(x, z - 4) < 12);
      spawnAt(ed, 0, 14, 0);
      rule(ed, 'Opening', { type: 'start' }, [{ type: 'objective', text: 'Get inside the cabin' }, { type: 'dialogue', speaker: 'You', text: 'The cabin… exactly where the map said. But the door is locked.', seconds: 6 }]);
      rule(ed, 'Key found', { type: 'collect', target: key.id }, [{ type: 'setVar', name: 'hasKey', op: 'set', value: 1 }, { type: 'door', target: door.id, mode: 'unlock' }, { type: 'dialogue', speaker: 'You', text: 'A key, by the fire. Someone left in a hurry.', seconds: 5 }, { type: 'objective', text: 'Unlock the cabin and look around' }]);
      rule(ed, 'Read letter', { type: 'interact', target: letter.id }, [{ type: 'dialogue', speaker: 'Letter', text: '“If you are reading this, I made it to the ridge. Do not follow before sunrise.”', seconds: 8 }, { type: 'wait', seconds: 8 }, { type: 'environment', preset: 'Sunset' }, { type: 'objective', text: '' }, { type: 'checkpoint' }, { type: 'wait', seconds: 3 }, { type: 'end', title: 'Sunrise', text: 'Edit this story in the Events tab: every step is a visual WHEN → IF → THEN rule.' }]);
      rule(ed, 'Door hint', { type: 'near', target: door.id, value: 2.5 }, [{ type: 'message', text: 'Locked. There must be a key somewhere near the campfire.', seconds: 5 }], true, [{ name: 'hasKey', op: '=', value: 0 }]);
    },
  },
  { key: 'aust', name: 'AUST Achrafieh campus', blurb: 'Sample of the Achrafieh campus: real elevation for the location, with the blocks, parking, lawn and court traced from the campus plan.', build: buildAustCampus },
  { key: 'computerlab', name: 'Computer lab', blurb: 'Twelve workstations, a teaching wall with a lesson screen, a server corner and a find-the-USB-drives activity.', build: buildComputerLab },
  {
    key: 'gallery', name: 'Virtual art gallery', blurb: 'White-cube gallery with spot-lit canvases and click-to-read labels.',
    build(ed) {
      env(ed, 'Overcast');
      const { g, walls } = room(ed, 'Gallery', 0, 0, 0, 16, 10, 4, { color: '#f7f6f3', floorColor: '#9a968e' });
      opening(ed, walls.south, 'door', 8.1, { style: 'sliding', auto: true, width: 1.6 });
      const art: [string, string, string][] = [['#c2452d', 'Red study', 'Oil on canvas. The artist painted this in a single afternoon.'], ['#2d5dc2', 'Blue study', 'Acrylic. Second in a series of three.'], ['#d9a520', 'Yellow study', 'Tempera on board.'], ['#2d8a5a', 'Green field', 'Oil on linen.'], ['#6a3d9a', 'Violet hour', 'Mixed media.']];
      art.forEach(([color, title, body], i) => {
        const x = -6 + i * 3;
        ed.spawn('primitive', title, { shape: 'box', color, roughness: 0.6, solid: false }, [x, 1.8, -4.85], g.id, { scale: [1.8, 1.3, 0.06] });
        ed.spawn('text', `${title} label`, { text: title, width: 0.7, height: 0.16, color: '#222222', background: '#ffffff' }, [x, 0.85, -4.86], g.id);
        info(ed, title, body, [x, 1.2, -4.6], { activation: 'click', marker: true, distance: 3.5, background: '#ffffff', text: '#1c1c1c', color }, g.id);
        ed.spawn('light', 'Track light', { type: 'spot', intensity: 45, range: 8, angle: 30 }, [x, 3.8, -3], g.id, { rot: [-25, 0, 0] });
      });
      prefab(ed, 'bench', 0, 0.5, 0, g.id, 0.05); prefab(ed, 'potted_plant', 7.2, 4.2, 0, g.id, 0.05);
      spawnAt(ed, 0, 8, 0);
      start(ed, 'Look at the paintings', 'Aim at a marker and click to read about the work.');
    },
  },
];
