import { useEffect, useRef, useState } from 'react';
import { EASES, ENV_PRESETS, uid, type Action, type Cinematic, type EventRule, type Kind } from '../engine/types';
import { validate } from '../editor/publish';
import type { Editor } from '../editor/editor';
import { Btn, Check, Num, ObjSel, Sel, Txt, useEd } from './widgets';

// ---------------------------------------------------------------- events

const TRIGGERS: [string, string, ('obj' | 'value' | 'name' | 'cin')?, Kind[]?][] = [
  ['start', 'the experience starts'], ['enterZone', 'the player enters the zone', 'obj', ['trigger']], ['leaveZone', 'the player leaves the zone', 'obj', ['trigger']],
  ['near', 'the player comes near', 'obj'], ['interact', 'the player interacts with', 'obj'], ['collect', 'the player collects', 'obj'],
  ['timer', 'this many seconds have passed', 'value'], ['variable', 'this variable changes', 'name'], ['cinematicEnd', 'this cinematic ends', 'cin'], ['elevatorArrive', 'this elevator arrives', 'obj', ['elevator']],
];
type AF = [key: string, type: 'text' | 'num' | 'obj' | 'sel' | 'cin' | 'rule' | 'var' | 'preset', label: string, opt?: any];
const ACTIONS: Record<string, { label: string; basic?: boolean; fields: AF[]; init?: Record<string, any> }> = {
  message: { label: 'Show notification', basic: true, fields: [['text', 'text', 'Text'], ['seconds', 'num', 'for (s)']], init: { text: 'Hello!', seconds: 4 } },
  dialogue: { label: 'Show dialogue', basic: true, fields: [['speaker', 'text', 'Speaker'], ['text', 'text', 'Line'], ['seconds', 'num', 'for (s)']], init: { speaker: 'Narrator', text: '…', seconds: 5 } },
  subtitle: { label: 'Show subtitle / narration', fields: [['text', 'text', 'Text'], ['seconds', 'num', 'for (s)']], init: { text: '…', seconds: 4 } },
  objective: { label: 'Set objective', basic: true, fields: [['text', 'text', 'Objective (empty = clear)']], init: { text: '' } },
  info: { label: 'Show information box', basic: true, fields: [['target', 'obj', 'Box', ['info']]] },
  playAudio: { label: 'Play audio', basic: true, fields: [['target', 'obj', 'Source', ['audio']]] },
  stopAudio: { label: 'Stop audio', fields: [['target', 'obj', 'Source', ['audio']]] },
  door: { label: 'Door: open / close / lock', basic: true, fields: [['target', 'obj', 'Door', ['door']], ['mode', 'sel', 'Do', ['open', 'close', 'toggle', 'lock', 'unlock']]], init: { mode: 'open' } },
  elevator: { label: 'Send elevator to floor', fields: [['target', 'obj', 'Elevator', ['elevator']], ['floor', 'num', 'Floor no. (0 = lowest)']], init: { floor: 0 } },
  platform: { label: 'Start / stop platform', fields: [['target', 'obj', 'Platform', ['platform']], ['mode', 'sel', 'Do', ['start', 'stop']]], init: { mode: 'start' } },
  cinematic: { label: 'Play cinematic', basic: true, fields: [['id', 'cin', 'Cinematic']] },
  show: { label: 'Show object', basic: true, fields: [['target', 'obj', 'Object']] },
  hide: { label: 'Hide object', basic: true, fields: [['target', 'obj', 'Object']] },
  teleport: { label: 'Move player to', fields: [['target', 'obj', 'Object']] },
  environment: { label: 'Change atmosphere', fields: [['preset', 'preset', 'Preset']], init: { preset: 'Sunset' } },
  setVar: { label: 'Change variable', fields: [['name', 'var', 'Variable'], ['op', 'sel', '', [['set', 'set to'], ['add', 'add']]], ['value', 'num', 'Value']], init: { name: 'score', op: 'add', value: 1 } },
  wait: { label: 'Wait (delay)', basic: true, fields: [['seconds', 'num', 'Seconds']], init: { seconds: 2 } },
  checkpoint: { label: 'Save checkpoint', fields: [] },
  enableRule: { label: 'Enable event', fields: [['rule', 'rule', 'Event']] },
  disableRule: { label: 'Disable event', fields: [['rule', 'rule', 'Event']] },
  end: { label: 'End screen', fields: [['title', 'text', 'Title'], ['text', 'text', 'Text']], init: { title: 'The End', text: '' } },
};

