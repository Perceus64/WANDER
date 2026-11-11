import { useEffect, useRef, useState } from 'react';
import { PREFABS, PREFAB_CATEGORIES } from '../engine/prefabs';
import { prefabThumb, warmThumbs } from '../editor/thumbs';
import { CHUNK } from '../engine/terrain';
import type { Obj } from '../engine/types';
import type { DropPayload, Editor, Tool } from '../editor/editor';
import { Btn, Check, Color, Num, Row, Section, Sel, Slider, Txt, fmtBytes, useEd } from './widgets';

const BASICS: { label: string; icon: string; d: DropPayload; tip: string }[] = [
  { label: 'Player spawn', icon: '🧍', d: { type: 'kind', key: 'spawn', name: 'Player spawn' }, tip: 'Where the visitor starts' },
  { label: 'Info point', icon: 'ℹ️', d: { type: 'kind', key: 'info', name: 'Info point' }, tip: 'Information box shown to the player' },
  { label: 'Trigger zone', icon: '⬚', d: { type: 'kind', key: 'trigger', name: 'Trigger zone' }, tip: 'Invisible area that starts events' },
  { label: 'Audio source', icon: '🔊', d: { type: 'kind', key: 'audio', name: 'Audio source' }, tip: 'Music, ambience or a voice recording' },
  { label: 'Point light', icon: '💡', d: { type: 'kind', key: 'light', name: 'Point light' }, tip: 'Light shining in all directions' },
  { label: 'Spotlight', icon: '🔦', d: { type: 'kind', key: 'light', name: 'Spotlight', props: { type: 'spot', intensity: 60 } }, tip: 'Cone of light pointing down; rotate to aim' },
  { label: 'Text sign', icon: '🔤', d: { type: 'kind', key: 'text', name: 'Sign' }, tip: 'Flat panel with text' },
  { label: 'Water', icon: '🌊', d: { type: 'kind', key: 'water', name: 'Water' }, tip: 'Lake / pond surface' },
  { label: 'Box', icon: '◼', d: { type: 'kind', key: 'primitive', name: 'Box', props: { shape: 'box' } }, tip: 'Basic shape' },
  { label: 'Sphere', icon: '●', d: { type: 'kind', key: 'primitive', name: 'Sphere', props: { shape: 'sphere' } }, tip: 'Basic shape' },
  { label: 'Cylinder', icon: '⬭', d: { type: 'kind', key: 'primitive', name: 'Cylinder', props: { shape: 'cylinder' } }, tip: 'Basic shape' },
  { label: 'Cone', icon: '▲', d: { type: 'kind', key: 'primitive', name: 'Cone', props: { shape: 'cone' } }, tip: 'Basic shape' },
  { label: 'Plane', icon: '▭', d: { type: 'kind', key: 'primitive', name: 'Plane', props: { shape: 'plane' } }, tip: 'Flat panel' },
];
const BUILDING: typeof BASICS = [
  { label: 'Wall', icon: '🧱', d: { type: 'kind', key: 'wall', name: 'Wall' }, tip: 'Single wall. Use the Wall tool (World tab) to draw runs of walls' },
  { label: 'Floor / ceiling', icon: '▬', d: { type: 'kind', key: 'floor', name: 'Floor' }, tip: 'Slab – also used for ceilings and roofs' },
  { label: 'Door', icon: '🚪', d: { type: 'kind', key: 'door', name: 'Door' }, tip: 'Drop on a wall to cut a doorway' },
  { label: 'Sliding door', icon: '⇔', d: { type: 'kind', key: 'door', name: 'Sliding door', props: { style: 'sliding', auto: true } }, tip: 'Automatic sliding door' },
  { label: 'Garage door', icon: '⬆', d: { type: 'kind', key: 'door', name: 'Garage door', props: { style: 'garage', width: 2.6, height: 2.3, color: '#b9bec4' } }, tip: 'Lifts upwards' },
  { label: 'Window', icon: '🪟', d: { type: 'kind', key: 'window', name: 'Window' }, tip: 'Drop on a wall to cut a window' },
  { label: 'TV / screen', icon: '📺', d: { type: 'kind', key: 'screen', name: 'Screen' }, tip: 'Plays an imported image, animated GIF or video. Drop it, then choose the file in the Inspector.' },
  { label: 'Stairs', icon: '🪜', d: { type: 'kind', key: 'stairs', name: 'Stairs' }, tip: 'Walkable staircase' },
  { label: 'Elevator', icon: '🛗', d: { type: 'kind', key: 'elevator', name: 'Elevator' }, tip: 'Working elevator with floor buttons' },
  { label: 'Moving platform', icon: '⇅', d: { type: 'kind', key: 'platform', name: 'Moving platform' }, tip: 'Platform that travels between two points' },
  { label: 'Escalator', icon: '⇗', d: { type: 'kind', key: 'platform', name: 'Escalator', props: { size: [1.2, 0.2, 1.4], offset: [0, 3.2, -5.5], speed: 1.1, pause: 1.2, mode: 'loop', color: '#5f6770' } }, tip: 'Inclined mover that carries visitors between two storeys' },
];

