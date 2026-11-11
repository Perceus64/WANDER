import { createRoot } from 'react-dom/client';
import { loadCore } from './engine/wasm';
import { Editor } from './editor/editor';
import { App } from './ui/App';
import './styles.css';

const root = document.getElementById('root')!;
root.innerHTML = '<div class="boot">Loading WANDER…</div>';

loadCore()
  .then((core) => {
    const ed = new Editor(core);
    (window as any).wanderEditor = ed; // handy for support and automated tests
    root.innerHTML = '';
    createRoot(root).render(<App ed={ed} />);
  })
  .catch((e) => {
    console.error(e);
    root.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'boot';
    d.textContent = `WANDER could not start: ${e?.message ?? e}. A browser with WebAssembly and WebGL2 is required.`;
    root.appendChild(d);
  });
