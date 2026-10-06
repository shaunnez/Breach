import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BreachRoom, setRoomTelemetry } from './rooms/BreachRoom';
import type { Telemetry } from './telemetry/telemetry';

export interface ServerConfig {
  port: number;
  host?: string;
  clientOrigin?: string;
  buildSha?: string;
  staticDir?: string;
  telemetry: Telemetry;
}

export interface RunningServer {
  gameServer: Server;
  httpServer: http.Server;
  port: number;
  close(): Promise<void>;
}

export async function createGameServer(cfg: ServerConfig): Promise<RunningServer> {
  const { telemetry } = cfg;
  const buildSha = cfg.buildSha ?? 'dev';
  setRoomTelemetry(telemetry);

  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    res.json({ ok: true, build: buildSha, uptimeSec: Math.round(process.uptime()), rooms: matchMaker.stats.local.roomCount, ccu: matchMaker.stats.local.ccu });
  });
  app.get('/debug/telemetry', (_req, res) => {
    res.json({ build: buildSha, summary: telemetry.summary(), counters: telemetry.snapshot(), recent: telemetry.recent.slice(-50) });
  });

  // Optional: serve the built client from the same service (single-service deploy / local prod check).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = cfg.staticDir ?? path.resolve(here, '../../client/dist');
  if (fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { maxAge: '1h', index: 'index.html' }));
    app.get(['/play', '/play/*'], (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
    telemetry.info('static-client', { staticDir });
  }

  const httpServer = http.createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer, pingInterval: 5000, pingMaxRetries: 3 }) });
  gameServer.define('breach', BreachRoom);

  if (cfg.clientOrigin) {
    const allowed = cfg.clientOrigin.split(',').map((s) => s.trim());
    matchMaker.controller.getCorsHeaders = (req: any) => {
      const origin = (req.headers && req.headers['origin']) || '';
      return { 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] };
    };
  }

  await gameServer.listen(cfg.port, cfg.host ?? '0.0.0.0');
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
  telemetry.info('server-listening', { port, build: buildSha, node: process.version });
  return {
    gameServer,
    httpServer,
    port,
    close: async () => {
      await gameServer.gracefullyShutdown(false).catch(() => {});
    },
  };
}
