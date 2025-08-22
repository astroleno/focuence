import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';

// Plugin to handle service worker environment
const serviceWorkerPlugin = () => {
  return {
    name: 'service-worker-compat',
    generateBundle(options: any, bundle: any) {
      // Fix window references in service worker files
      for (const fileName in bundle) {
        if (fileName === 'storage.js' || fileName === 'background.js') {
          const chunk = bundle[fileName];
          if (chunk.type === 'chunk' && chunk.code) {
            // Replace window references in handlePreloadError with environment check
            chunk.code = chunk.code.replace(
              /function handlePreloadError\(err\) {\s*const e = new Event\("vite:preloadError", {\s*cancelable: true\s*}\);\s*e\.payload = err;\s*window\.dispatchEvent\(e\);\s*if \(!e\.defaultPrevented\) {\s*throw err;\s*}\s*}/g,
              `function handlePreloadError(err) {
    if (typeof window !== 'undefined') {
      const e = new Event("vite:preloadError", { cancelable: true });
      e.payload = err;
      window.dispatchEvent(e);
      if (!e.defaultPrevented) {
        throw err;
      }
    } else {
      throw err;
    }
  }`
            );
          }
        }
      }
    }
  };
};

export default defineConfig({
  plugins: [react(), serviceWorkerPlugin()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/background.ts'),
        debug: resolve(__dirname, 'src/debug.ts'),
        storage: resolve(__dirname, 'src/lib/storage.ts'),
        'attention-graph': resolve(__dirname, 'src/lib/attention-graph.ts'),
        'ai-grouper': resolve(__dirname, 'src/lib/ai-grouper.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return '[name].js';
        },
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        format: 'es',
        inlineDynamicImports: false,
        manualChunks: (id) => {
          // 确保每个entry都是单独的chunk
          if (id.includes('background.ts')) {
            return 'background';
          }
          if (id.includes('debug.ts')) {
            return 'debug';
          }
        }
      },
      external: []
    },
    minify: false,
    sourcemap: false,
    copyPublicDir: false,
    target: 'es2020'
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    global: 'globalThis'
  },
  publicDir: false
});