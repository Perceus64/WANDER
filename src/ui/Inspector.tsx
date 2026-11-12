import { useState } from 'react';
import { ENV_PRESETS, type Env, type Kind, type Obj } from '../engine/types';
import { PREFABS, PREFAB_MAP } from '../engine/prefabs';
import { Area, AssetSel, Btn, Check, Color, Num, Row, Section, Sel, Slider, Txt, Vec, fmtBytes, useEd } from './widgets';
import type { Editor } from '../editor/editor';

type F = [key: string, label: string, type: string, opt?: any, tip?: string];
const MAT: F[] = [['color', 'Colour', 'color'], ['texture', 'Texture', 'asset', 'image', 'Image stretched over the surface']];
const BEHAVE: F[] = [
  ['solid', 'Solid (blocks player)', 'bool'], ['interactable', 'Interactable', 'bool', null, 'Shows a prompt; add an event with “WHEN player interacts with…” to make it do something'],
  ['prompt', 'Prompt text', 'text', 'Use'], ['collectible', 'Collectible', 'bool', null, 'Picked up with the interact key, counted in the “collected” variable and listed in the journal'], ['note', 'Journal note', 'area'],
];
const FIELDS: Partial<Record<Kind, { main: F[]; adv?: F[]; behave?: boolean }>> = {
  primitive: { main: [['shape', 'Shape', 'sel', ['box', 'sphere', 'cylinder', 'cone', 'plane']], ...MAT], adv: [['roughness', 'Roughness', 'slider', [0, 1]], ['metalness', 'Metalness', 'slider', [0, 1]], ['opacity', 'Opacity', 'slider', [0.05, 1]], ['emissive', 'Glow', 'slider', [0, 3]]], behave: true },
  prefab: { main: [['prefab', 'Asset', 'prefab'], ['color', 'Tint', 'tint']], adv: [['lightOn', 'Light on', 'boolT', null, 'Only for lamps']], behave: true },
  model: { main: [['asset', 'Model file', 'asset', 'model'], ['ground', 'Stand on its base', 'bool', null, 'Centres the model and puts its lowest point on the ground, whatever origin the file was exported with'], ['collision', 'Collision', 'sel', [['box', 'One box around the model'], ['parts', 'A box per part (walk inside buildings)'], ['none', 'None (walk through)']]], ['animate', 'Play animation', 'bool'], ['clip', 'Animation no.', 'num', { step: 1, min: 0 }]], behave: true },
  text: { main: [['text', 'Text', 'area'], ['width', 'Width (m)', 'num'], ['height', 'Height (m)', 'num'], ['color', 'Text colour', 'color'], ['background', 'Background', 'color']] },
  light: { main: [['type', 'Type', 'sel', ['point', 'spot', 'directional']], ['color', 'Colour', 'color'], ['intensity', 'Intensity', 'num', { step: 1, min: 0 }], ['range', 'Range (m)', 'num', { step: 1, min: 0 }]], adv: [['angle', 'Spot angle °', 'slider', [5, 80, 1]], ['castShadow', 'Cast shadows', 'bool', null, 'Expensive: keep to one or two lights']] },
  audio: { main: [['asset', 'Sound file', 'asset', 'audio'], ['volume', 'Volume', 'slider', [0, 1]], ['loop', 'Loop', 'bool'], ['autoplay', 'Play at start', 'bool', null, 'Off = only played by events or cinematics'], ['positional', '3D positional', 'bool', null, 'Off = background music heard everywhere']], adv: [['refDistance', 'Full volume within (m)', 'num', { step: 1, min: 0.5 }], ['maxDistance', 'Silent beyond (m)', 'num', { step: 1, min: 1 }], ['fade', 'Fade in/out (s)', 'num', { min: 0 }]] },
  info: {
    main: [['title', 'Title', 'text'], ['body', 'Text', 'area', null, 'Blank line = new paragraph. **bold**, *italic*'], ['template', 'Template', 'sel', [['object', 'Object description'], ['museum', 'Museum exhibit'], ['history', 'Historical note'], ['education', 'Educational display']]], ['activation', 'Appears', 'sel', [['proximity', 'when the player comes close'], ['key', 'when a key is pressed nearby'], ['click', 'when clicked'], ['event', 'only when an event shows it']]], ['distance', 'Trigger distance (m)', 'num', { min: 0.5 }], ['image', 'Image', 'asset', 'image']],
    adv: [['key', 'Interaction key', 'sel', ['E', 'F', 'R', 'Q', 'T']], ['audio', 'Audio (when opened)', 'asset', 'audio'], ['video', 'Video file', 'asset', 'video'], ['link', 'External link', 'text', 'https://…'], ['linkLabel', 'Link label', 'text'], ['color', 'Accent colour', 'color'], ['background', 'Background', 'color'], ['text', 'Text colour', 'color'], ['font', 'Typography', 'sel', [['sans', 'Sans-serif'], ['serif', 'Serif'], ['mono', 'Monospace']]], ['animation', 'Show animation', 'sel', ['fade', 'slide', 'none']], ['marker', 'Show marker icon in world', 'bool']],
  },
  trigger: { main: [['size', 'Zone size (m)', 'vec']] },
  screen: { main: [['media', 'Plays', 'asset', 'media', 'Any imported image, animated GIF or video (MP4/WebM)'], ['width', 'Width (m)', 'num', { min: 0.2 }], ['height', 'Height (m)', 'num', { min: 0.2 }], ['fit', 'Picture fit', 'sel', [['contain', 'Keep proportions'], ['stretch', 'Stretch to fill']]], ['loop', 'Loop video', 'bool'], ['sound', 'Play video sound', 'bool', null, 'Heard while playing the world; the editor preview stays muted'], ['volume', 'Volume', 'slider', [0, 1]]], adv: [['frame', 'Frame colour', 'color']], behave: true },
  wall: { main: [['length', 'Length (m)', 'num', { min: 0.3 }], ['height', 'Height (m)', 'num', { min: 0.3 }], ['thickness', 'Thickness (m)', 'num', { min: 0.05, step: 0.05 }], ...MAT] },
  floor: { main: [['width', 'Width (m)', 'num', { min: 0.2 }], ['depth', 'Depth (m)', 'num', { min: 0.2 }], ['thickness', 'Thickness (m)', 'num', { min: 0.02, step: 0.05 }], ...MAT] },
  door: { main: [['style', 'Type', 'sel', [['hinged', 'Hinged door'], ['sliding', 'Sliding door'], ['rotating', 'Rotating door'], ['garage', 'Garage door / gate']]], ['width', 'Width (m)', 'num', { min: 0.4 }], ['height', 'Height (m)', 'num', { min: 0.5 }], ['color', 'Colour', 'color'], ['auto', 'Opens automatically', 'bool', null, 'Opens when the player approaches'], ['locked', 'Locked', 'bool', null, 'Unlock it with an event action'], ['sound', 'Sound effect', 'bool']] },
  window: { main: [['width', 'Width (m)', 'num', { min: 0.3 }], ['height', 'Height (m)', 'num', { min: 0.3 }], ['color', 'Glass tint', 'color']] },
  stairs: { main: [['width', 'Width (m)', 'num', { min: 0.5 }], ['rise', 'Total height (m)', 'num', { min: 0.2 }], ['run', 'Length (m)', 'num', { min: 0.5 }], ['steps', 'Steps', 'num', { step: 1, min: 2, max: 60 }], ['color', 'Colour', 'color']] },
  elevator: { main: [['speed', 'Speed (m/s)', 'num', { min: 0.2 }], ['doorTime', 'Doors stay open (s)', 'num', { min: 1 }], ['width', 'Cabin width', 'num', { min: 1 }], ['depth', 'Cabin depth', 'num', { min: 1 }], ['height', 'Cabin height', 'num', { min: 2 }]], adv: [['color', 'Cabin colour', 'color'], ['light', 'Cabin light', 'color'], ['sound', 'Arrival chime', 'bool']] },
  platform: { main: [['size', 'Size (m)', 'vec'], ['offset', 'Moves by (m)', 'vec', null, 'Travel from its start position'], ['speed', 'Speed (m/s)', 'num', { min: 0.1 }], ['pause', 'Pause at ends (s)', 'num', { min: 0 }], ['mode', 'Movement', 'sel', [['loop', 'Back and forth continuously'], ['trigger', 'One trip each time an event starts it']]], ['color', 'Colour', 'color']] },
  road: { main: [['width', 'Width (m)', 'num', { min: 0.5 }], ['kindOf', 'Type', 'sel', [['road', 'Road / path'], ['river', 'River']]], ['color', 'Surface colour', 'color'], ['sidewalks', 'Sidewalks', 'bool'], ['closed', 'Closed loop', 'bool']] },
  poly: { main: [['height', 'Height (m)', 'num', { min: 0 }, '0 = flat area such as a lake'], ['windows', 'Window grid on walls', 'bool', null, 'Draws rows of windows, one storey every 3.5 m'], ['color', 'Colour', 'color'], ['opacity', 'Opacity', 'slider', [0.1, 1]]] },
  scatter: { main: [['prefab', 'Asset', 'prefab'], ['solid', 'Solid (blocks player)', 'bool']] },
  water: { main: [['width', 'Width (m)', 'num', { min: 1, step: 1 }], ['depth', 'Depth (m)', 'num', { min: 1, step: 1 }], ['color', 'Colour', 'color'], ['opacity', 'Opacity', 'slider', [0.1, 1]]] },
};

