import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

declare global {
  interface Window {
    __breach: any;
  }
}

// Software WebGL render loops are CPU-heavy: every context must be closed when its test ends or later tests starve.
const opened: BrowserContext[] = [];
test.afterEach(async () => {
  for (const c of opened.splice(0)) await c.close();
});

async function newPlayer(browser: Browser, name: string, query = ''): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  opened.push(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(`/play?${query}`);
  await page.fill('[data-testid=name]', name);
  return page;
}

async function startMatch(browser: Browser, opts: { dev?: boolean; lag?: number; aClass?: 'marine' | 'ripper' | 'weaver'; bClass?: 'marine' | 'ripper' | 'weaver' } = {}) {
  const q = [opts.dev ? 'dev=1' : '', opts.lag ? `lag=${opts.lag}&jitter=${Math.round(opts.lag / 5)}` : ''].filter(Boolean).join('&');
  const a = await newPlayer(browser, 'Alice', q);
  await a.click('[data-testid=create]');
  await a.waitForSelector('[data-testid=roomcode]');
  const code = (await a.textContent('[data-testid=roomcode]'))!.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  const b = await newPlayer(browser, 'Bob', q + `&room=${code}`);
  await b.click('[data-testid=join]');
  await b.waitForSelector('[data-testid=roomcode]');
  await a.click(`[data-testid=pick-${opts.aClass ?? 'marine'}]`);
  await b.click(`[data-testid=pick-${opts.bClass ?? 'ripper'}]`);
  await expect(a.locator('table.players tbody tr')).toHaveCount(2);
  await a.click('[data-testid=start]');
  await a.waitForSelector('[data-testid=clickplay]');
  await b.waitForSelector('[data-testid=clickplay]');
  await a.click('[data-testid=clickplay]');
  await b.click('[data-testid=clickplay]');
  await a.waitForFunction(() => window.__breach?.ctrl);
  await b.waitForFunction(() => window.__breach?.ctrl);
  return { a, b, code };
}

const surfaceOf = (p: Page) => p.evaluate(() => window.__breach.ctrl.sim.surface as number);

test('two remote browsers join one room, start, and see each other', async ({ browser }) => {
  const { a, b } = await startMatch(browser);
  const players = (p: Page) => p.evaluate(() => window.__breach.view.players.map((x: any) => ({ name: x.name, cls: x.sim.cls, alive: x.alive })));
  const pa = await players(a);
  expect(pa).toHaveLength(2);
  expect(pa.map((x: any) => x.cls).sort()).toEqual([0, 1]);
  await a.keyboard.down('Tab');
  await expect(a.locator('[data-testid=scoreboard]')).toBeVisible();
  await a.keyboard.up('Tab');
  // movement replicates: Alice (marine) walks; Bob's remote view of Alice moves
  const before = await b.evaluate(() => window.__breach.remotes.values().next().value.buffer.latest().sim.pz);
  await a.keyboard.down('KeyW');
  await b.waitForFunction((z0) => Math.abs(window.__breach.remotes.values().next().value.buffer.latest().sim.pz - z0) > 0.4, before, { timeout: 30_000 });
  await a.keyboard.up('KeyW');
});

test('marine kills a ripper with server-authoritative rifle fire; death + respawn replicate', async ({ browser }) => {
  const { a, b } = await startMatch(browser, { dev: true });
  // known open ground with 4 m of clear floor in front (junction, facing east), independent of which spawn we got
  await a.evaluate(() => window.__breach.net.dev({ action: 'teleport', room: 'junction' }));
  await a.waitForTimeout(800);
  await a.evaluate(() => window.__breach.net.dev({ action: 'spawnDummy', cls: 1 }));
  await a.waitForFunction(() => window.__breach.view.players.some((p: any) => p.dummy));
  await a.evaluate(() => {
    const rt = window.__breach;
    rt.input.onLook = () => {};
    rt.assist.reset(rt.ctrl.sim.yaw, -0.33);
  });
  await a.mouse.down();
  await a.waitForFunction(() => window.__breach.view.players.find((p: any) => p.dummy)?.alive === false, undefined, { timeout: 90_000 });
  await a.mouse.up();
  const me = await a.evaluate(() => window.__breach.view.players.find((p: any) => p.id === window.__breach.net.sessionId));
  expect(me.kills).toBe(1);
  // dummy respawns after the 4 s timer
  await a.waitForFunction(() => window.__breach.view.players.find((p: any) => p.dummy)?.alive === true, undefined, { timeout: 90_000 });
  void b;
});

test('ripper climbs a wall and crosses onto the ceiling with WASD + F (cling) + the view assist', async ({ browser }) => {
  const { a } = await startMatch(browser, { dev: true, aClass: 'ripper', bClass: 'marine' });
  await a.evaluate(() => window.__breach.net.dev({ action: 'teleport', room: 'junction' }));
  await a.waitForTimeout(800);
  await a.evaluate(() => {
    window.__breach.input.onLook = () => {};
    window.__breach.assist.reset(Math.PI, 0); // face the south wall
  });
  await a.keyboard.down('KeyF'); // hold cling
  await a.keyboard.down('KeyW');
  const seen = new Set<number>();
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000 && !(seen.has(1) && seen.has(2))) {
    seen.add(await surfaceOf(a));
    await a.waitForTimeout(100);
  }
  await a.keyboard.up('KeyW');
  await a.keyboard.up('KeyF');
  expect(seen.has(1)).toBe(true); // wall
  expect(seen.has(2)).toBe(true); // ceiling
  const recon = await a.evaluate(() => window.__breach.ctrl.stats.reconciliations);
  expect(recon).toBeLessThanOrEqual(2);
});

