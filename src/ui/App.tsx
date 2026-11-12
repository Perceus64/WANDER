import { useEffect, useRef, useState } from 'react';
import { Viewport } from '../editor/viewport';
import type { Editor, Tool } from '../editor/editor';
import { getMeta, setMeta } from '../editor/storage';
import { Runtime } from '../engine/runtime';
import { Bottom } from './Bottom';
import { Inspector } from './Inspector';
import { Left } from './Left';
import { GeoWizard, HelpModal, ProjectsModal, PublishModal, VersionsModal } from './Modals';
import { Btn, EdCtx, Num, useEd } from './widgets';

type ModalKey = 'projects' | 'geo' | 'publish' | 'help' | 'versions' | null;
const TOOLS: [Tool, string, string, string][] = [['select', '⬚', 'Select', 'Q'], ['move', '✥', 'Move', 'W'], ['rotate', '⟳', 'Rotate', 'E'], ['scale', '⤢', 'Scale', 'R']];
const HINT: Record<Tool, string> = {
  select: 'Click to select · click again to go inside a group · Shift+click adds · drag to orbit · right-drag + WASD to fly',
  move: 'Drag the arrows to move · turn on Snap for grid steps', rotate: 'Drag a ring to rotate', scale: 'Drag a handle to resize',
  sculpt: 'Drag on the terrain to sculpt · Shift inverts · Alt+drag orbits', paint: 'Drag on the terrain to paint the selected material · Alt+drag orbits',
  scatter: 'Drag to scatter · Shift+drag erases · Alt+drag orbits', wall: 'Click to place wall corners · double-click or Enter to finish · Esc cancels',
  room: 'Drag a rectangle to create a room', road: 'Click to add points · double-click or Enter to finish · Esc cancels',
  mesh: 'Mesh editor: click to pick · Shift+click adds · double-click selects the flat area · drag the gizmo to move · Shift+drag extrudes · 1/2/3 vertex/edge/face · Esc finishes',
};

