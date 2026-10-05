import { readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

/** React entry outputs that Next.js App Router must see as client modules. */
const CLIENT_FILES = ['dist/react.js', 'dist/react.cjs'];

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    render: 'src/render/index.ts',
    react: 'src/react/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  clean: true,
  splitting: true,
  treeshake: true,
  sourcemap: false,
  target: 'es2022',
  platform: 'neutral',
  external: ['react', 'pollyroll', 'pollyroll/render'],
  // Tree-shaking (rollup) strips module directives and banners, so the react entry gets its
  // "use client" directive after every format is written.
  async onSuccess() {
    for (const file of CLIENT_FILES) {
      const code = await readFile(file, 'utf8');
      if (!code.startsWith("'use client';")) await writeFile(file, `'use client';\n${code}`);
    }
  },
});
