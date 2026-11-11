// Copies the compiled engine core next to the TypeScript sources so Vite can bundle it.
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
const src = 'crates/wander-core/target/wasm32-unknown-unknown/release/wander_core.wasm';
mkdirSync('src/wasm', { recursive: true });
copyFileSync(src, 'src/wasm/wander_core.wasm');
console.log(`wander_core.wasm -> src/wasm (${(statSync(src).size / 1024).toFixed(1)} kB)`);

// Draco decoder: only the editor needs it (compressed models are decompressed once, at import).
mkdirSync('public/draco', { recursive: true });
for (const f of ['draco_decoder.wasm', 'draco_wasm_wrapper.js', 'draco_decoder.js']) copyFileSync(`node_modules/three/examples/jsm/libs/draco/gltf/${f}`, `public/draco/${f}`);