function VarSel({ ed, value, onChange }: { ed: Editor; value: string; onChange(v: string): void }) {
  const names = [...new Set(['collected', ...Object.keys(ed.scene.variables), value].filter(Boolean))];
  return <Sel value={value} onChange={onChange} options={names} />;
}

function ActionRow({ a, ed, change, remove, move, beginner }: { a: Action; ed: Editor; change(p: Partial<Action>): void; remove(): void; move(d: number): void; beginner: boolean }) {
  const def = ACTIONS[a.type];
  return (
    <div className="act">
      <Sel value={a.type} onChange={(v) => change({ type: v, ...(ACTIONS[v].init ?? {}) })} options={Object.entries(ACTIONS).filter(([k, d]) => !beginner || d.basic || k === a.type).map(([k, d]) => [k, d.label] as const)} />
      {def?.fields.map(([key, type, label, opt]) => (
        <label key={key} className={type === 'text' ? 'grow' : ''}>{label && <small>{label}</small>}
          {type === 'text' ? <Txt value={a[key] ?? ''} onChange={(v) => change({ [key]: v })} />
            : type === 'num' ? <Num value={a[key] ?? 0} onChange={(v) => change({ [key]: v })} w={64} />
            : type === 'obj' ? <ObjSel value={a[key] ?? ''} kinds={opt} onChange={(v) => change({ [key]: v })} />
            : type === 'sel' ? <Sel value={a[key]} onChange={(v) => change({ [key]: v })} options={opt} />
            : type === 'cin' ? <Sel value={a[key] ?? ''} onChange={(v) => change({ [key]: v })} options={[['', '(choose)'], ...ed.scene.cinematics.map((c) => [c.id, c.name] as const)]} />
            : type === 'rule' ? <Sel value={a[key] ?? ''} onChange={(v) => change({ [key]: v })} options={[['', '(choose)'], ...ed.scene.events.map((r) => [r.id, r.name] as const)]} />
            : type === 'preset' ? <Sel value={a[key]} onChange={(v) => change({ [key]: v })} options={[...Object.keys(ENV_PRESETS), ...Object.keys(ed.project.envPresets)]} />
            : <VarSel ed={ed} value={a[key] ?? ''} onChange={(v) => change({ [key]: v })} />}
        </label>
      ))}
      <span className="acts-ctl"><button className="tiny" title="Move up" onClick={() => move(-1)}>↑</button><button className="tiny" title="Move down" onClick={() => move(1)}>↓</button><button className="tiny" title="Remove action" onClick={remove}>✕</button></span>
    </div>
  );
}