function Field({ f, o, ed }: { f: F; o: Obj; ed: Editor }) {
  const [key, label, type, opt, tip] = f, v = o.props[key], set = (val: any) => ed.setProps(o.id, { [key]: val });
  let c;
  if (type === 'num') c = <Num value={v ?? 0} onChange={set} {...(opt ?? {})} />;
  else if (type === 'slider') c = <Slider value={v ?? 0} onChange={set} min={opt[0]} max={opt[1]} step={opt[2]} />;
  else if (type === 'text') c = <Txt value={v} onChange={set} placeholder={opt} />;
  else if (type === 'area') c = <Area value={v} onChange={set} />;
  else if (type === 'color') c = <Color value={v} onChange={set} />;
  else if (type === 'tint') c = <span className="color">{v ? <Color value={v} onChange={set} /> : null}<Btn kind="mini" onClick={() => set(v ? '' : '#ffffff')}>{v ? 'Clear' : 'Add tint'}</Btn></span>;
  else if (type === 'bool') return <div className="row" title={tip}><Check value={!!v} onChange={set} label={label} /></div>;
  else if (type === 'boolT') return PREFAB_MAP[o.props.prefab]?.light ? <div className="row" title={tip}><Check value={v !== false} onChange={set} label={label} /></div> : null;
  else if (type === 'sel') c = <Sel value={v} onChange={set} options={opt} />;
  else if (type === 'asset') c = <AssetSel type={opt} value={v} onChange={set} />;
  else if (type === 'vec') c = <Vec value={v} onChange={set} />;
  else if (type === 'prefab') c = <Sel value={v} onChange={set} options={PREFABS.map((p) => [p.key, `${p.cat} – ${p.name}`] as const)} />;
  return <Row label={label} tip={tip}>{c}</Row>;
}

