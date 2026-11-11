// Thin TypeScript wrapper around the Rust/WASM engine core (crates/wander-core).
import wasmUrl from '../wasm/wander_core.wasm?url';

export interface Core {
  ex: any;
  f32(ptr: number, len: number): Float32Array;
  u8(ptr: number, len: number): Uint8Array;
  u32(ptr: number, len: number): Uint32Array;
  /** Copy a typed array into WASM memory; caller frees with `free`. */
  put(data: Float32Array | Uint8Array | Uint8ClampedArray): number;
  alloc(bytes: number): number;
  free(ptr: number, bytes: number): void;
}

let corePromise: Promise<Core> | null = null;

export function loadCore(): Promise<Core> {
  corePromise ??= (async () => {
    let instance: WebAssembly.Instance;
    const res = await fetch(wasmUrl);
    if (!res.ok) throw new Error(`Could not load engine core (${res.status})`);
    try {
      // Requires the application/wasm MIME type (GitHub Pages sends it).
      instance = (await WebAssembly.instantiateStreaming(res.clone(), {})).instance;
    } catch {
      instance = (await WebAssembly.instantiate(await res.arrayBuffer(), {})).instance;
    }
    const ex = instance.exports as any;
    const mem = () => (ex.memory as WebAssembly.Memory).buffer;
    const core: Core = {
      ex,
      // Views are created on demand: the buffer is replaced whenever WASM memory grows.
      f32: (p, n) => new Float32Array(mem(), p, n),
      u8: (p, n) => new Uint8Array(mem(), p, n),
      u32: (p, n) => new Uint32Array(mem(), p, n),
      alloc: (b) => ex.w_alloc(b),
      free: (p, b) => ex.w_free(p, b),
      put(data) {
        const p = ex.w_alloc(data.byteLength);
        new Uint8Array(mem(), p, data.byteLength).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        return p;
      },
    };
    return core;
  })();
  return corePromise;
}