function Item({ label, icon, d, tip, ed, img }: { label: string; icon: string; d: DropPayload; tip?: string; ed: Editor; img?: string }) {
  return (
    <div className="item" draggable title={`${tip ? tip + ' — ' : ''}drag into the world, or double-click to add`}
      onDragStart={(e) => { e.dataTransfer.setData('application/wander', JSON.stringify(d)); e.dataTransfer.effectAllowed = 'copy'; }}
      onDoubleClick={() => { const r = ed.viewport?.renderer.domElement.getBoundingClientRect(); if (r) ed.dropAsset(d, r.left + r.width / 2, r.top + r.height * 0.6); }}>
      {img ? <img className="thumb" src={img} alt="" draggable={false} /> : <span className="ico">{icon}</span>}<span>{label}</span>
    </div>
  );
}

const CAT_ICON: Record<string, string> = { Office: '💼', Computers: '🖥', Trees: '🌲', Plants: '🌿', Rocks: '🪨', Houses: '🏠', Buildings: '🏢', Furniture: '🪑', Vehicles: '🚗', Signs: '🪧', 'Street furniture': '🏮', 'Museum objects': '🏺', 'Interior decorations': '🖼', 'Industrial equipment': '⚙️', Lighting: '💡', 'Architectural components': '🏛' };