function Rule({ r, ed, beginner }: { r: EventRule; ed: Editor; beginner: boolean }) {
  const up = (fn: (r: EventRule) => void) => ed.mutate('ev' + r.id, (s) => { const x = s.events.find((e) => e.id === r.id); if (x) fn(x); });
  const tdef = TRIGGERS.find((t) => t[0] === r.trigger.type)!;
  return (
    <div className={`rule ${r.enabled ? '' : 'off'}`}>
      <div className="rule-h">
        <Check value={r.enabled} onChange={(v) => up((x) => (x.enabled = v))} />
        <Txt value={r.name} onChange={(v) => up((x) => (x.name = v))} />
        {!beginner && <Check value={r.once} onChange={(v) => up((x) => (x.once = v))} label="only once" />}
        <button className="tiny" title="Duplicate event" onClick={() => ed.mutate('evdup', (s) => { s.events.push({ ...structuredClone(r), id: uid('e'), name: r.name + ' copy' }); })}>⧉</button>
        <button className="tiny" title="Delete event" onClick={() => ed.mutate('evdel', (s) => { s.events = s.events.filter((e) => e.id !== r.id); })}>🗑</button>
      </div>
      <div className="blk when"><b>WHEN</b>
        <Sel value={r.trigger.type} onChange={(v) => up((x) => (x.trigger = { type: v, value: v === 'near' ? 4 : v === 'timer' ? 10 : undefined, name: v === 'variable' ? 'collected' : undefined }))} options={TRIGGERS.map((t) => [t[0], t[1]] as const)} />
        {tdef[2] === 'obj' && <ObjSel value={r.trigger.target ?? ''} kinds={tdef[3]} onChange={(v) => up((x) => (x.trigger.target = v || undefined))} />}
        {r.trigger.type === 'collect' && !r.trigger.target && <small>(any collectible)</small>}
        {r.trigger.type === 'near' && <label><small>within (m)</small><Num value={r.trigger.value ?? 4} min={0.5} w={64} onChange={(v) => up((x) => (x.trigger.value = v))} /></label>}
        {tdef[2] === 'value' && <Num value={r.trigger.value ?? 0} min={0} w={70} onChange={(v) => up((x) => (x.trigger.value = v))} />}
        {tdef[2] === 'name' && <VarSel ed={ed} value={r.trigger.name ?? ''} onChange={(v) => up((x) => (x.trigger.name = v))} />}
        {tdef[2] === 'cin' && <Sel value={r.trigger.target ?? ''} onChange={(v) => up((x) => (x.trigger.target = v || undefined))} options={[['', '(any)'], ...ed.scene.cinematics.map((c) => [c.id, c.name] as const)]} />}
      </div>
      {!beginner && (
        <div className="blk if"><b>IF</b>
          {r.conditions.map((c, i) => (
            <span key={i} className="cond">
              <VarSel ed={ed} value={c.name} onChange={(v) => up((x) => (x.conditions[i].name = v))} />
              <Sel value={c.op} onChange={(v) => up((x) => (x.conditions[i].op = v as any))} options={['=', '!=', '>', '<', '>=', '<=']} />
              <Num value={c.value} w={60} step={1} onChange={(v) => up((x) => (x.conditions[i].value = v))} />
              <button className="tiny" title="Remove condition" onClick={() => up((x) => x.conditions.splice(i, 1))}>✕</button>
            </span>
          ))}
          {!r.conditions.length && <small>always</small>}
          <Btn kind="mini" onClick={() => up((x) => x.conditions.push({ name: 'collected', op: '>=', value: 1 }))}>+ condition</Btn>
        </div>
      )}
      <div className="blk then"><b>THEN</b>
        <div className="grow">
          {r.actions.map((a, i) => (
            <ActionRow key={i} a={a} ed={ed} beginner={beginner}
              change={(p) => up((x) => (x.actions[i] = p.type && p.type !== a.type ? ({ type: p.type, ...(ACTIONS[p.type].init ?? {}) } as Action) : { ...x.actions[i], ...p }))}
              remove={() => up((x) => x.actions.splice(i, 1))}
              move={(d) => up((x) => { const j = i + d; if (j >= 0 && j < x.actions.length) [x.actions[i], x.actions[j]] = [x.actions[j], x.actions[i]]; })} />
          ))}
          <Btn kind="mini" onClick={() => up((x) => x.actions.push({ type: 'message', ...ACTIONS.message.init }))}>+ action</Btn>
          {r.actions.length > 1 && <small> Actions run top to bottom; add “Wait” between them to build a sequence.</small>}
        </div>
      </div>
    </div>
  );
}

