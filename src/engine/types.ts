// WANDER project format (versioned). Everything the editor saves and the
// runtime plays is described here.

export type Vec3 = [number, number, number];
export const FORMAT_VERSION = 1;

export type Kind =
  | 'group' | 'primitive' | 'prefab' | 'model' | 'text' | 'light' | 'audio' | 'spawn'
  | 'info' | 'trigger' | 'wall' | 'floor' | 'door' | 'window' | 'stairs' | 'elevator'
  | 'platform' | 'screen' | 'road' | 'poly' | 'scatter' | 'water';

export interface Obj {
  id: string;
  name: string;
  kind: Kind;
  parent: string | null;
  children: string[];
  pos: Vec3;
  rot: Vec3; // degrees, XYZ
  scale: Vec3;
  visible: boolean;
  locked: boolean;
  props: Record<string, any>;
}

export interface TerrainLayer { name: string; color: string }
export interface GeoRef {
  bbox: [number, number, number, number]; // west, south, east, north
  baseElevation: number; // metres above sea level at world y = 0
  minElevation: number;
  maxElevation: number;
  zoom: number;
  source: string;
  attribution: string;
  crs: string;
}
export interface TerrainMeta {
  w: number;
  h: number;
  cell: number;
  exaggeration: number;
  layers: TerrainLayer[];
  hasOriginal: boolean;
  viewDistance: number;
  geo?: GeoRef;
}

export interface Env {
  sunElevation: number;
  sunAzimuth: number;
  sunIntensity: number;
  sunColor: string;
  ambient: number;
  skyTop: string;
  skyHorizon: string;
  fogColor: string;
  fogDensity: number;
  weather: 'none' | 'rain' | 'snow';
  exposure: number;
  shadows: boolean;
  /** Glow around bright areas (0 = off). */
  bloom?: number;
  /** Colour grading. 1 = neutral. */
  saturation?: number;
  contrast?: number;
  /** Length of a full day/night cycle in minutes while playing (0 = sun stays put). */
  dayLength?: number;
}

export interface PlayerSettings {
  mode: 'first' | 'third';
  fov: number;
  sensitivity: number;
  smoothing: number;
  headBob: boolean;
  walkSpeed: number;
  runSpeed: number;
  jump: boolean;
  jumpHeight: number;
  eyeHeight: number;
  interactDistance: number;
  footsteps: boolean;
  /** Lower the rendering resolution automatically when the frame rate drops (default on). */
  autoQuality?: boolean;
}

export interface Condition { name: string; op: '=' | '!=' | '>' | '<' | '>=' | '<='; value: number }
export interface Action { type: string; [k: string]: any }
export interface EventRule {
  id: string;
  name: string;
  enabled: boolean;
  once: boolean;
  trigger: { type: string; target?: string; value?: number; name?: string };
  conditions: Condition[];
  actions: Action[];
}

export interface CamKey { t: number; pos: Vec3; quat: [number, number, number, number]; fov: number; ease: string }
export interface Subtitle { t: number; d: number; text: string }
export interface Cinematic {
  id: string;
  name: string;
  duration: number;
  keys: CamKey[];
  subtitles: Subtitle[];
  title: string;
  fadeIn: number;
  fadeOut: number;
  audio: string; // audio object id or ''
  letterbox: boolean;
}

/** What the importer found in a 3D model; drives the Inspector statistics, validation and previews. */
export interface ModelMeta { tris: number; verts: number; meshes: number; materials: number; textures: number; maxTexture: number; size: [number, number, number]; animations: number; thumb?: string }
export interface Asset { id: string; name: string; type: 'model' | 'image' | 'audio' | 'video'; mime: string; size: number; file?: string; meta?: ModelMeta }
export interface UserPrefab { id: string; name: string; root: string; objects: Record<string, Obj> }

export interface Scene {
  objects: Record<string, Obj>;
  roots: string[];
  terrain: TerrainMeta | null;
  env: Env;
  player: PlayerSettings;
  events: EventRule[];
  cinematics: Cinematic[];
  variables: Record<string, number>;
  assets: Record<string, Asset>;
}

export interface Project {
  format: 'wander';
  version: number;
  id: string;
  name: string;
  description: string;
  created: number;
  modified: number;
  thumbnail?: string;
  scene: Scene;
  envPresets: Record<string, Env>;
  prefabs: UserPrefab[];
}