function Library() {
  const ed = useEd(), [q, setQ] = useState(''), file = useRef<HTMLInputElement>(null);
  const s = q.trim().toLowerCase(), match = (t: string) => !s || t.toLowerCase().includes(s);
  const assets = Object.values(ed.scene.assets);
  const [, setThumbs] = useState(0);
  useEffect(() => warmThumbs(PREFABS.map((p) => p.key), () => setThumbs((n) => n + 1)), []);
  return (
    <>
      <div className="search"><input className="in" placeholder="Search assets…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search assets" /></div>
      <div className="scroll">
        <Section title="Essentials"><div className="grid">{BASICS.filter((b) => match(b.label)).map((b) => <Item key={b.label} {...b} ed={ed} />)}</div></Section>
        <Section title="Building parts"><div className="grid">{BUILDING.filter((b) => match(b.label)).map((b) => <Item key={b.label} {...b} ed={ed} />)}</div></Section>
        {PREFAB_CATEGORIES.map((cat) => {
          const list = PREFABS.filter((p) => p.cat === cat && (match(p.name) || match(cat)));
          return list.length ? <Section key={cat} title={cat} open={!!s || cat === 'Trees'}><div className="grid tiles">{list.map((p) => <Item key={p.key} label={p.name} icon={CAT_ICON[cat] ?? '◆'} img={prefabThumb(p.key)} d={{ type: 'prefab', key: p.key }} ed={ed} />)}</div></Section> : null;
        })}
        <Section title="My files" extra={<span className="count">{assets.length}</span>}>
          <input ref={file} type="file" multiple hidden accept=".glb,.gltf,.obj,.mtl,.fbx,.stl,.ply,.dae,.bin,.zip,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.ogg,.m4a,.flac,.mp4,.webm" onChange={(e) => { if (e.target.files) ed.importFiles(e.target.files); e.target.value = ''; }} />
          <Btn onClick={() => file.current?.click()} tip="3D models: GLB, GLTF, OBJ, FBX, STL, PLY, DAE – select a model together with its textures/.bin/.mtl, or a zip of them. Also images, GIFs, audio and video. You can drop files anywhere on the window.">Import models and media…</Btn>
          <div className="list">
            {assets.filter((a) => match(a.name)).map((a) => (
              <div key={a.id} className="asset" draggable onDragStart={(e) => e.dataTransfer.setData('application/wander', JSON.stringify({ type: 'asset', key: a.id }))} title="Drag into the world">
                {a.meta?.thumb ? <img className="thumb" src={a.meta.thumb} alt="" draggable={false} /> : <span className="ico">{{ model: '📦', image: '🖼', audio: '🎵', video: '🎬' }[a.type]}</span>}
                <span className="grow">{a.name}<small>{a.meta ? `${a.meta.tris.toLocaleString()} tris` : a.type} · {fmtBytes(a.size)} · used {ed.assetUsage(a.id)}×</small></span>
                <button className="btn mini" title="Remove file from project" onClick={() => (ed.assetUsage(a.id) === 0 || confirm(`“${a.name}” is used by ${ed.assetUsage(a.id)} object(s). Remove anyway?`)) && ed.removeAsset(a.id)}>✕</button>
              </div>
            ))}
          </div>
        </Section>
        <Section title="My prefabs" extra={<span className="count">{ed.project.prefabs.length}</span>}>
          {!ed.project.prefabs.length && <p className="hint">Select an object or group and choose “Save as prefab” in the Scene tab to reuse it.</p>}
          <div className="list">
            {ed.project.prefabs.filter((p) => match(p.name)).map((p) => (
              <div key={p.id} className="asset" draggable onDragStart={(e) => e.dataTransfer.setData('application/wander', JSON.stringify({ type: 'userPrefab', key: p.id }))}>
                <span className="ico">🧩</span><span className="grow">{p.name}<small>{Object.keys(p.objects).length} object(s)</small></span>
                <button className="btn mini" title="Delete prefab" onClick={() => { ed.project.prefabs = ed.project.prefabs.filter((x) => x.id !== p.id); ed.touch(); }}>✕</button>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}

const KIND_ICON: Record<string, string> = { group: '📁', primitive: '◼', prefab: '◆', model: '📦', text: '🔤', light: '💡', audio: '🔊', spawn: '🧍', info: 'ℹ️', trigger: '⬚', wall: '🧱', floor: '▬', door: '🚪', window: '🪟', stairs: '🪜', elevator: '🛗', platform: '⇅', road: '🛣', poly: '⬠', scatter: '🌲', water: '🌊' };

function Node({ o, depth, ed, closed, toggle }: { o: Obj; depth: number; ed: Editor; closed: Set<string>; toggle(id: string): void }) {
  const [edit, setEdit] = useState(false), [over, setOver] = useState(false);
  const sel = ed.selection.includes(o.id), open = !closed.has(o.id);
  return (
    <>
      <div className={`node ${sel ? 'sel' : ''} ${over ? 'over' : ''} ${o.visible ? '' : 'dim'}`} style={{ paddingLeft: 6 + depth * 14 }} draggable
        onDragStart={(e) => { e.dataTransfer.setData('application/wander-node', o.id); e.stopPropagation(); }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('application/wander-node')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { setOver(false); const id = e.dataTransfer.getData('application/wander-node'); if (id) { e.preventDefault(); e.stopPropagation(); ed.reparent(id, o.id); } }}
        onClick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey ? ed.toggleSelect(o.id) : ed.select([o.id]))}
        onDoubleClick={() => ed.viewport?.focus([o.id])}>
        <span className="tw" onClick={(e) => { e.stopPropagation(); toggle(o.id); }}>{o.children.length ? (open ? '▾' : '▸') : ''}</span>
        <span className="ico">{KIND_ICON[o.kind]}</span>
        {edit ? <input className="in" autoFocus defaultValue={o.name} onBlur={(e) => { ed.setField(o.id, 'name', e.target.value || o.name); setEdit(false); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} onClick={(e) => e.stopPropagation()} />
          : <span className="grow name" title="Double-click to focus · F2 or ✎ to rename">{o.name}</span>}
        <button className="tiny" title="Rename" onClick={(e) => { e.stopPropagation(); setEdit(true); }}>✎</button>
        <button className="tiny" title={o.locked ? 'Unlock' : 'Lock (cannot be selected in the viewport)'} onClick={(e) => { e.stopPropagation(); ed.setField(o.id, 'locked', !o.locked); }}>{o.locked ? '🔒' : '🔓'}</button>
        <button className="tiny" title={o.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); ed.setField(o.id, 'visible', !o.visible); }}>{o.visible ? '👁' : '–'}</button>
      </div>
      {open && o.children.map((c) => { const k = ed.obj(c); return k ? <Node key={c} o={k} depth={depth + 1} ed={ed} closed={closed} toggle={toggle} /> : null; })}
    </>
  );
}

function SceneTree() {
  const ed = useEd(), [closed, setClosed] = useState(() => new Set<string>()), [q, setQ] = useState('');
  const toggle = (id: string) => setClosed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const has = ed.selection.length > 0, first = ed.obj(ed.selection[0]);
  const count = Object.keys(ed.scene.objects).length, s = q.trim().toLowerCase();
  const flat = s ? Object.values(ed.scene.objects).filter((o) => o.name.toLowerCase().includes(s)).slice(0, 200) : null;
  // Large imports (hundreds of roads/buildings) start collapsed so the list stays usable.
  useEffect(() => { setClosed((c) => { const n = new Set(c); for (const o of Object.values(ed.scene.objects)) if (o.children.length > 40 && !c.has('seen' + o.id)) { n.add(o.id); n.add('seen' + o.id); } return n.size === c.size ? c : n; }); }, [count]);
  return (
    <>
      <div className="bar">
        <Btn kind="mini" tip="New folder" onClick={() => ed.create('group', 'Folder', { folder: true })}>📁+</Btn>
        <Btn kind="mini" tip="Group selection (Ctrl+G)" disabled={!has} onClick={() => ed.group()}>Group</Btn>
        <Btn kind="mini" tip="Ungroup" disabled={first?.kind !== 'group'} onClick={() => ed.ungroup()}>Ungroup</Btn>
        <Btn kind="mini" tip="Duplicate (Ctrl+D)" disabled={!has} onClick={() => ed.duplicate()}>⧉</Btn>
        <Btn kind="mini" tip="Delete (Del)" disabled={!has} onClick={() => ed.remove()}>🗑</Btn>
        <Btn kind="mini" tip="Save selection as a reusable prefab" disabled={!has} onClick={() => { const n = prompt('Prefab name', first?.name); if (n) ed.saveAsPrefab(n); }}>🧩</Btn>
      </div>
      <div className="search"><input className="in" placeholder={`Filter ${count} objects…`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="scroll tree" onDragOver={(e) => e.dataTransfer.types.includes('application/wander-node') && e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData('application/wander-node'); if (id) ed.reparent(id, null); }}>
        {flat ? flat.map((o) => <Node key={o.id} o={{ ...o, children: [] }} depth={0} ed={ed} closed={closed} toggle={toggle} />)
          : ed.scene.roots.map((id) => { const o = ed.obj(id); return o ? <Node key={id} o={o} depth={0} ed={ed} closed={closed} toggle={toggle} /> : null; })}
        {!count && <div className="empty">The world is empty.<br />Drag something in from the Library tab.</div>}
        <div className="dropzone">Drop here to move to the top level</div>
      </div>
    </>
  );
}

function WorldMap() {
  const ed = useEd(), ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const c = ref.current, t = ed.terrain, vp = ed.viewport;
      if (!c || !t || !vp) return;
      const g = c.getContext('2d')!, S = c.width, n = Math.max(t.nx, t.nz), cs = S / n;
      g.fillStyle = '#14171c'; g.fillRect(0, 0, S, S);
      for (const ch of t.chunks) {
        g.fillStyle = !ch.mesh ? '#232830' : ch.dirty ? '#b5483c' : ['', '#e8a33d', '#b98a3c', '', '#7d683f', '', '', '', '#4d4a3f'][ch.lod] || '#4d4a3f';
        g.fillRect(ch.ci * cs + 0.5, ch.cj * cs + 0.5, Math.max(1, cs - 1), Math.max(1, cs - 1));
      }
      g.strokeStyle = '#6d7e91'; g.strokeRect(0.5, 0.5, t.nx * cs - 1, t.nz * cs - 1);
      const cw = CHUNK * t.meta.cell, p = vp.camera.position;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(((p.x + t.width / 2) / cw) * cs, ((p.z + t.depth / 2) / cw) * cs, 3.5, 0, 7); g.fill();
    };
    draw();
    const i = setInterval(draw, 400);
    return () => clearInterval(i);
  }, [ed, ed.terrain]);
  const t = ed.terrain;
  if (!t) return null;
  return (
    <Section title="World management">
      <canvas ref={ref} width={236} height={236} className="worldmap" title="Terrain tiles. Bright = loaded at full detail, darker = lower detail, grey = not loaded. White dot = camera." />
      <p className="hint">{t.stats.total} terrain tiles ({t.nx}×{t.nz}), {t.stats.active} loaded around the camera. World bounds {(t.width / 1000).toFixed(2)} × {(t.depth / 1000).toFixed(2)} km.</p>
      <Row label="View distance (m)" tip="Tiles beyond this distance are unloaded"><Num value={t.meta.viewDistance} step={100} min={200} max={12000} onChange={(v) => { t.meta.viewDistance = v; ed.touch(); }} /></Row>
    </Section>
  );
}

