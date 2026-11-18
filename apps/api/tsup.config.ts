import { defineConfig } from 'tsup';

/** Bundles the API and our workspace packages (TypeScript sources) into dist/. npm dependencies stay external. */
export default defineConfig({
  entry: {
    server: 'src/server.ts',
    worker: 'src/worker.ts',
    migrate: 'src/db/migrate.ts',
    seed: 'src/db/seed.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: [/^@todo\//],
  loader: { '.json': 'json' },
});
