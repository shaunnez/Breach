import path from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 4310;
const root = path.resolve(__dirname, '../..');

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 480, height: 270 },
    launchOptions: { args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
  },
  outputDir: 'test-results',
  // production artifact: the bundled game server serving the built client on one origin
  webServer: {
    command: 'node apps/server/dist/index.js',
    cwd: root,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT), HOST: '127.0.0.1', STATIC_DIR: path.join(root, 'apps/client/dist'), LOG_LEVEL: 'warn' },
    timeout: 30_000,
  },
});