const TOOLBTN = (ed: Editor, tool: Tool, label: string, tip: string, also?: () => void) =>
  <Btn key={label} active={ed.tool === tool} tip={tip} onClick={() => { also?.(); ed.setTool(ed.tool === tool && !also ? 'select' : tool); ed.emit(); }}>{label}</Btn>;

function World({ openGeo }: { openGeo(): void }) {
  const ed = useEd(), t = ed.terrain, o = ed.opts;
  const [nt, setNt] = useState({ size: 257, cell: 2, amplitude: 40, seed: 7, flat: false });
  const [auto, setAuto] = useState({ rock: 34, snow: 0.8, sand: 0.02 });
  const upd = () => ed.emit();
  const mm = t?.minMax() ?? [0, 0];
  return (
    <div className="scroll">
      <Section title="Terrain">
        {!t ? (
          <>
            <p className="hint">Create a landscape to sculpt, or import a real place.</p>
            <Row label="Size" tip="Grid points per side"><Sel value={String(nt.size)} onChange={(v) => setNt({ ...nt, size: +v })} options={[['65', 'Small garden (65)'], ['129', 'Park (129)'], ['257', 'Valley (257)'], ['513', 'Region (513)'], ['1025', 'Large region (1025)']]} /></Row>
            <Row label="Cell size (m)" tip="Distance between grid points"><Num value={nt.cell} min={0.25} max={60} onChange={(v) => setNt({ ...nt, cell: v })} /></Row>
            <p className="hint">World size: {(((nt.size - 1) * nt.cell) / 1000).toFixed(2)} × {(((nt.size - 1) * nt.cell) / 1000).toFixed(2)} km</p>
            <div className="row"><Check value={nt.flat} onChange={(v) => setNt({ ...nt, flat: v })} label="Start flat" /></div>
            {!nt.flat && <><Row label="Hill height (m)"><Num value={nt.amplitude} step={5} min={1} onChange={(v) => setNt({ ...nt, amplitude: v })} /></Row><Row label="Variation"><Num value={nt.seed} step={1} onChange={(v) => setNt({ ...nt, seed: v })} /></Row></>}
            <div className="btns"><Btn kind="primary" onClick={() => ed.createTerrain({ ...nt, frequency: 1.6 / ((nt.size - 1) * nt.cell) * 2 })}>Create terrain</Btn><Btn onClick={openGeo} tip="Search a real location and import its elevation, roads and rivers">🌍 Import real place…</Btn></div>
          </>
        ) : (
          <>
            <p className="hint">{t.meta.w}×{t.meta.h} samples · {t.meta.cell.toFixed(2)} m cells · height {mm[0].toFixed(0)}…{mm[1].toFixed(0)} m</p>
            <div className="btns">{TOOLBTN(ed, 'sculpt', '⛰ Sculpt', 'Drag on the terrain. Shift inverts raise/lower. Alt+drag orbits.')}{TOOLBTN(ed, 'paint', '🖌 Paint', 'Paint terrain materials')}</div>
            {ed.tool === 'sculpt' && <div className="chips">{['Raise', 'Lower', 'Smooth', 'Flatten'].map((m, i) => <Btn key={m} kind="chip" active={o.brush.mode === i} tip={['Mountains, hills, cliffs', 'Valleys, riverbeds, lakes, ponds', 'Soften slopes, make beaches', 'Level to the height where you start dragging'][i]} onClick={() => { o.brush.mode = i; upd(); }}>{m}</Btn>)}</div>}
            {ed.tool === 'paint' && (
              <div className="layers">
                {t.meta.layers.map((l, i) => (
                  <div key={i} className={`layer ${o.brush.layer === i ? 'on' : ''}`} onClick={() => { o.brush.layer = i; upd(); }}>
                    <input type="color" value={l.color} title="Change material colour" onChange={(e) => { l.color = e.target.value; t.setPalette(); ed.touch(); }} onClick={(e) => e.stopPropagation()} />
                    <input className="in" value={l.name} onChange={(e) => { l.name = e.target.value; ed.touch(); }} />
                  </div>
                ))}
              </div>
            )}
            {(ed.tool === 'sculpt' || ed.tool === 'paint' || ed.tool === 'scatter') && <>
              <Row label="Brush radius (m)"><Slider value={o.brush.radius} min={1} max={Math.max(60, t.width / 8)} step={0.5} onChange={(v) => { o.brush.radius = v; upd(); }} /></Row>
              {ed.tool !== 'scatter' && <Row label="Strength"><Slider value={o.brush.strength} min={0.02} max={1} onChange={(v) => { o.brush.strength = v; upd(); }} /></Row>}
            </>}
            <Section title="Automatic material blending" open={false}>
              <Row label="Rock on slopes over °"><Slider value={auto.rock} min={5} max={80} step={1} onChange={(v) => setAuto({ ...auto, rock: v })} /></Row>
              <Row label="Snow above"><Slider value={auto.snow} min={0} max={1.2} onChange={(v) => setAuto({ ...auto, snow: v })} /></Row>
              <Row label="Sand below"><Slider value={auto.sand} min={-0.1} max={1} onChange={(v) => setAuto({ ...auto, sand: v })} /></Row>
              <Btn tip="Replaces the painted materials using slope and elevation" onClick={() => { t.autoPaint(auto.rock, mm[0] + (mm[1] - mm[0]) * auto.snow, mm[0] + (mm[1] - mm[0]) * auto.sand); ed.terrainChanged(); }}>Apply blending</Btn>
            </Section>
            <Section title="Terrain settings" open={false}>
              <Row label="Vertical exaggeration" tip="1 = true scale"><Slider value={t.meta.exaggeration} min={0.25} max={5} step={0.05} onChange={(v) => { t.setExaggeration(v); ed.terrainChanged(false); }} /></Row>
              {t.meta.geo && <p className="hint">Real-world terrain: lowest point is {t.meta.geo.minElevation.toFixed(0)} m, highest {t.meta.geo.maxElevation.toFixed(0)} m above sea level.<br />{t.meta.geo.attribution}</p>}
              <div className="btns">
                <Btn disabled={!t.meta.hasOriginal} tip="Undo all sculpting and return to the imported elevation" onClick={() => confirm('Restore the original imported terrain? Sculpting will be lost.') && t.restoreOriginal() && ed.terrainChanged()}>Restore original</Btn>
                <Btn onClick={openGeo}>Replace…</Btn>
                <Btn kind="danger" onClick={() => confirm('Remove the terrain?') && ed.removeTerrain()}>Remove</Btn>
              </div>
            </Section>
          </>
        )}
      </Section>
      <Section title="Vegetation and scatter">
        <Row label="Paint with"><Sel value={o.scatter.prefab} onChange={(v) => { o.scatter.prefab = v; upd(); }} options={PREFABS.filter((p) => ['Trees', 'Plants', 'Rocks'].includes(p.cat)).map((p) => [p.key, `${p.cat} – ${p.name}`] as const)} /></Row>
        <div className="chips">{([['Forest', 'tree_pine', 0.35, 0.7, 0.8, 1.6], ['Meadow', 'grass_tuft', 0.9, 0.8, 0.7, 1.5], ['Bushes', 'bush', 0.3, 0.6, 0.7, 1.4], ['Rock field', 'rock', 0.2, 1, 0.5, 2.4]] as const).map(([n, k, d, r, a, b]) => <Btn key={n} kind="chip" tip="Vegetation preset" onClick={() => { Object.assign(o.scatter, { prefab: k, density: d, random: r, minScale: a, maxScale: b }); ed.setTool('scatter'); }}>{n}</Btn>)}</div>
        <Row label="Density"><Slider value={o.scatter.density} min={0.02} max={1} onChange={(v) => { o.scatter.density = v; upd(); }} /></Row>
        <Row label="Randomness"><Slider value={o.scatter.random} min={0} max={1} onChange={(v) => { o.scatter.random = v; upd(); }} /></Row>
        <Row label="Size range"><span className="vec"><Num value={o.scatter.minScale} min={0.1} onChange={(v) => { o.scatter.minScale = v; upd(); }} /><Num value={o.scatter.maxScale} min={0.1} onChange={(v) => { o.scatter.maxScale = v; upd(); }} /></span></Row>
        <div className="btns">{TOOLBTN(ed, 'scatter', '🌲 Scatter brush', 'Drag to paint. Shift+drag erases. Uses the brush radius.')}</div>
        {ed.tool === 'scatter' && !t && <Row label="Brush radius (m)"><Slider value={o.brush.radius} min={1} max={60} step={0.5} onChange={(v) => { o.brush.radius = v; upd(); }} /></Row>}
      </Section>
      <Section title="Roads and paths">
        <div className="chips">{([['Road', 6, 'road'], ['Path', 2, 'road'], ['River', 8, 'river']] as const).map(([n, w, k]) => <Btn key={n} kind="chip" active={ed.tool === 'road' && o.road.kindOf === k && o.road.width === w} onClick={() => { Object.assign(o.road, { width: w, kindOf: k, color: n === 'Path' ? '#8a7558' : '#3c3d40' }); ed.setTool('road'); }}>{n}</Btn>)}</div>
        <Row label="Width (m)"><Num value={o.road.width} min={0.5} onChange={(v) => { o.road.width = v; upd(); }} /></Row>
        <div className="row"><Check value={o.road.sidewalks} onChange={(v) => { o.road.sidewalks = v; upd(); }} label="Sidewalks" /></div>
        {ed.tool === 'road' && <p className="hint">Click to add points (curves are smoothed). Double-click or Enter to finish, Esc to cancel. Overlap two roads to make an intersection.</p>}
      </Section>
      <Section title="Building tools">
        <div className="btns">{TOOLBTN(ed, 'wall', '🧱 Draw walls', 'Click corner to corner. Double-click or Enter to finish.')}{TOOLBTN(ed, 'room', '⬜ Draw room', 'Drag a rectangle: four walls, floor and ceiling')}</div>
        <Row label="Wall height (m)"><Num value={o.build.height} min={0.5} onChange={(v) => { o.build.height = v; upd(); }} /></Row>
        <Row label="Wall thickness (m)"><Num value={o.build.thickness} min={0.05} step={0.05} onChange={(v) => { o.build.thickness = v; upd(); }} /></Row>
        <Row label="Build at height (m)" tip="0 = on the ground. Set to an upper floor level to draw there."><Num value={o.build.level} step={0.1} onChange={(v) => { o.build.level = v; upd(); }} /></Row>
        <Row label="Wall colour"><Color value={o.build.color} onChange={(v) => { o.build.color = v; upd(); }} /></Row>
        <div className="row"><Check value={o.build.ceiling} onChange={(v) => { o.build.ceiling = v; upd(); }} label="Rooms get a ceiling" /></div>
        <p className="hint">Doors, windows, stairs and elevators are in Library → Building parts. Turn on Snap in the toolbar for aligned walls.</p>
      </Section>
      <WorldMap />
    </div>
  );
}

export function Left({ openGeo }: { openGeo(): void }) {
  const [tab, setTab] = useState<'lib' | 'scene' | 'world'>('lib');
  return (
    <aside className="panel left">
      <nav className="tabs">{([['lib', 'Library'], ['scene', 'Scene'], ['world', 'World']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {tab === 'lib' ? <Library /> : tab === 'scene' ? <SceneTree /> : <World openGeo={openGeo} />}
    </aside>
  );
}
export { Txt };