/** Supplies binary data to the engine (IndexedDB in the editor, fetch() in published builds). */
export interface AssetProvider {
  url(key: string): Promise<string | null>;
  bin(key: string): Promise<ArrayBuffer | null>;
}

export const uid = (p = 'o') => p + Math.random().toString(36).slice(2, 9) + (Date.now() % 46656).toString(36);

export const DEFAULT_LAYERS: TerrainLayer[] = [
  { name: 'Grass', color: '#5d8a3a' },
  { name: 'Dirt', color: '#7a5a3c' },
  { name: 'Sand', color: '#d8c690' },
  { name: 'Rock', color: '#7d7b78' },
  { name: 'Snow', color: '#f2f5f8' },
  { name: 'Mud', color: '#4d3d2c' },
  { name: 'Gravel', color: '#9a958c' },
  { name: 'Concrete', color: '#b9b9b5' },
];

export const ENV_PRESETS: Record<string, Env> = {
  'Sunny afternoon': { sunElevation: 52, sunAzimuth: 135, sunIntensity: 3.0, sunColor: '#fff3df', ambient: 0.9, skyTop: '#2f6fc4', skyHorizon: '#bcd9f2', fogColor: '#c4dcf0', fogDensity: 0.0012, weather: 'none', exposure: 1, shadows: true },
  Overcast: { sunElevation: 60, sunAzimuth: 100, sunIntensity: 0.9, sunColor: '#dfe6ee', ambient: 1.3, skyTop: '#8793a0', skyHorizon: '#c2c8cf', fogColor: '#b9c0c8', fogDensity: 0.004, weather: 'none', exposure: 0.95, shadows: true },
  Sunset: { sunElevation: 6, sunAzimuth: 250, sunIntensity: 2.4, sunColor: '#ff9a4a', ambient: 0.6, skyTop: '#2b3c78', skyHorizon: '#f7a763', fogColor: '#e9a877', fogDensity: 0.003, weather: 'none', exposure: 1, shadows: true },
  Night: { sunElevation: 35, sunAzimuth: 300, sunIntensity: 0.25, sunColor: '#9db4ff', ambient: 0.22, skyTop: '#04060f', skyHorizon: '#111a33', fogColor: '#0a0f1f', fogDensity: 0.004, weather: 'none', exposure: 0.9, shadows: true },
  'Foggy morning': { sunElevation: 18, sunAzimuth: 95, sunIntensity: 1.2, sunColor: '#ffe9cf', ambient: 0.9, skyTop: '#9fb4c6', skyHorizon: '#dfe4e6', fogColor: '#d5dbde', fogDensity: 0.022, weather: 'none', exposure: 1, shadows: true },
  Rainy: { sunElevation: 50, sunAzimuth: 120, sunIntensity: 0.6, sunColor: '#cfd8e2', ambient: 0.95, skyTop: '#55606c', skyHorizon: '#8b949d', fogColor: '#7f8891', fogDensity: 0.009, weather: 'rain', exposure: 0.9, shadows: true },
  Snowy: { sunElevation: 30, sunAzimuth: 140, sunIntensity: 1.1, sunColor: '#f1f5ff', ambient: 1.3, skyTop: '#aab6c4', skyHorizon: '#e6ebf0', fogColor: '#dfe5ea', fogDensity: 0.008, weather: 'snow', exposure: 1, shadows: true },
  'Abandoned atmosphere': { sunElevation: 14, sunAzimuth: 210, sunIntensity: 0.8, sunColor: '#c9c2a0', ambient: 0.45, skyTop: '#39413d', skyHorizon: '#7c7f68', fogColor: '#6c705e', fogDensity: 0.016, weather: 'none', exposure: 0.85, shadows: true },
};

export const DEFAULT_PLAYER: PlayerSettings = {
  mode: 'first', fov: 70, sensitivity: 1, smoothing: 0.35, headBob: true, walkSpeed: 3.2, runSpeed: 6.5,
  jump: true, jumpHeight: 1.1, eyeHeight: 1.65, interactDistance: 3, footsteps: true,
};

