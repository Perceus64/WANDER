// Standalone player entry: this is what a published WANDER experience runs.
// It needs only this bundle, wander_core.wasm, project.json and assets/.
import { Runtime } from './engine/runtime';
import { loadCore } from './engine/wasm';
import { migrate, type AssetProvider } from './engine/types';

async function main() {
  const container = document.getElementById('wander') ?? document.body;
  try {
    const [core, res] = await Promise.all([loadCore(), fetch('project.json')]);
    if (!res.ok) throw new Error(`project.json not found (${res.status})`);
    const project = migrate(await res.json());
    document.title = project.name;
    const assets: AssetProvider = {
      url: async (key) => (key ? `assets/${key}` : null),
      bin: async (key) => { const r = await fetch(`assets/${key}`); return r.ok ? r.arrayBuffer() : null; },
    };
    const rt = new Runtime({ container, project, assets, core });
    document.getElementById('splash')?.remove();
    (window as any).wander = rt;
    await rt.start();
  } catch (e: any) {
    console.error(e);
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#111;color:#eee;font:16px system-ui;padding:24px;text-align:center';
    d.textContent = `This experience could not start: ${e?.message ?? e}. Published builds must be served over http(s), not opened as a local file.`;
    document.body.appendChild(d);
  }
}
main();
