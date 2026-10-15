import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Each project owns its runtime environment and `npm test` runs every project.
// - `server` boots the Fastify API in-process against an isolated SQLite file per test file.
// - `client` renders React components in jsdom with the API module mocked.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['server/**', 'shared/**', 'src/**'],
      // Process entry points and type-only modules have no testable behaviour.
      exclude: ['server/index.ts', 'src/main.tsx', 'src/vite-env.d.ts', '**/types.ts'],
      reporter: ['text', 'html'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
          setupFiles: ['tests/server/setup/environment.ts'],
          testTimeout: 15_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          // Creating a jsdom window per test file cost more than the tests themselves. `vmThreads`
          // builds it once per worker and runs each file in its own VM context, so files stay
          // isolated (fresh module registry, mocks, and DOM state) without paying for a new window.
          pool: 'vmThreads',
          include: ['tests/client/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/client/setup/environment.ts'],
          // User-event interactions through jsdom are slow on constrained machines.
          testTimeout: 15_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
