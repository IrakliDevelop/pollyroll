import { defineConfig } from 'tsup';

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
});
