import { defineConfig } from 'vite';

// Builds the standalone player (what PUBLISH ships) into public/runtime with
// stable file names: player.js + wander_core.wasm. The editor fetches these
// two files at publish time and zips them together with the project data.
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: 'public/runtime',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: 'src/player.ts',
      output: {
        format: 'es',
        entryFileNames: 'player.js',
        assetFileNames: '[name][extname]',
        inlineDynamicImports: true,
      },
    },
  },
});