function Events() {
  const ed = useEd(), [beginner, setBeginner] = useState(true), [vn, setVn] = useState('');
  const vars = ed.scene.variables;
  return (
    <div className="events">
      <div className="bar">
        <Btn kind="primary" onClick={() => ed.mutate('evadd', (s) => { s.events.push({ id: uid('e'), name: `Event ${s.events.length + 1}`, enabled: true, once: true, trigger: { type: 'start' }, conditions: [], actions: [{ type: 'message', ...ACTIONS.message.init }] }); })}>+ New event</Btn>
        <Check value={beginner} onChange={setBeginner} label="Simple mode" />
        {!beginner && (
          <span className="vars"><b>Variables:</b> <span className="chipx"><span className="btn chip" title="Counts collected objects automatically">collected</span></span>
            {Object.entries(vars).map(([k, v]) => <span key={k} className="chipx"><span className="btn chip">{k} = <Num value={v} step={1} w={48} onChange={(n) => ed.mutate('var' + k, (s) => { s.variables[k] = n; })} /></span><button title="Delete variable" onClick={() => ed.mutate('vardel', (s) => { delete s.variables[k]; })}>✕</button></span>)}
            <input className="in" style={{ width: 110 }} placeholder="new variable" value={vn} onChange={(e) => setVn(e.target.value.replace(/[^\w]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && vn) { ed.mutate('varadd', (s) => { s.variables[vn] = 0; }); setVn(''); } }} />
          </span>
        )}
        <span className="grow" /><small>{ed.scene.events.length} event(s) · WHEN something happens → IF conditions hold → THEN do actions</small>
      </div>
      <div className="scroll">
        {!ed.scene.events.length && <div className="empty">No events yet. Example: WHEN the player enters a zone → THEN play audio.<br />Add a Trigger zone from the Library, then press “New event”.</div>}
        {ed.scene.events.map((r) => <Rule key={r.id} r={r} ed={ed} beginner={beginner} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- timeline

function Timeline() {
  const ed = useEd(), cins = ed.scene.cinematics;
  const [cid, setCid] = useState(''), [t, setT] = useState(0), [selK, setSelK] = useState(-1), [playing, setPlaying] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const c = cins.find((x) => x.id === cid) ?? cins[0];
  const up = (fn: (c: Cinematic) => void, key = 'cin') => ed.mutate(key + c?.id, (s) => { const x = s.cinematics.find((y) => y.id === c?.id); if (x) fn(x); });
  useEffect(() => {
    const vp = ed.viewport;
    if (!vp) return;
    vp.onCineTick = (time) => { if (time < 0) { setPlaying(false); return; } setT(time); if (!vp.cine?.playing) setPlaying(false); };
    return () => { vp.onCineTick = null; vp.endPreview(); };
  }, [ed, ed.viewport]);
  const scrub = (time: number) => { if (!c) return; const v = Math.max(0, Math.min(c.duration, time)); setT(v); if (c.keys.length) ed.viewport?.previewCinematic(c, v, false); setPlaying(false); };
  const timeAt = (e: { clientX: number }) => { const r = track.current!.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * (c?.duration ?? 1); };
  const drag = (e: React.PointerEvent, move: (time: number) => void) => {
    e.stopPropagation(); e.preventDefault();
    const mv = (ev: PointerEvent) => move(Math.round(Math.max(0, Math.min(c!.duration, timeAt(ev))) * 20) / 20);
    const upH = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upH); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upH);
  };
  const add = () => ed.mutate('cinadd', (s) => { const n: Cinematic = { id: uid('c'), name: `Cinematic ${s.cinematics.length + 1}`, duration: 8, keys: [], subtitles: [], title: '', fadeIn: 0.8, fadeOut: 0.8, audio: '', letterbox: true }; s.cinematics.push(n); setCid(n.id); setT(0); });
  if (!c) return <div className="empty">Cinematics are camera sequences on a timeline.<br /><br /><Btn kind="primary" onClick={add}>+ New cinematic</Btn></div>;
  const keys = c.keys, k = keys[selK];
  const pct = (time: number) => `${(time / c.duration) * 100}%`;
  return (
    <div className="timeline">
      <div className="bar">
        <Sel value={c.id} onChange={(v) => { ed.viewport?.endPreview(); setCid(v); setT(0); setSelK(-1); }} options={cins.map((x) => [x.id, x.name] as const)} />
        <Btn kind="mini" onClick={add} tip="New cinematic">+</Btn>
        <Btn kind="mini" tip="Delete this cinematic" onClick={() => { ed.viewport?.endPreview(); ed.mutate('cindel', (s) => { s.cinematics = s.cinematics.filter((x) => x.id !== c.id); }); setCid(''); }}>🗑</Btn>
        <label><small>Name</small><Txt value={c.name} onChange={(v) => up((x) => (x.name = v))} /></label>
        <label><small>Length (s)</small><Num value={c.duration} min={1} max={600} w={60} onChange={(v) => up((x) => (x.duration = v))} /></label>
        <span className="sep" />
        <Btn kind="primary" tip="Places a camera keyframe at the playhead using the current viewport camera. Fly the camera where you want it first." onClick={() => {
          const v = ed.viewport!.viewKey();
          up((x) => { x.keys = x.keys.filter((q) => Math.abs(q.t - t) > 0.02); x.keys.push({ t: Math.round(t * 20) / 20, ...v, ease: 'easeInOut' }); x.keys.sort((a, b) => a.t - b.t); }, 'key');
          ed.toast(`Keyframe added at ${t.toFixed(1)} s`, 'ok');
        }}>◆ Add keyframe from view</Btn>
        <Btn active={playing} disabled={keys.length < 1} tip="Preview in the viewport" onClick={() => { if (playing) { ed.viewport?.previewCinematic(c, t, false); setPlaying(false); } else { ed.viewport?.previewCinematic(c, t >= c.duration ? 0 : t, true); setPlaying(true); } }}>{playing ? '❚❚ Pause' : '▶ Preview'}</Btn>
        <Btn tip="Leave the preview and move the camera freely" disabled={!ed.viewport?.cine} onClick={() => { ed.viewport?.endPreview(); ed.emit(); }}>Free camera</Btn>
        <span className="grow" /><b className="time">{t.toFixed(2)} s</b>
      </div>
      <div className="tracks" ref={track} onPointerDown={(e) => { scrub(timeAt(e)); drag(e, scrub); }}>
        <div className="ruler">{Array.from({ length: Math.floor(c.duration) + 1 }, (_, i) => <span key={i} style={{ left: pct(i) }}>{c.duration <= 20 || i % 5 === 0 ? i : ''}</span>)}</div>
        <div className="track"><label>Camera</label>
          {keys.map((q, i) => <i key={i} className={`key ${i === selK ? 'sel' : ''}`} style={{ left: pct(q.t) }} title={`Keyframe ${q.t}s – drag to move`} onPointerDown={(e) => { setSelK(i); const id = q; drag(e, (time) => up((x) => { const kk = x.keys.find((z) => z.t === id.t && z.pos[0] === id.pos[0]) ?? x.keys[i]; if (kk) { kk.t = time; id.t = time; } }, 'keymove')); }} />)}
          {keys.length > 1 && <div className="span" style={{ left: pct(keys[0].t), width: pct(keys[keys.length - 1].t - keys[0].t) }} />}
        </div>
        <div className="track"><label>Subtitles</label>
          {c.subtitles.map((s, i) => <div key={i} className="clip" style={{ left: pct(s.t), width: pct(s.d) }} title="Drag to move" onPointerDown={(e) => drag(e, (time) => up((x) => { if (x.subtitles[i]) x.subtitles[i].t = time; }, 'submove'))}>{s.text}</div>)}
        </div>
        <div className="track"><label>Effects</label>
          {c.fadeIn > 0 && <div className="clip fx" style={{ left: 0, width: pct(Math.min(c.fadeIn, c.duration)) }}>fade in</div>}
          {c.fadeOut > 0 && <div className="clip fx" style={{ left: pct(Math.max(0, c.duration - c.fadeOut)), width: pct(Math.min(c.fadeOut, c.duration)) }}>fade out</div>}
          {c.title && <div className="clip fx t" style={{ left: pct(0.2), width: pct(Math.min(4, c.duration * 0.6)) }}>title</div>}
        </div>
        <div className="playhead" style={{ left: pct(t) }} />
      </div>
      <div className="bar props">
        {k ? <>
          <b>Keyframe</b>
          <label><small>Time</small><Num value={k.t} min={0} max={c.duration} w={64} onChange={(v) => up((x) => { x.keys[selK].t = v; })} /></label>
          <label><small>Easing into it</small><Sel value={k.ease} onChange={(v) => up((x) => { x.keys[selK].ease = v; })} options={Object.keys(EASES)} /></label>
          <label><small>Zoom (FOV °)</small><Num value={k.fov} min={10} max={120} step={1} w={60} onChange={(v) => up((x) => { x.keys[selK].fov = v; })} /></label>
          <Btn kind="mini" tip="Replace this keyframe's camera with the current view" onClick={() => up((x) => { Object.assign(x.keys[selK], { ...ed.viewport!.viewKey(), fov: x.keys[selK].fov }); })}>Update from view</Btn>
          <Btn kind="mini" onClick={() => scrub(k.t)}>Go to</Btn>
          <Btn kind="mini" onClick={() => { up((x) => x.keys.splice(selK, 1)); setSelK(-1); }}>Delete</Btn>
          <span className="sep" />
        </> : <small>Click a ◆ keyframe to edit it.</small>}
        <label><small>Title card</small><Txt value={c.title} onChange={(v) => up((x) => (x.title = v))} /></label>
        <label><small>Fade in / out (s)</small><span className="vec"><Num value={c.fadeIn} min={0} w={52} onChange={(v) => up((x) => (x.fadeIn = v))} /><Num value={c.fadeOut} min={0} w={52} onChange={(v) => up((x) => (x.fadeOut = v))} /></span></label>
        <label><small>Audio / music</small><ObjSel value={c.audio} kinds={['audio']} onChange={(v) => up((x) => (x.audio = v))} /></label>
        <Check value={c.letterbox} onChange={(v) => up((x) => (x.letterbox = v))} label="Letterbox" />
        <Btn kind="mini" tip="Adds a subtitle at the playhead" onClick={() => { const text = prompt('Subtitle text'); if (text) up((x) => x.subtitles.push({ t: Math.round(t * 10) / 10, d: 3, text })); }}>+ Subtitle</Btn>
        {c.subtitles.length > 0 && <Sel value="" onChange={(v) => { const i = +v, s = c.subtitles[i]; const text = prompt('Subtitle text (empty = delete)', s.text); if (text === null) return; const d = text ? parseFloat(prompt('Duration in seconds', String(s.d)) ?? String(s.d)) || s.d : 0; up((x) => { if (text) Object.assign(x.subtitles[i], { text, d }); else x.subtitles.splice(i, 1); }); }} options={[['', 'Edit subtitle…'], ...c.subtitles.map((s, i) => [String(i), `${s.t}s ${s.text.slice(0, 24)}`] as const)]} />}
      </div>
      <p className="hint">To start this cinematic in the experience, add an event with the action “Play cinematic”. Player control returns automatically when it ends.</p>
    </div>
  );
}

// ---------------------------------------------------------------- performance

function Performance() {
  const ed = useEd(), [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(i); }, []);
  const s = ed.viewport?.stats, mem = (performance as any).memory;
  if (!s) return null;
  const objs = Object.values(ed.scene.objects), inst = objs.filter((o) => o.kind === 'scatter').reduce((n, o) => n + o.props.items.length / 4, 0);
  const tips = validate(ed, true).filter((i) => i.area === 'Performance' || i.area === 'Optimization').map((i) => i.text);
  if (s.fps < 30) tips.unshift(`The editor is running at ${s.fps.toFixed(0)} FPS. ${s.tris > 1.5e6 ? 'Over 1.5 million triangles are on screen: lower the terrain view distance or thin out scattered vegetation.' : s.calls > 1500 ? 'Too many separate objects are drawn: replace repeated props with the scatter brush.' : 'Try turning off sun shadows in the Atmosphere tab.'}`);
  const cells: [string, string][] = [
    ['FPS', s.fps.toFixed(0)], ['Frame time', `${s.ms.toFixed(1)} ms`], ['Draw calls', String(s.calls)], ['Triangles', s.tris.toLocaleString()],
    ['Objects', `${objs.length}`], ['In view', String(s.inView)], ['Scattered instances', Math.round(inst).toLocaleString()], ['Terrain chunks', `${s.chunks} / ${s.chunkTotal}${s.pending ? ` (+${s.pending} loading)` : ''}`],
    ['Geometries', String(s.geometries)], ['Textures', String(s.textures)], ['Loaded assets', String(Object.keys(ed.scene.assets).length)], ['JS memory', mem ? `${(mem.usedJSHeapSize / 1e6).toFixed(0)} MB` : 'not available in this browser'],
    ['WASM memory', `${(ed.core.ex.memory.buffer.byteLength / 1e6).toFixed(1)} MB`],
  ];
  return (
    <div className="perf">
      <div className="stats">{cells.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
      <div className="tips"><b>Recommendations</b>{tips.length ? <ul>{tips.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="hint">No performance problems detected.</p>}</div>
    </div>
  );
}

export function Bottom({ height }: { height: number }) {
  const [tab, setTab] = useState<'time' | 'events' | 'perf'>('events'), [open, setOpen] = useState(true);
  return (
    <section className="panel bottom" style={{ height: open ? height : 30 }}>
      <nav className="tabs">
        {([['events', 'Events'], ['time', 'Cinematic timeline'], ['perf', 'Performance']] as const).map(([k, l]) => <button key={k} className={tab === k && open ? 'on' : ''} onClick={() => { setTab(k); setOpen(true); }}>{l}</button>)}
        <span className="grow" /><button onClick={() => setOpen(!open)} title={open ? 'Collapse panel' : 'Expand panel'}>{open ? '▾' : '▴'}</button>
      </nav>
      {open && (tab === 'events' ? <Events /> : tab === 'time' ? <Timeline /> : <Performance />)}
    </section>
  );
}