/** Statistics of an imported model and the one-click optimiser. */
function ModelStats({ id, ed }: { id: string; ed: Editor }) {
  const a = ed.scene.assets[id], m = a.meta, [tex, setTex] = useState('1024'), [detail, setDetail] = useState('1'), [busy, setBusy] = useState(false);
  const heavy = m && (m.tris > 150000 || m.maxTexture > 2048 || a.size > 15e6);
  const run = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 40));
    try {
      const r = await ed.optimiseAsset(id, { maxTexture: +tex, detail: +detail });
      ed.toast(`Optimised “${a.name}”: ${r.before.tris.toLocaleString()} → ${r.after.tris.toLocaleString()} triangles, ${fmtBytes(r.sizeBefore)} → ${fmtBytes(r.sizeAfter)}.${r.notes.length ? ' ' + r.notes.join(' ') : ''}`, 'ok');
    } catch (e: any) { ed.toast(`Could not optimise: ${e?.message ?? e}`, 'error'); } finally { setBusy(false); }
  };
  return (
    <Section title="Model file">
      {m ? <p className="hint">{m.tris.toLocaleString()} triangles · {m.meshes} mesh(es) · {m.materials} material(s) · {m.textures} texture(s){m.maxTexture ? ` up to ${m.maxTexture}px` : ''} · {m.size.map((v) => v.toFixed(2)).join(' × ')} m · {fmtBytes(a.size)}{m.animations ? ` · ${m.animations} animation(s)` : ''}</p> : <p className="hint">{fmtBytes(a.size)} · imported before statistics were recorded. Optimise once to analyse it.</p>}
      {heavy && <p className="hint warn">This model is heavy for the web. Optimising it will make the world load and run faster.</p>}
      <Row label="Max texture size" tip="Larger textures are scaled down"><Sel value={tex} onChange={setTex} options={[['4096', '4096 px (keep)'], ['2048', '2048 px'], ['1024', '1024 px'], ['512', '512 px'], ['256', '256 px']]} /></Row>
      <Row label="Geometry detail" tip="Reduces the number of triangles while keeping the shape, textures and rigging"><Sel value={detail} onChange={setDetail} options={[['1', '100% (weld only)'], ['0.75', '75%'], ['0.5', '50%'], ['0.25', '25%']]} /></Row>
      <div className="btns"><Btn kind="primary" disabled={busy} onClick={run} tip="Applies to every copy of this model in the world. This rewrites the stored file and cannot be undone – keep your original.">{busy ? 'Optimising…' : 'Optimise model'}</Btn></div>
    </Section>
  );
}