test('a page reload resumes the same seat (reconnect token)', async ({ browser }) => {
  const { a, b } = await startMatch(browser);
  const idBefore = await b.evaluate(() => window.__breach.net.sessionId);
  await b.reload();
  await b.waitForFunction(() => window.__breach?.ctrl, undefined, { timeout: 40_000 });
  const idAfter = await b.evaluate(() => window.__breach.net.sessionId);
  expect(idAfter).toBe(idBefore);
  const count = await a.evaluate(() => window.__breach.view.players.length);
  expect(count).toBe(2);
});

test('with 100 ms simulated RTT the predicted player stays in agreement with the server', async ({ browser }) => {
  const { a } = await startMatch(browser, { dev: true, lag: 100, aClass: 'ripper', bClass: 'marine' });
  await a.evaluate(() => window.__breach.net.dev({ action: 'teleport', room: 'junction' }));
  await a.waitForTimeout(1500);
  await a.evaluate(() => {
    window.__breach.input.onLook = () => {};
    window.__breach.assist.reset(Math.PI, 0);
  });
  await a.keyboard.down('KeyW');
  await a.waitForTimeout(8000);
  await a.keyboard.up('KeyW');
  const s = await a.evaluate(() => ({ ...window.__breach.ctrl.stats, rtt: window.__breach.net.clock.rtt }));
  expect(s.rtt).toBeGreaterThan(70);
  expect(s.maxErrorM).toBeLessThan(0.05);
  expect(s.surfaceBreaks).toBe(0);
});

// ---- VS02: Strategy Truth Slice ---------------------------------------------------------------

const economy = (p: Page) => p.evaluate(() => window.__breach.view.economy as { resources: number[]; income: number[]; structures: { type: string; state: number; progress: number; hp: number }[]; commanderId: string });

test('Commander enters at the console (E), places an Extractor on the well, it builds and pays income', async ({ browser }) => {
  const { a } = await startMatch(browser, { dev: true, aClass: 'marine', bClass: 'ripper' });
  await a.evaluate(() => window.__breach.net.dev({ action: 'teleport', room: 'console' }));
  await a.waitForFunction(() => Math.hypot(window.__breach.ctrl.sim.px - 6, window.__breach.ctrl.sim.pz - 2.6) < 0.2);
  await expect(a.locator('[data-testid=prompt]')).toContainText('Command Core');
  await a.keyboard.press('KeyE');
  await a.waitForFunction(() => window.__breach.me?.commanding === true);
  await expect(a.locator('[data-testid=commander]')).toBeVisible();
  expect((await economy(a)).commanderId).toBe(await a.evaluate(() => window.__breach.net.sessionId));
  // hologram placement: open build mode, then click the well where the overhead camera projects it
  await a.click('[data-testid=build-extractor]');
  await a.waitForTimeout(300);
  const pt = await a.evaluate(() => {
    const rt = window.__breach;
    const cam = rt.renderer.camera;
    const v = cam.position.clone().set(30, 0.5, 16).project(cam);
    const r = rt.renderer.gl.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  });
  await a.mouse.click(pt.x, pt.y);
  await a.waitForFunction(() => window.__breach.view.economy.structures.length === 1);
  const e1 = await economy(a);
  expect(e1.structures[0].type).toBe('extractor');
  expect(e1.resources[0]).toBeLessThan(10.5); // 20 - 10, plus no income while building
  // 6 s build, then +0.6/s
  await a.waitForFunction(() => window.__breach.view.economy.structures[0]?.state === 1, undefined, { timeout: 30_000 });
  await a.waitForFunction(() => window.__breach.view.economy.resources[0] > 11, undefined, { timeout: 30_000 });
  expect((await economy(a)).income[0]).toBeCloseTo(0.6, 5);
  await expect(a.locator('[data-testid=well]')).toContainText('ours');
  // leave the Command Core with E
  await a.keyboard.press('KeyE');
  await a.waitForFunction(() => window.__breach.me?.commanding === false);
});

test('Weaver walks to the well and grows a Harvester with E; the Bloom earns from it', async ({ browser }) => {
  const { b } = await startMatch(browser, { dev: true, aClass: 'marine', bClass: 'weaver' });
  expect(await b.evaluate(() => window.__breach.ctrl.sim.cls)).toBe(2);
  await b.evaluate(() => window.__breach.net.dev({ action: 'teleport', room: 'well' }));
  await b.waitForFunction(() => Math.hypot(window.__breach.ctrl.sim.px - 27.6, window.__breach.ctrl.sim.pz - 16) < 0.2);
  await expect(b.locator('[data-testid=prompt]')).toContainText('Harvester');
  await b.keyboard.press('KeyE');
  await b.waitForFunction(() => window.__breach.view.economy.structures[0]?.type === 'harvester');
  expect((await economy(b)).resources[1]).toBeLessThan(10.5);
  await b.waitForFunction(() => window.__breach.view.economy.resources[1] > 11, undefined, { timeout: 30_000 });
  await expect(b.locator('[data-testid=well]')).toContainText('ours Harvester');
});
