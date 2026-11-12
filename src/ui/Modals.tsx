import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as store from '../editor/storage';
import { TEMPLATES } from '../editor/templates';
import * as geo from '../editor/geo';
import { exportAssets, exportWorldData, publish, validate, type BuildReport, type Issue } from '../editor/publish';
import { newProject } from '../engine/types';
import { Btn, Check, Modal, Num, Row, Sel, Slider, Txt, fmtBytes, useEd } from './widgets';

// ---------------------------------------------------------------- projects

export function ProjectsModal({ onClose, canClose }: { onClose(): void; canClose: boolean }) {
  const ed = useEd(), [list, setList] = useState<store.ProjectInfo[]>([]), [name, setName] = useState('My world'), [busy, setBusy] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => store.listProjects().then(setList).catch(() => setList([]));
  useEffect(() => { refresh(); }, []);
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try { await fn(); onClose(); } catch (e: any) { ed.toast(e?.message ?? String(e), 'error'); } finally { setBusy(''); }
  };
  const create = (key: string) => run('Building world…', async () => {
    if (ed.dirty) await ed.save().catch(() => {});
    await new Promise((r) => setTimeout(r, 30));
    await ed.load(newProject(name.trim() || 'My world'), new Map());
    const t = TEMPLATES.find((x) => x.key === key)!;
    ed.project.description = key === 'blank' ? '' : t.blurb;
    await t.build(ed);
    ed.select([]);
    ed.viewport?.reset();
    await ed.save('Created from template');
  });
  return (
    <Modal title="WANDER — projects" onClose={canClose ? onClose : undefined} wide>
      {busy && <div className="busy"><i />{busy}</div>}
      <h3>Start a new world</h3>
      <Row label="Project name"><Txt value={name} onChange={setName} /></Row>
      <div className="cards">
        {TEMPLATES.map((t) => <button key={t.key} className="card" onClick={() => create(t.key)}><b>{t.name}</b><span>{t.blurb}</span></button>)}
      </div>
      <h3>Your projects <small>(stored in this browser)</small></h3>
      {!list.length && <p className="hint">No saved projects yet.</p>}
      <div className="projects">
        {list.map((p) => (
          <div key={p.id} className={`proj ${p.id === ed.project.id ? 'cur' : ''}`}>
            <div className="thumb" style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : undefined} onClick={() => run('Opening…', () => ed.open(p.id))} />
            <div className="grow"><b>{p.name}</b><small>{new Date(p.modified).toLocaleString()} · {p.objects} objects</small></div>
            <Btn kind="primary" onClick={() => run('Opening…', async () => { if (ed.dirty) await ed.save().catch(() => {}); await ed.open(p.id); })}>Open</Btn>
            <Btn kind="mini" tip="Rename" onClick={async () => { const n = prompt('Project name', p.name); if (!n) return; if (p.id === ed.project.id) { ed.project.name = n; await ed.save(); } else await store.renameProject(p.id, n); refresh(); }}>✎</Btn>
            <Btn kind="mini" tip="Duplicate" onClick={async () => { await store.duplicateProject(p.id); refresh(); }}>⧉</Btn>
            <Btn kind="mini" tip="Delete" disabled={p.id === ed.project.id} onClick={async () => { if (confirm(`Delete “${p.name}” permanently?`)) { await store.deleteProject(p.id); refresh(); } }}>🗑</Btn>
          </div>
        ))}
      </div>
      <h3>Import</h3>
      <input ref={file} type="file" hidden accept=".zip,.wander,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) run('Importing…', () => ed.importProject(f)); e.target.value = ''; }} />
      <Btn onClick={() => file.current?.click()}>Import a project archive (.wander.zip)…</Btn>
    </Modal>
  );
}

export function VersionsModal({ onClose }: { onClose(): void }) {
  const ed = useEd(), [list, setList] = useState<store.VersionInfo[]>([]);
  useEffect(() => { store.listVersions(ed.project.id).then(setList); }, [ed.project.id]);
  return (
    <Modal title="Version history" onClose={onClose}>
      <p className="hint">A version is stored every time you press Save (the last 15 are kept). Restoring brings back objects, events, cinematics and settings; terrain sculpting is not versioned.</p>
      {!list.length && <p>No versions yet – press Save to create one.</p>}
      {list.map((v) => <div key={v.key} className="proj"><div className="grow"><b>{new Date(v.time).toLocaleString()}</b><small>{v.label}</small></div><Btn onClick={async () => { if (confirm('Restore this version? Unsaved changes will be lost.')) { await ed.restoreVersion(v.key); onClose(); } }}>Restore</Btn></div>)}
    </Modal>
  );
}