export function emptyScene(): Scene {
  return {
    objects: {}, roots: [], terrain: null, env: { ...ENV_PRESETS['Sunny afternoon'] }, player: { ...DEFAULT_PLAYER },
    events: [], cinematics: [], variables: {}, assets: {},
  };
}

export function newProject(name: string): Project {
  const now = Date.now();
  return { format: 'wander', version: FORMAT_VERSION, id: uid('p'), name, description: '', created: now, modified: now, scene: emptyScene(), envPresets: {}, prefabs: [] };
}

export function makeObj(kind: Kind, name: string, props: Record<string, any> = {}, pos: Vec3 = [0, 0, 0]): Obj {
  return { id: uid(), name, kind, parent: null, children: [], pos: [...pos] as Vec3, rot: [0, 0, 0], scale: [1, 1, 1], visible: true, locked: false, props };
}

/** Upgrade older project files in place. Add a case per format bump. */
export function migrate(p: any): Project {
  if (!p || p.format !== 'wander') throw new Error('Not a WANDER project file');
  if (p.version > FORMAT_VERSION) throw new Error(`Project was saved by a newer WANDER (format ${p.version})`);
  p.envPresets ??= {};
  p.prefabs ??= [];
  p.description ??= '';
  p.scene.variables ??= {};
  p.scene.events ??= [];
  p.scene.cinematics ??= [];
  p.scene.assets ??= {};
  p.scene.player = { ...DEFAULT_PLAYER, ...p.scene.player };
  p.version = FORMAT_VERSION;
  return p as Project;
}

/** Default properties for every object kind – also the single source for the Inspector. */
export const KIND_DEFAULTS: Record<Kind, Record<string, any>> = {
  group: {},
  primitive: { shape: 'box', color: '#b8bcc4', roughness: 0.8, metalness: 0, opacity: 1, texture: '', solid: true },
  prefab: { prefab: 'tree_pine', solid: true },
  model: { asset: '', solid: true, collision: 'box', ground: false, animate: true, clip: 0 },
  text: { text: 'Sign', width: 2, height: 0.6, color: '#ffffff', background: '#20242c' },
  light: { type: 'point', color: '#ffe2b0', intensity: 12, range: 14, angle: 40, castShadow: false },
  audio: { asset: '', volume: 0.8, loop: true, positional: true, refDistance: 4, maxDistance: 40, autoplay: true, fade: 1 },
  spawn: {},
  info: { title: 'Information', body: 'Describe this place.', image: '', audio: '', video: '', link: '', linkLabel: 'Learn more', color: '#e8a33d', background: '#14171c', text: '#f1f1ee', font: 'sans', template: 'object', activation: 'proximity', distance: 4, key: 'E', marker: true, animation: 'fade' },
  trigger: { size: [4, 3, 4] },
  wall: { length: 4, height: 3, thickness: 0.2, color: '#d9d5cc', openings: [], texture: '' },
  floor: { width: 4, depth: 4, thickness: 0.2, color: '#8d857a', texture: '' },
  door: { width: 0.95, height: 2.1, style: 'hinged', locked: false, auto: false, color: '#6b4a2f', sound: true },
  window: { width: 1.2, height: 1.2, color: '#9fd0e8' },
  stairs: { width: 1.2, rise: 3.2, run: 4.2, steps: 16, color: '#8a8378' },
  elevator: { floors: [{ name: 'G', y: 0 }, { name: '1', y: 3.2 }], speed: 1.6, startFloor: 0, doorTime: 4, width: 2, depth: 2, height: 2.4, color: '#a9adb3', light: '#fff1d6', sound: true },
  platform: { size: [2, 0.25, 2], offset: [0, 3, 0], speed: 1.5, pause: 1.5, mode: 'loop', color: '#6d7e91' },
  screen: { media: '', width: 1.6, height: 0.9, fit: 'contain', loop: true, sound: false, volume: 0.8, frame: '#15171b', solid: true },
  road: { points: [], width: 6, color: '#3c3d40', sidewalks: false, kindOf: 'road' },
  poly: { points: [], height: 0, color: '#9c948a', opacity: 1 },
  scatter: { prefab: 'tree_pine', items: [], solid: true },
  water: { width: 40, depth: 40, color: '#2f6f9a', opacity: 0.72 },
};

export const EASES: Record<string, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};