function Floors({ o, ed }: { o: Obj; ed: Editor }) {
  const fl: { name: string; y: number }[] = o.props.floors;
  const set = (floors: any[]) => ed.setProps(o.id, { floors, startFloor: Math.min(o.props.startFloor, floors.length - 1) });
  return (
    <Section title="Floors">
      <p className="hint">Height is measured from the elevator’s own position. Match each value to the floor level of your building.</p>
      {fl.map((f, i) => (
        <div className="row3" key={i}>
          <Txt value={f.name} onChange={(v) => set(fl.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
          <Num value={f.y} step={0.1} onChange={(v) => set(fl.map((x, j) => (j === i ? { ...x, y: v } : x)))} />
          <Btn kind="mini" tip="Remove floor" disabled={fl.length <= 2} onClick={() => set(fl.filter((_, j) => j !== i))}>✕</Btn>
        </div>
      ))}
      <Btn onClick={() => set([...fl, { name: String(fl.length), y: Math.round(((fl[fl.length - 1]?.y ?? 0) + 3.2) * 100) / 100 }])}>+ Add floor</Btn>
      <Row label="Starting floor"><Sel value={String(o.props.startFloor)} onChange={(v) => ed.setProps(o.id, { startFloor: +v })} options={fl.map((f, i) => [String(i), f.name] as const)} /></Row>
    </Section>
  );
}

function addStorey(ed: Editor, g: Obj) {
  ed.select([g.id]);
  ed.duplicate([g.id]);
  const n = ed.obj(ed.selection[0])!;
  n.name = g.name.replace(/ copy$/, '') + ' (upper)';
  ed.setTransform(n.id, { pos: [g.pos[0], Math.round((g.pos[1] + (g.props.height ?? 3) + 0.2) * 1000) / 1000, g.pos[2]] });
  ed.toast('Storey added. Remove part of its floor (or split it) where stairs or an elevator pass through.');
}

function ObjectTab() {
  const ed = useEd(), o = ed.obj(ed.selection[ed.selection.length - 1]);
  if (!o) return <div className="empty">Nothing selected.<br /><br />Click an object in the viewport or the Scene list. Drag items from the Library into the world to add them.</div>;
  const spec = FIELDS[o.kind], par = ed.obj(o.parent), inWall = par?.kind === 'wall' && (o.kind === 'door' || o.kind === 'window');
  return (
    <>
      {ed.selection.length > 1 && <div className="note">{ed.selection.length} objects selected – editing “{o.name}”. Move, duplicate, group and delete apply to all.</div>}
      <Section title="Object">
        <Row label="Name"><Txt value={o.name} onChange={(v) => ed.setField(o.id, 'name', v)} /></Row>
        <div className="row"><Check value={o.visible} onChange={(v) => ed.setField(o.id, 'visible', v)} label="Visible" /><Check value={o.locked} onChange={(v) => ed.setField(o.id, 'locked', v)} label="Locked" /></div>
      </Section>
      <Section title="Transform">
        {inWall && <p className="hint">This {o.kind} is cut into a wall: X slides it along the wall, Y sets the sill height.</p>}
        <Row label="Position"><Vec value={o.pos} onChange={(v) => ed.setTransform(o.id, { pos: v as any })} /></Row>
        {!inWall && <Row label="Rotation °"><Vec value={o.rot} step={5} onChange={(v) => ed.setTransform(o.id, { rot: v as any })} /></Row>}
        {!inWall && <Row label="Scale"><Vec value={o.scale} onChange={(v) => ed.setTransform(o.id, { scale: v.map((n) => n || 0.001) as any })} /></Row>}
        {ed.terrain && !o.parent && <Btn kind="mini" tip="Move the object down/up onto the terrain surface" onClick={() => ed.setTransform(o.id, { pos: [o.pos[0], Math.round(ed.heightAt(o.pos[0], o.pos[2]) * 1000) / 1000, o.pos[2]] })}>Snap to ground</Btn>}
      </Section>
      {spec && <Section title={o.kind === 'prefab' ? 'Asset' : o.kind[0].toUpperCase() + o.kind.slice(1)}>{spec.main.map((f) => <Field key={f[0]} f={f} o={o} ed={ed} />)}</Section>}
      {o.kind === 'wall' && (
        <Section title="Doors and windows">
          <div className="btns"><Btn onClick={() => ed.insertOpening(o.id, 'door')}>+ Door</Btn><Btn onClick={() => ed.insertOpening(o.id, 'window')}>+ Window</Btn></div>
          <p className="hint">{(o.props.openings ?? []).length} opening(s). You can also drag a Door or Window from the Library onto the wall.</p>
        </Section>
      )}
      {o.kind === 'elevator' && <Floors o={o} ed={ed} />}
      {o.kind === 'model' && ed.scene.assets[o.props.asset] && <ModelStats id={o.props.asset} ed={ed} />}
      {o.kind === 'group' && o.props.room && <Section title="Building"><Btn onClick={() => addStorey(ed, o)} tip="Copies this room one storey up">+ Add storey above</Btn></Section>}
      {o.kind === 'scatter' && <Section title="Instances"><p className="hint">{o.props.items.length / 4} instances, drawn in batches per ground cell and hidden beyond their draw distance. Paint more with the Scatter brush (World tab); hold Shift to erase.</p><Btn onClick={() => ed.setProps(o.id, { items: [] })}>Clear all</Btn></Section>}
      {o.kind === 'road' && <Section title="Path"><p className="hint">{o.props.points.length} control points. Follows the terrain automatically.</p></Section>}
      {o.kind === 'spawn' && <Section title="Player spawn"><p className="hint">The experience starts here. The green arrow shows the direction the player faces. Camera and movement settings are in the Player tab.</p></Section>}
      {o.kind === 'trigger' && <Section title="Trigger zone"><p className="hint">Invisible in the published world. Use it in the Events tab: “WHEN player enters zone…”.</p></Section>}
      {spec?.behave && <Section title="Interaction" open={!!(o.props.interactable || o.props.collectible)}>{BEHAVE.map((f) => <Field key={f[0]} f={f} o={o} ed={ed} />)}</Section>}
      {spec?.adv && <Section title="Advanced" open={false}>{spec.adv.map((f) => <Field key={f[0]} f={f} o={o} ed={ed} />)}</Section>}
      {o.kind !== 'info' && o.kind !== 'group' && <Section title="Information" open={false}><Btn tip="Attach an information box to this object" onClick={() => { const i = ed.create('info', `${o.name} info`, { title: o.name }, [0, 1.6, 0], o.id); ed.select([i.id]); }}>+ Attach information box</Btn></Section>}
    </>
  );
}

const ENV_F: [keyof Env, string, number, number, number][] = [['sunElevation', 'Sun height °', 0, 90, 1], ['sunAzimuth', 'Sun direction °', 0, 360, 1], ['sunIntensity', 'Sun strength', 0, 6, 0.05], ['ambient', 'Ambient light', 0, 3, 0.05], ['fogDensity', 'Fog', 0, 0.05, 0.0005], ['exposure', 'Exposure', 0.3, 2, 0.01], ['bloom', 'Bloom (glow)', 0, 1.5, 0.05], ['saturation', 'Saturation', 0, 2, 0.05], ['contrast', 'Contrast', 0.5, 1.6, 0.01], ['dayLength', 'Day length (min)', 0, 60, 1]];
const ENV_DEF: Partial<Record<keyof Env, number>> = { bloom: 0, saturation: 1, contrast: 1, dayLength: 0 };

function EnvTab() {
  const ed = useEd(), e = ed.scene.env, [name, setName] = useState('');
  const custom = Object.keys(ed.project.envPresets);
  return (
    <>
      <Section title="Presets">
        <div className="chips">{Object.keys(ENV_PRESETS).map((p) => <Btn key={p} kind="chip" onClick={() => ed.applyEnvPreset(p)}>{p}</Btn>)}</div>
        {custom.length > 0 && <div className="chips">{custom.map((p) => <span key={p} className="chipx"><Btn kind="chip" onClick={() => ed.applyEnvPreset(p)}>{p}</Btn><button title="Delete preset" onClick={() => { delete ed.project.envPresets[p]; ed.touch(); }}>✕</button></span>)}</div>}
        <div className="row3"><Txt value={name} onChange={setName} placeholder="Save current as…" /><Btn disabled={!name.trim()} onClick={() => { ed.project.envPresets[name.trim()] = structuredClone(e); setName(''); ed.touch(); ed.toast('Preset saved', 'ok'); }}>Save</Btn></div>
      </Section>
      <Section title="Sun and sky">
        {ENV_F.slice(0, 4).map(([k, l, a, b, s]) => <Row key={k} label={l}><Slider value={e[k] as number} min={a} max={b} step={s} onChange={(v) => ed.setEnv({ [k]: v })} /></Row>)}
        <Row label="Sun colour"><Color value={e.sunColor} onChange={(v) => ed.setEnv({ sunColor: v })} /></Row>
        <Row label="Sky (top)"><Color value={e.skyTop} onChange={(v) => ed.setEnv({ skyTop: v })} /></Row>
        <Row label="Sky (horizon)"><Color value={e.skyHorizon} onChange={(v) => ed.setEnv({ skyHorizon: v })} /></Row>
        <div className="row"><Check value={e.shadows} onChange={(v) => ed.setEnv({ shadows: v })} label="Sun shadows" /></div>
      </Section>
      <Section title="Atmosphere">
        {ENV_F.slice(4).map(([k, l, a, b, s]) => <Row key={k} label={l}><Slider value={(e[k] as number | undefined) ?? ENV_DEF[k] ?? 0} min={a} max={b} step={s} onChange={(v) => ed.setEnv({ [k]: v })} /></Row>)}
        <Row label="Fog colour"><Color value={e.fogColor} onChange={(v) => ed.setEnv({ fogColor: v })} /></Row>
        <Row label="Weather"><Sel value={e.weather} onChange={(v) => ed.setEnv({ weather: v as Env['weather'] })} options={[['none', 'Clear'], ['rain', 'Rain'], ['snow', 'Snow']]} /></Row>
      </Section>
    </>
  );
}

function PlayerTab() {
  const ed = useEd(), p = ed.scene.player, set = (patch: Partial<typeof p>) => ed.mutate('player', (s) => Object.assign(s.player, patch));
  const hasSpawn = Object.values(ed.scene.objects).some((o) => o.kind === 'spawn');
  return (
    <>
      {!hasSpawn && <div className="note warn">No spawn point yet. Drag “Player spawn” from the Library into the world.</div>}
      <Section title="Camera">
        <Row label="View"><Sel value={p.mode} onChange={(v) => set({ mode: v as any })} options={[['first', 'First person'], ['third', 'Third person']]} /></Row>
        <Row label="Field of view °"><Slider value={p.fov} min={40} max={110} step={1} onChange={(v) => set({ fov: v })} /></Row>
        <Row label="Mouse sensitivity"><Slider value={p.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => set({ sensitivity: v })} /></Row>
        <Row label="Camera smoothing"><Slider value={p.smoothing} min={0} max={1} onChange={(v) => set({ smoothing: v })} /></Row>
        <Row label="Eye height (m)"><Num value={p.eyeHeight} min={0.5} max={3} onChange={(v) => set({ eyeHeight: v })} /></Row>
        <div className="row"><Check value={p.headBob} onChange={(v) => set({ headBob: v })} label="Head bobbing" /></div>
      </Section>
      <Section title="Movement">
        <Row label="Walk speed (m/s)"><Num value={p.walkSpeed} min={0.5} onChange={(v) => set({ walkSpeed: v })} /></Row>
        <Row label="Run speed (m/s)"><Num value={p.runSpeed} min={0.5} onChange={(v) => set({ runSpeed: v })} /></Row>
        <div className="row"><Check value={p.jump} onChange={(v) => set({ jump: v })} label="Allow jumping" /><Check value={p.footsteps} onChange={(v) => set({ footsteps: v })} label="Footstep sounds" /></div>
        <div className="row" title="Lowers the rendering resolution when the frame rate drops on slow devices, and restores it when possible"><Check value={p.autoQuality !== false} onChange={(v) => set({ autoQuality: v })} label="Automatic quality (keeps it smooth)" /></div>
        <div className="row" title="Objects completely hidden behind walls, floors, buildings or hills are not drawn. Press F3 while playing to see how many are skipped."><Check value={p.occlusion !== false} onChange={(v) => set({ occlusion: v })} label="Occlusion culling (skip hidden objects)" /></div>
        {p.jump && <Row label="Jump height (m)"><Num value={p.jumpHeight} min={0.2} max={10} onChange={(v) => set({ jumpHeight: v })} /></Row>}
      </Section>
      <Section title="Interaction"><Row label="Reach distance (m)"><Num value={p.interactDistance} min={0.5} onChange={(v) => set({ interactDistance: v })} /></Row></Section>
    </>
  );
}

export function Inspector() {
  const [tab, setTab] = useState<'object' | 'env' | 'player'>('object');
  return (
    <aside className="panel right">
      <nav className="tabs">{([['object', 'Inspector'], ['env', 'Atmosphere'], ['player', 'Player']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <div className="scroll">{tab === 'object' ? <ObjectTab /> : tab === 'env' ? <EnvTab /> : <PlayerTab />}</div>
    </aside>
  );
}