function Shell() {
  const ed = useEd();
  const vpEl = useRef<HTMLDivElement>(null), playEl = useRef<HTMLDivElement>(null), rt = useRef<Runtime | null>(null);
  const [modal, setModal] = useState<ModalKey>(null), [playing, setPlaying] = useState<false | 'window' | 'full'>(false), [ready, setReady] = useState(false), [hasProject, setHasProject] = useState(false);

  useEffect(() => {
    const vp = new Viewport(ed, vpEl.current!);
    (async () => {
      const last = await getMeta<string>('last').catch(() => undefined);
      if (last && (await ed.open(last).catch(() => false))) { setHasProject(true); ed.toast(`Reopened “${ed.project.name}” where you left off`); }
      else setModal('projects');
      setReady(true);
    })();
    return () => vp.dispose();
  }, [ed]);

  useEffect(() => {
    if (!playing || !playEl.current || !ed.viewport) return;
    ed.viewport.paused = true;
    const d = ed.playData();
    const r = new Runtime({ container: playEl.current, project: d.project, assets: ed.assets, core: ed.core, terrain: d.terrain, onExit: () => setPlaying(false) });
    rt.current = r;
    (window as any).wanderRuntime = r;
    r.start().catch((e) => { console.error(e); ed.toast(`Play mode failed: ${e?.message ?? e}`, 'error'); setPlaying(false); });
    if (playing === 'full') playEl.current.requestFullscreen?.().catch(() => {});
    return () => {
      r.dispose(); rt.current = null;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (ed.viewport) ed.viewport.paused = false;
    };
  }, [playing, ed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); ed.save('Manual save').then(() => ed.toast('Saved', 'ok')).catch(() => {}); return; }
      if (playing || modal || typing) return;
      if (e.key === 'F5') { e.preventDefault(); setPlaying('window'); return; }
      if (mod) {
        if (k === 'z') { e.preventDefault(); e.shiftKey ? ed.redo() : ed.undo(); }
        else if (k === 'y') { e.preventDefault(); ed.redo(); }
        else if (k === 'd') { e.preventDefault(); ed.duplicate(); }
        else if (k === 'c') ed.copy();
        else if (k === 'v') ed.paste();
        else if (k === 'g') { e.preventDefault(); ed.group(); }
        else if (k === 'a') { e.preventDefault(); if (ed.tool === 'mesh') ed.viewport?.mesh.selectAll(); else ed.select(ed.scene.roots.filter((id) => !ed.obj(id)?.locked)); }
        return;
      }
      if (ed.viewport?.flying) return;
      if (ed.tool === 'mesh') {
        const me = ed.viewport!.mesh;
        if (k === '1') me.setMode('vertex'); else if (k === '2') me.setMode('edge'); else if (k === '3') me.setMode('face');
        else if (k === 'w') me.setGizmo('translate'); else if (k === 'e') me.setGizmo('rotate'); else if (k === 'r') me.setGizmo('scale');
        else if (k === 'x') me.extrude(0.5); else if (k === 'i') me.inset(0.2);
        else if (k === 'delete' || k === 'backspace') me.remove();
        else if (k === 'escape' || k === 'enter') ed.stopMeshEdit();
        else if (k === 'f') ed.viewport?.focus();
        return;
      }
      if (k === 'q') ed.setTool('select'); else if (k === 'w') ed.setTool('move'); else if (k === 'e') ed.setTool('rotate'); else if (k === 'r') ed.setTool('scale');
      else if (k === 'f') ed.viewport?.focus();
      else if (k === 'delete' || k === 'backspace') ed.remove();
      else if (k === 'enter') ed.viewport?.finishTool();
      else if (k === 'escape') { if (ed.viewport?.drawing) ed.viewport.cancelTool(); else if (ed.tool !== 'select') ed.setTool('select'); else ed.select([]); }
    };
    window.addEventListener('keydown', onKey);
    const warn = (e: BeforeUnloadEvent) => { if (ed.dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', warn); };
  }, [ed, playing, modal]);

  const closeProjects = async () => {
    setModal(null); setHasProject(true);
    if (!(await getMeta('helpSeen').catch(() => true))) { setMeta('helpSeen', true); setModal('help'); }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const d = e.dataTransfer.getData('application/wander');
    if (d) ed.dropAsset(JSON.parse(d), e.clientX, e.clientY);
    else if (e.dataTransfer.files.length) ed.importFiles(e.dataTransfer.files);
  };
  const o = ed.opts;

  return (
    <div className="app" onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={(e) => { if (e.dataTransfer.files.length && !e.defaultPrevented) { e.preventDefault(); ed.importFiles(e.dataTransfer.files); } }}>
      <header className="toolbar">
        <span className="logo" title="WANDER — Build worlds. Tell stories. Let people explore.">▲ WANDER</span>
        <Btn tip="New project / open project / templates / import" onClick={() => setModal('projects')}>Projects</Btn>
        <input className="in pname" value={ed.project.name} title="Project name" aria-label="Project name" onChange={(e) => { ed.project.name = e.target.value; ed.touch(); }} />
        <Btn tip="Save now and store a version (Ctrl+S). Changes are also autosaved." onClick={() => ed.save('Manual save').then(() => ed.toast('Saved', 'ok')).catch(() => {})}>{ed.saving ? 'Saving…' : ed.dirty ? 'Save •' : 'Saved'}</Btn>
        <Btn kind="icon" tip="Version history" onClick={() => setModal('versions')}>🕘</Btn>
        <span className="sep" />
        <Btn kind="icon" tip="Undo (Ctrl+Z)" disabled={!ed.canUndo} onClick={() => ed.undo()}>↶</Btn>
        <Btn kind="icon" tip="Redo (Ctrl+Shift+Z)" disabled={!ed.canRedo} onClick={() => ed.redo()}>↷</Btn>
        <span className="sep" />
        {TOOLS.map(([t, icon, label, key]) => <Btn key={t} active={ed.tool === t} tip={`${label} (${key})`} onClick={() => ed.setTool(t)}>{icon} {label}</Btn>)}
        <span className="sep" />
        <Btn active={o.snap} tip="Snap to grid while moving, rotating (15°) and drawing" onClick={() => { o.snap = !o.snap; ed.viewport?.onToolChange(); ed.emit(); }}>⌗ Snap</Btn>
        {o.snap && <Num value={o.grid} min={0.05} step={0.25} w={56} onChange={(v) => { o.grid = v; ed.viewport?.onToolChange(); ed.emit(); }} />}
        <Btn active={o.surfaceSnap} tip="Dropped objects land on top of other objects (off = always on the ground)" onClick={() => { o.surfaceSnap = !o.surfaceSnap; ed.emit(); }}>⤓ Surface</Btn>
        <Btn kind="icon" tip="Focus selection (F) – or the whole world" onClick={() => (ed.selection.length ? ed.viewport?.focus() : ed.viewport?.frameAll())}>◎</Btn>
        <span className="grow" />
        {!playing ? <>
          <Btn kind="play" tip="Play from the player spawn (F5)" onClick={() => setPlaying('window')}>▶ Play</Btn>
          <Btn tip="Preview full screen, as visitors will see it" onClick={() => setPlaying('full')}>⛶ Preview</Btn>
        </> : <>
          <Btn tip="Pause" onClick={() => rt.current?.pause()}>❚❚ Pause</Btn>
          <Btn kind="danger" tip="Stop and return to the editor" onClick={() => setPlaying(false)}>■ Stop</Btn>
        </>}
        <Btn kind="primary" tip="Validate and build a standalone website" onClick={() => setModal('publish')}>Publish</Btn>
        <Btn kind="icon" tip="Help, tutorial and shortcuts" onClick={() => setModal('help')}>?</Btn>
      </header>
      <div className="main">
        <Left openGeo={() => setModal('geo')} />
        <div className="center">
          <div className="viewport" ref={vpEl} onDragOver={(e) => { if (e.dataTransfer.types.includes('application/wander') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }} onDrop={onDrop}>
            {!ready && <div className="boot">Starting engine…</div>}
            {ready && hasProject && !playing && <div className="hintbar">{HINT[ed.tool]}</div>}
            {playing && <div className="playbox" ref={playEl} />}
          </div>
          <Bottom height={270} />
        </div>
        <Inspector />
      </div>
      <div className="toasts">{ed.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
      {modal === 'projects' && <ProjectsModal canClose={hasProject} onClose={closeProjects} />}
      {modal === 'geo' && <GeoWizard onClose={() => setModal(null)} />}
      {modal === 'publish' && <PublishModal onClose={() => setModal(null)} />}
      {modal === 'help' && <HelpModal onClose={() => setModal(null)} />}
      {modal === 'versions' && <VersionsModal onClose={() => setModal(null)} />}
    </div>
  );
}

export function App({ ed }: { ed: Editor }) {
  return <EdCtx.Provider value={ed}><Shell /></EdCtx.Provider>;
}
