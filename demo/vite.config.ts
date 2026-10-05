import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = (path: string): string => fileURLToPath(new URL(`../src/${path}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [
      { find: /^pollyroll$/, replacement: src('index.ts') },
      { find: /^pollyroll\/render$/, replacement: src('render/index.ts') },
      { find: /^pollyroll\/react$/, replacement: src('react/index.ts') },
    ],
  },
});