// ---------------------------------------------------------------- publish

const ICON = { error: '⛔', warn: '⚠️', tip: '💡' };

export function PublishModal({ onClose }: { onClose(): void }) {
  const ed = useEd(), [issues] = useState<Issue[]>(() => validate(ed)), [rep, setRep] = useState<BuildReport | null>(null), [busy, setBusy] = useState(false), [desc, setDesc] = useState(ed.project.description);
  const errors = issues.filter((i) => i.level === 'error').length;
  const build = async () => {
    setBusy(true);
    try {
      ed.project.description = desc;
      await ed.save();
      const r = await publish(ed);
      setRep(r);
      store.download(r.blob, r.fileName);
    } catch (e: any) { ed.toast(e?.message ?? String(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Publish “${ed.project.name}”`} onClose={onClose} wide>
      <h3>1 · Validation report</h3>
      {!issues.length && <p className="ok">✔ No problems found.</p>}
      <div className="issues">
        {issues.map((i, n) => (
          <div key={n} className={`issue ${i.level}`}>
            <span>{ICON[i.level]}</span><span className="grow"><small>{i.area}</small>{i.text}</span>
            {i.ids?.length ? <Btn kind="mini" tip="Select the affected objects" onClick={() => { ed.select(i.ids!); ed.viewport?.focus(i.ids!); onClose(); }}>Show</Btn> : null}
          </div>
        ))}
      </div>
      <h3>2 · Build</h3>
      <Row label="Title"><Txt value={ed.project.name} onChange={(v) => { ed.project.name = v; ed.touch(); }} /></Row>
      <Row label="Description" tip="Shown on the start screen"><Txt value={desc} onChange={setDesc} /></Row>
      <p className="hint">Creates a standalone website (HTML + WebAssembly + your world) as a zip. Upload its contents to any static host – GitHub Pages, Netlify, your own server. It does not need WANDER to run. The current viewport image becomes the thumbnail and loading background.</p>
      <div className="btns">
        <Btn kind="primary" disabled={busy} onClick={build}>{busy ? 'Building…' : errors ? `Build anyway (${errors} error${errors > 1 ? 's' : ''})` : 'Build standalone website'}</Btn>
        {rep && <Btn onClick={() => store.download(rep.blob, rep.fileName)}>Download again</Btn>}
      </div>
      {rep && (
        <div className="report">
          <p className="ok">✔ Build created: {rep.files.length} files, {fmtBytes(rep.total)} uncompressed, {fmtBytes(rep.blob.size)} zipped.</p>
          <table><tbody>{rep.files.slice(0, 12).map((f) => <tr key={f.name}><td>{f.name}</td><td>{fmtBytes(f.bytes)}</td></tr>)}</tbody></table>
          <p className="hint">Test it locally: unzip, run <code>python3 -m http.server</code> in the folder and open http://localhost:8000 (browsers block WebAssembly from file:// pages).</p>
        </div>
      )}
      <h3>Other exports</h3>
      <div className="btns">
        <Btn tip="Complete editable project – reopen it with Open → Import" onClick={() => ed.exportProject()}>Download complete project</Btn>
        <Btn tip="All imported models, images, audio and video" onClick={async () => { if (!(await exportAssets(ed))) ed.toast('This project has no imported files.'); }}>Export assets</Btn>
        <Btn tip="Scene JSON + terrain heights (float32 and 16-bit RAW)" onClick={() => exportWorldData(ed)}>Export world data</Btn>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- geo wizard

const RES: [string, string][] = [['129', 'Low (129 points)'], ['257', 'Medium (257)'], ['513', 'High (513)'], ['1025', 'Very high (1025)']];

export function GeoWizard({ onClose }: { onClose(): void }) {
  const ed = useEd(), [mode, setMode] = useState<'map' | 'file'>('map');
  const mapEl = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), rect = useRef<L.Rectangle | null>(null), drawing = useRef(false);
  const [q, setQ] = useState(''), [places, setPlaces] = useState<geo.Place[]>([]), [sel, setSel] = useState<geo.BBox | null>(null), [draw, setDraw] = useState(false);
  const [res, setRes] = useState('257'), [exag, setExag] = useState(1), [feat, setFeat] = useState({ roads: true, water: true, buildings: false });
  const [busy, setBusy] = useState(''), [label, setLabel] = useState('Imported place');
  const [raster, setRaster] = useState<geo.Raster | null>(null), [rcell, setRcell] = useState(2), [rscale, setRscale] = useState(120), [gj, setGj] = useState<{ text: string; name: string } | null>(null);
  drawing.current = draw;

  useEffect(() => {
    if (mode !== 'map' || !mapEl.current || map.current) return;
    const g = ed.scene.terrain?.geo;
    const m = L.map(mapEl.current, { zoomControl: true }).setView(g ? [(g.bbox[1] + g.bbox[3]) / 2, (g.bbox[0] + g.bbox[2]) / 2] : [46.56, 8.0], g ? 12 : 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(m);
    let start: L.LatLng | null = null;
    m.on('mousedown', (e) => { if (!drawing.current) return; start = e.latlng; m.dragging.disable(); });
    m.on('mousemove', (e) => {
      if (!start) return;
      const b = L.latLngBounds(start, e.latlng);
      if (rect.current) rect.current.setBounds(b); else rect.current = L.rectangle(b, { color: '#e8a33d', weight: 2 }).addTo(m);
    });
    m.on('mouseup', (e) => {
      if (!start) return;
      const b = L.latLngBounds(start, e.latlng);
      start = null; m.dragging.enable(); setDraw(false);
      if (b.getEast() - b.getWest() > 1e-5 && b.getNorth() - b.getSouth() > 1e-5) setSel([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    });
    map.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); map.current = null; rect.current = null; };
  }, [mode, ed]);

  const plan = sel ? geo.planImport(sel, +res) : null;
  const km2 = plan ? (plan.widthM * plan.heightM) / 1e6 : 0;
  const prov = geo.PROVIDERS[0];

  const search = async () => {
    setBusy('Searching…');
    try { const r = await geo.searchPlace(q); setPlaces(r); if (!r.length) ed.toast('No place found with that name.'); }
    catch (e: any) { ed.toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const goto = (p: geo.Place) => {
    setLabel(p.name.split(',')[0]);
    if (p.bbox) map.current?.fitBounds([[p.bbox[1], p.bbox[0]], [p.bbox[3], p.bbox[2]]], { maxZoom: 14 }); else map.current?.setView([p.lat, p.lon], 13);
  };

  const importMap = async () => {
    if (!plan) return;
    try {
      setBusy('Downloading elevation…');
      const r = await geo.fetchElevation(ed, plan, prov, (d, t) => setBusy(`Downloading elevation tiles ${d}/${t}…`));
      setBusy('Generating terrain…');
      await new Promise((x) => setTimeout(x, 30));
      const mm = geo.installGeoTerrain(ed, plan, r.heights, exag, prov);
      let msg = `Terrain imported: ${(plan.widthM / 1000).toFixed(1)} × ${(plan.heightM / 1000).toFixed(1)} km, ${mm.min.toFixed(0)}–${mm.max.toFixed(0)} m above sea level.`;
      if (r.failedTiles || r.missing) msg += ` ${r.failedTiles} tile(s) failed and ${r.missing} sample(s) had no data – gaps were filled from neighbours.`;
      const wantB = feat.buildings && km2 <= 6, any = (feat.roads || feat.water || wantB) && km2 <= 400;
      if (any) {
        setBusy('Downloading roads, rivers and buildings…');
        try {
          const els = await geo.fetchOSM(plan.bbox, { ...feat, buildings: wantB });
          setBusy('Placing features…');
          await new Promise((x) => setTimeout(x, 30));
          const c = geo.buildFeatures(ed, geo.osmToFeatures(els, plan), label);
          ed.scene.terrain!.geo!.attribution += ` ${geo.OSM_ATTRIBUTION}.`;
          msg += ` Placed ${c.roads} roads/paths, ${c.water} water features, ${c.buildings} buildings.`;
        } catch (e: any) { ed.toast(e.message, 'error'); }
      } else if (feat.roads || feat.water || feat.buildings) msg += ' Map features were skipped because the area is too large.';
      ed.project.description ||= `A recreation of ${label}.`;
      ed.touch();
      ed.toast(msg, 'ok');
      onClose();
    } catch (e: any) { ed.toast(e?.message ?? String(e), 'error'); } finally { setBusy(''); }
  };

  const pickFile = async (f: File) => {
    setBusy('Reading file…'); setRaster(null); setGj(null);
    try {
      const n = f.name.toLowerCase();
      if (/\.(geojson|json)$/.test(n)) setGj({ text: await f.text(), name: f.name.replace(/\.[^.]+$/, '') });
      else if (/\.(tif|tiff)$/.test(n)) setRaster(await geo.rasterFromGeoTiff(f, f.name));
      else if (/\.(raw|r16|hgt|bin)$/.test(n)) setRaster(await geo.rasterFromRaw(f, f.name));
      else if (/\.(png|jpe?g|webp)$/.test(n)) setRaster(await geo.rasterFromImage(f, f.name));
      else if (/\.(shp|dbf|osm|pbf)$/.test(n)) ed.toast('Shapefiles and raw .osm files are not read directly yet. Convert them to GeoJSON (for example with QGIS or mapshaper.org) and import that.', 'error');
      else ed.toast('Unsupported file. Use GeoTIFF, SRTM .hgt, PNG/JPG heightmaps, RAW or GeoJSON.', 'error');
    } catch (e: any) { ed.toast(e?.message ?? String(e), 'error'); } finally { setBusy(''); }
  };

  return (
    <Modal title="Import a real place" onClose={onClose} wide>
      {busy && <div className="busy"><i />{busy}</div>}
      <nav className="tabs inl"><button className={mode === 'map' ? 'on' : ''} onClick={() => setMode('map')}>Search the map</button><button className={mode === 'file' ? 'on' : ''} onClick={() => setMode('file')}>Use my own data file</button></nav>
      {mode === 'map' ? (
        <div className="geo">
          <div className="geo-side">
            <b>1 · Find a location</b>
            <form className="row3" onSubmit={(e) => { e.preventDefault(); if (q.trim()) search(); }}><Txt value={q} onChange={setQ} placeholder="e.g. Matterhorn, Byblos, Yosemite Valley" /><Btn kind="primary">Search</Btn></form>
            <div className="list">{places.map((p, i) => <div key={i} className="asset link" onClick={() => goto(p)}>{p.name}</div>)}</div>
            <b>2 · Select the area</b>
            <Btn active={draw} onClick={() => setDraw(!draw)} tip="Then drag a rectangle on the map">{draw ? 'Drag a rectangle on the map…' : sel ? '▭ Redraw area' : '▭ Draw area'}</Btn>
            {plan && <p className="hint">Area {(plan.widthM / 1000).toFixed(2)} × {(plan.heightM / 1000).toFixed(2)} km · grid {plan.w}×{plan.h} · one height sample every {plan.cell.toFixed(1)} m · source zoom {plan.zoom} ({plan.tiles} tiles)</p>}
            <b>3 · Options</b>
            <Row label="Terrain resolution"><Sel value={res} onChange={setRes} options={RES} /></Row>
            <Row label="Vertical exaggeration" tip="1 = true scale. Can be changed later."><Slider value={exag} min={0.5} max={4} step={0.1} onChange={setExag} /></Row>
            <Row label="World name"><Txt value={label} onChange={setLabel} /></Row>
            <div className="row"><Check value={feat.roads} onChange={(v) => setFeat({ ...feat, roads: v })} label="Roads and paths" /><Check value={feat.water} onChange={(v) => setFeat({ ...feat, water: v })} label="Rivers, lakes, coast" /></div>
            <div className="row"><Check value={feat.buildings} onChange={(v) => setFeat({ ...feat, buildings: v })} label="Building footprints" /></div>
            {plan && feat.buildings && km2 > 6 && <p className="hint warn">Buildings are only imported for areas up to 6 km² (this one is {km2.toFixed(0)} km²).</p>}
            {plan && km2 > 400 && <p className="hint warn">Area is larger than 400 km²: only terrain will be imported.</p>}
            <Btn kind="primary" disabled={!plan || !!busy} onClick={importMap}>4 · Generate 3D world</Btn>
            {ed.scene.terrain && <p className="hint warn">This replaces the current terrain. Objects stay where they are.</p>}
            <p className="hint">{prov.attribution} {prov.license}. Map and features: {geo.OSM_ATTRIBUTION}. Elevation and map data have different licences; attribution is stored with the terrain and shown on the start screen of published worlds.</p>
          </div>
          <div className={`geo-map ${draw ? 'drawing' : ''}`}><div className="geo-map-inner" ref={mapEl} /></div>
        </div>
      ) : (
        <div className="geo-file">
          <p>Supported: <b>GeoTIFF</b> DEMs (WGS84 or metric projections), <b>SRTM .hgt</b>, <b>PNG/JPG</b> heightmaps, square <b>RAW</b> (8/16-bit), and <b>GeoJSON</b> vector data (roads, rivers, building footprints).</p>
          <input type="file" accept=".tif,.tiff,.hgt,.raw,.r16,.bin,.png,.jpg,.jpeg,.webp,.geojson,.json,.shp" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
          {raster && (
            <>
              <p className="hint">{raster.source}: {raster.w} × {raster.h} samples{raster.cellX ? `, ${raster.cellX.toFixed(1)} × ${raster.cellY!.toFixed(1)} m per sample` : ''}{raster.bbox ? ', georeferenced' : ''}. {raster.note}</p>
              <Row label="Terrain resolution"><Sel value={res} onChange={setRes} options={RES} /></Row>
              {!raster.cellX && <Row label="Metres per sample" tip="Horizontal distance between heightmap pixels"><Num value={rcell} min={0.1} onChange={setRcell} /></Row>}
              {raster.normalized && <Row label="Height of white (m)" tip="Black = 0 m, white = this height"><Num value={rscale} min={1} step={5} onChange={setRscale} /></Row>}
              <Row label="Vertical exaggeration"><Slider value={exag} min={0.5} max={4} step={0.1} onChange={setExag} /></Row>
              <Btn kind="primary" onClick={() => {
                try {
                  const r = geo.installRaster(ed, raster, { maxSamples: +res, cell: rcell, heightScale: rscale, exag });
                  ed.toast(`Terrain created: ${r.w}×${r.h} samples, ${r.cell.toFixed(1)} m cells, relief ${(r.max - r.min).toFixed(0)} m.${r.missing ? ` ${r.missing} missing samples were filled.` : ''}`, 'ok');
                  onClose();
                } catch (e: any) { ed.toast(e?.message ?? String(e), 'error'); }
              }}>Create terrain from this file</Btn>
            </>
          )}
          {gj && (
            <>
              <p className="hint">GeoJSON “{gj.name}”. Lines become roads/paths (or rivers if tagged <code>waterway</code>), polygons become buildings (or lakes). {ed.scene.terrain?.geo ? 'Features will be aligned to the imported terrain.' : 'No georeferenced terrain is loaded, so features are centred on the world origin.'}</p>
              <Btn kind="primary" onClick={() => { try { const c = geo.importGeoJSON(ed, gj.text, gj.name); ed.toast(`Placed ${c.roads} roads, ${c.water} water features, ${c.buildings} buildings (${c.skipped} skipped).`, 'ok'); onClose(); } catch (e: any) { ed.toast(e?.message ?? String(e), 'error'); } }}>Add features to the world</Btn>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- help

const STEPS: [string, string][] = [
  ['Move around', 'Drag with the left mouse button to orbit, scroll to zoom, middle-drag to pan. Hold the right button and use W A S D (Q/E down/up) to fly like in first person.'],
  ['Add things', 'Open Library on the left and drag anything into the world. Double-click an item to drop it in front of the camera.'],
  ['Arrange', 'Click an object, then use Move (W), Rotate (E) or Scale (R). The Inspector on the right has exact numbers. Ctrl+D duplicates, Del removes, Ctrl+Z undoes.'],
  ['Shape the land', 'World tab → create a terrain or import a real place, then sculpt, paint and scatter forests with brushes.'],
  ['Build', 'World tab → Draw room. Drag doors and windows from Library → Building parts onto walls. Add stairs or an elevator for more storeys.'],
  ['Make it interactive', 'Drop Info points and Trigger zones, then open Events at the bottom: WHEN the player enters a zone → THEN play audio, open a door, start a cinematic…'],
  ['Try it', 'Press ▶ Play. You walk from the Player spawn. Esc pauses.'],
  ['Publish', 'Press Publish for a validation report and a standalone website you can host anywhere.'],
];
const KEYS: [string, string][] = [['Q / W / E / R', 'Select / Move / Rotate / Scale'], ['F', 'Focus selection'], ['Del', 'Delete'], ['Ctrl+D', 'Duplicate'], ['Ctrl+C / Ctrl+V', 'Copy / paste'], ['Ctrl+G', 'Group'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+S', 'Save (and store a version)'], ['Shift+click', 'Add to selection'], ['Enter / Esc', 'Finish / cancel wall or road'], ['Right mouse + WASD', 'Fly'], ['F5 or ▶', 'Play']];

export function HelpModal({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Getting started" onClose={onClose} wide>
      <ol className="steps">{STEPS.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ol>
      <h3>Keyboard shortcuts</h3>
      <div className="keys">{KEYS.map(([k, d]) => <div key={k}><kbd>{k}</kbd><span>{d}</span></div>)}</div>
      <p className="hint">Hover any button or label for a tooltip. Projects are saved automatically in this browser; use Publish → “Download complete project” for a backup file.</p>
    </Modal>
  );
}
