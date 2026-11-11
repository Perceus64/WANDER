# WANDER

**A no-code, browser-based 3D world creation engine.** Build worlds. Tell stories. Let people explore.

WANDER runs entirely in the browser: a Rust/WebAssembly engine core, a React editor, and a three.js renderer. There is no backend. Projects live in IndexedDB, and **Publish** produces a standalone website you can host anywhere.

## Quick start

Requirements: Node 20+, Rust (stable) with the `wasm32-unknown-unknown` target.

```bash
rustup target add wasm32-unknown-unknown
npm install
npm run dev        # builds the WASM core + standalone runtime, then starts Vite
npm run build      # production build in dist/
npm test           # Rust unit tests for the engine core
```

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository (branch `main`).
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml` (also runnable by hand from the **Actions** tab). It tests and compiles the Rust core, builds the runtime and editor, and deploys `dist/`. The build summary and logs are on the workflow run page.

All asset paths are relative, so the site works under any `https://<user>.github.io/<repo>/` path without configuration. The `.wasm` file is fetched with streaming compilation and falls back to an array-buffer load if the host sends the wrong MIME type.

## How it is put together

| Part | Where | Role |
| --- | --- | --- |
| Engine core (Rust → WASM) | `crates/wander-core` | Terrain storage, procedural generation, sculpt/paint brushes, chunk meshing with LOD, terrain ray casting, elevation-tile decoding, resampling, gap filling |
| Shared engine (TypeScript) | `src/engine` | Project format, object builders, prefabs, terrain streaming, sky/light/weather/post-processing, runtime (player, physics, machinery, events, cinematics, HUD) |
| Editor | `src/editor`, `src/ui` | Viewport and tools, undo/redo, storage, geographic import, templates, validation and publishing, React panels |
| Standalone player | `src/player.ts` → `public/runtime` | The runtime bundled on its own; this is what Publish ships |

The core exposes a plain C ABI (no bindings generator), so the only build tool it needs is `cargo`.

Editor hosting and published experiences are separate: the editor is this site; a published world is a zip containing `index.html`, `player.js`, `wander_core.wasm`, `project.json` and `assets/`, with no dependency on the editor.

## What works today

Everything below is driven from the visual editor; nothing requires code.

- **Editor**: 3D viewport (orbit, pan, zoom, right-drag + WASD fly), asset library with search, scene tree with folders, inspector, toolbar, bottom panel (events, cinematic timeline, performance), tooltips, getting-started guide, keyboard shortcuts.
- **Objects**: drag and drop from the library, move/rotate/scale gizmos, grid and surface snapping, multi-select, duplicate, copy/paste, group/ungroup, lock, hide, undo/redo, reusable prefabs, import of GLB/GLTF, images, audio and video.
- **Terrain**: procedural creation, raise/lower/smooth/flatten brushes, eight paintable materials plus automatic blending by slope and elevation, scatter brushes (forest, meadow, bushes, rocks) with density and randomness, roads, paths and rivers that follow the ground, water.
- **Real-world import**: map search, rectangle selection, resolution choice, elevation in metres at true horizontal scale, vertical exaggeration, tile stitching, missing-data fill, stored attribution, "restore original" after sculpting. Optional roads, rivers, lakes, coastlines and building footprints from OpenStreetMap, all editable afterwards. File import: PNG heightmaps, RAW, SRTM `.hgt`, GeoTIFF/DEM, GeoJSON.
- **Large worlds**: terrain split into chunks, built in the background a few per frame, four detail levels by distance, instanced vegetation, a world panel with chunk status.
- **Buildings**: wall drawing, room tool, floors/ceilings, stairs, doors and windows that cut their own openings in walls, numeric dimensions, building at any storey height, furniture and props for interiors.
- **Screens**: a TV / screen building part that plays any imported image, animated GIF or video (MP4/WebM), with keep-proportions or stretch fit, looping and optional video sound.
- **Working machinery**: hinged, sliding, garage and rotating doors (locked, automatic, sounds); elevators with any number of named floors, call and floor buttons, door sensors, arrival chime; moving platforms and an escalator preset; levers and buttons through events.
- **Player**: first and third person, walk, run, jump, gravity, collision with step-up, head bob, footsteps, interaction prompts, collectibles, journal, checkpoints, touch controls.
- **Information boxes**: title, rich text, image, video, audio, link, colours, fonts, four templates, activation by proximity, key, click, zone or event.
- **Events**: WHEN → IF → THEN rules as visual blocks, with a simple mode for beginners. Ten triggers, variables and conditions, and about twenty actions including waits for sequences, run-once, and enabling or disabling other rules.
- **Cinematics**: timeline with camera keyframes taken from the viewport, easing, field of view, subtitles, title card, fades, letterbox, synchronised audio, preview scrubbing; playable from events, returning control to the player afterwards.
- **Atmosphere**: sun position, colours, ambient light, fog, shadows, rain and snow, exposure, bloom, saturation and contrast, optional day/night cycle, eight presets plus your own saved presets.
- **Audio**: music, ambient and positional 3D sources, looping, fades, distance settings, event-triggered playback.
- **Projects**: new, open, autosave (every 20 s), rename, duplicate, delete, version history with restore, import/export as an archive, ten starter templates plus a **Feature showcase** world that demonstrates every system in one guided tour (it generates its own image, GIF and sounds, so it needs no downloads).
- **Publishing**: validation report (missing spawn, broken references, missing assets, unconfigured interactions, performance warnings), standalone web build, plus exports of the complete project, assets and world data.

## What is a foundation, and what is not there yet

The specification asks for the full engine to be built in phases. These parts are deliberately partial:

| Area | State | Path forward |
| --- | --- | --- |
| Rendering | WebGL2 only | Swap in three.js `WebGPURenderer` (it falls back to WebGL2); the custom sky shader and post chain need node-material ports |
| Player physics | TypeScript, upright box colliders | Move to the Rust core next to terrain; add rotated colliders and ramps |
| Culling | Frustum culling and distance-based terrain streaming | Occlusion culling; streaming of objects and textures by region |
| Web Workers | Not used; heavy work is sliced across frames | Run the WASM core in a worker for chunk meshing and imports |
| Cinematic tracks | Camera, subtitles, title, fades, audio | Object-movement, lighting and environment keyframe tracks |
| Events | Block list editor | Free-form node graph view of the same data |
| Caves | Not possible on a heightfield | Add cave pieces as meshes, or a voxel layer |
| Shapefiles, raw `.osm` | Rejected with a hint to convert to GeoJSON | Add a shapefile reader adapter |
| Satellite imagery | Not included, because imagery licences differ from elevation licences | Provider adapters with per-source attribution; draping a user-supplied orthophoto |
| Asset library | Procedural low-poly primitives | Richer model packs; texture compression (KTX2) and mesh optimisation on import |
| Multi-floor tools | Build each storey with the "build at height" setting | One-click "duplicate floor" |

## Data sources and attribution

- Elevation: Mapzen Terrain Tiles on AWS Open Data (SRTM, GMTED2010, ETOPO1, 3DEP and others). Attribution is required and is stored with the terrain and shown on the start screen of published worlds.
- Map, search and features: OpenStreetMap contributors (ODbL), via the public tile, Nominatim and Overpass services. These are shared community services with usage policies; for heavy use, point the adapters in `src/editor/geo.ts` at your own endpoints.

## Testing notes

`npm test` runs the Rust unit tests. The editor, all templates, play mode, saving and reloading, project export/import, geographic import (with mocked network responses) and published builds were exercised in headless Chrome. The geographic services themselves and real GPUs were not part of that run.
