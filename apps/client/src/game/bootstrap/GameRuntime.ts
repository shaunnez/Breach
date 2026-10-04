import * as THREE from 'three';
import {
  BITE,
  MARINE,
  NET,
  PlayerClass,
  RIFLE,
  RIPPER,
  SURFACE_NAMES,
  SurfaceState,
  SurfaceViewAssist,
  TICK_DT,
  TICK_MS,
  biteOrigin,
  clonePlayerSim,
  createTestCellA,
  eyePosition,
  hurtCapsule,
  MARINE_SPAWNS,
  BLOOM_SPAWNS,
  shotRay,
  viewDir,
  VENT_PATH,
  type GameEvent,
  type PlayerSim,
  type StepResult,
} from '@breach/shared';
import { GameRenderer } from '../render/Renderer';
import { MapView } from '../map/MapView';
import { InputController } from '../input/InputController';
import { CameraRig } from '../camera/CameraRig';
import { DebugDraw } from '../debug/DebugDraw';
import { PredictionController } from '../network/PredictionController';
import type { GameNetClient } from '../network/GameNetClient';
import type { MatchView, PlayerSnapshot } from '../network/types';
import { RemoteEntity, type AvatarLike } from '../entities/RemotePlayers';
import { getState, setState, emptyHud, type DebugState, type HudState } from '../../app/store';
import { Fx } from '../combat/Fx';
import { AudioEngine } from '../audio/AudioEngine';
import { makeAvatar } from '../entities/Avatar';
import { FirstPersonView } from '../entities/FirstPersonView';

export const DEBUG_TOGGLES = ['colliders', 'hurtVolumes', 'hitRays', 'biteSweep', 'surfaceProbes', 'traversalProbes', 'spawnVolumes', 'interpGhosts'] as const;
export type DebugToggle = (typeof DEBUG_TOGGLES)[number];

interface RayRec {
  at: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  color: number;
}

/**
 * Orchestrates one in-match session: render loop, fixed 60 Hz prediction, input, camera,
 * remote interpolation, FX/audio and debug visualisation. Authority stays on the server:
 * this class only sends input frames and presents what the server confirms.
 */
export class GameRuntime {
  readonly renderer: GameRenderer;
  readonly world = createTestCellA();
  private map = new MapView();
  private input: InputController;
  private cam = new CameraRig();
  private ctrl: PredictionController | null = null;
  private assist = new SurfaceViewAssist();
  private remotes = new Map<string, RemoteEntity>();
  private fx: Fx;
  readonly audio = new AudioEngine();
  private fpv: FirstPersonView;
  private debugDraw = new DebugDraw();
  private raf = 0;
  private lastFrame = performance.now();
  private acc = 0;
  private running = false;
  private view: MatchView | null = null;
  private me: PlayerSnapshot | null = null;
  private localCls: PlayerClass = PlayerClass.Marine;
  private lastCls = -1;
  private hitAt = 0;
  private hitKind: HudState['hitKind'] = '';
  private damageFlashAt = 0;
  private damageDirs: { at: number; angle: number }[] = [];
  private killId = 0;
  private lastHudAt = 0;
  private reconWindow: number[] = [];
  private lastShotText = '—';
  private rays: RayRec[] = [];
  private biteViz: { at: number; a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  readonly toggles: Record<DebugToggle, boolean> = { colliders: false, hurtVolumes: false, hitRays: false, biteSweep: false, surfaceProbes: false, traversalProbes: false, spawnVolumes: false, interpGhosts: false };
  private offset = new THREE.Vector3();
  private deathPos = new THREE.Vector3();
  private deathYaw = 0;
  private deadFor = 0;
  private lastFootstep = 0;
  private lastTelemetry = 0;
  private telemetryRec = 0;
  private telemetryReasons: Record<string, number> = {};
  private telemetryErrSum = 0;
  private telemetryErrN = 0;
  private telemetryErrMax = 0;
  private lastRecTotal = 0;
  private wasAlive = false;
  private frameCount = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly net: GameNetClient,
    private readonly dev: boolean,
  ) {
    this.renderer = new GameRenderer(canvas);
    this.renderer.scene.add(this.map.group);
    this.renderer.scene.add(this.debugDraw.object);
    this.fx = new Fx(this.renderer.scene);
    this.fpv = new FirstPersonView(this.renderer.camera);
    this.input = new InputController(canvas);
    this.input.onLook = (dx, dy) => this.assist.look(-dx, -dy);
    this.input.onLockChange = (l) => {
      setState((s) => ({ hud: { ...s.hud, locked: l } }));
      if (l) this.audio.resume();
    };
    this.input.onKey = (code, down) => this.onKey(code, down);
    this.input.attach();
    try {
      this.assist.enabled = localStorage.getItem('breach.viewAssist') !== '0';
    } catch {}
    (window as any).__breach = this; // handy for devtools + e2e
  }

  // ---- lifecycle --------------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(performance.now());
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.audio.dispose();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.fx.dispose();
    this.map.dispose();
    this.renderer.dispose();
    if ((window as any).__breach === this) delete (window as any).__breach;
  }

  requestLock(): void {
    this.input.requestLock();
    this.audio.resume();
  }

  get isLocked(): boolean {
    return this.input.locked;
  }

  setViewAssist(on: boolean): void {
    this.assist.enabled = on;
    try {
      localStorage.setItem('breach.viewAssist', on ? '1' : '0');
    } catch {}
  }

  private onKey(code: string, down: boolean): void {
    if (code === 'Tab') setState({ scoreboard: down });
    if (!down) return;
    if (code === 'KeyV') {
      this.setViewAssist(!this.assist.enabled);
      this.notice(`Surface view assist ${this.assist.enabled ? 'ON' : 'OFF'}`);
    }
    if (code === 'F3' || code === 'Backquote') {
      if (this.dev) setState((s) => ({ debug: s.debug ? null : this.debugState() }));
    }
    if (code === 'KeyM') this.audio.toggleMute();
  }

  private notice(text: string): void {
    setState({ notice: { text, at: performance.now() } });
  }

  // ---- network ingestion ------------------------------------------------------------------------

  onMatch(view: MatchView): void {
    this.view = view;
    const myId = this.net.sessionId;
    const seen = new Set<string>();
    for (const p of view.players) {
      seen.add(p.id);
      if (p.id === myId) {
        this.onLocalSnapshot(p);
        continue;
      }
      let r = this.remotes.get(p.id);
      if (!r) {
        r = new RemoteEntity(p.id, p.sim.cls, (c) => makeAvatar(c) as AvatarLike, this.renderer.scene);
        this.remotes.set(p.id, r);
      }
      r.setClass(p.sim.cls);
      r.buffer.push(p);
      r.snapshot = p;
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) {
        r.dispose();
        this.remotes.delete(id);
      }
    }
  }

  private onLocalSnapshot(p: PlayerSnapshot): void {
    this.me = p;
    if (view_isPlaying(this.view)) {
      if (p.alive) {
        if (!this.ctrl) {
          this.ctrl = new PredictionController(this.world, p.sim);
          this.ctrl.reset(p.sim, p.epoch, p.ack);
          this.assist.reset(p.sim.yaw, p.sim.pitch);
          this.cam.reset(p.sim);
        } else {
          const classChanged = p.sim.cls !== this.ctrl.sim.cls;
          const wasEpoch = this.ctrl.epoch;
          const rep = this.ctrl.onServerState(p.sim, p.ack, p.epoch);
          if (rep.reconciled) {
            this.reconWindow.push(performance.now());
            this.telemetryRec++;
            this.telemetryReasons[rep.reason || 'unknown'] = (this.telemetryReasons[rep.reason || 'unknown'] ?? 0) + 1;
          }
          if (this.ctrl.epoch !== wasEpoch || classChanged) {
            // respawn / teleport / class change: reset the view onto the new transform
            this.assist.reset(p.sim.yaw, p.sim.pitch);
            this.cam.reset(p.sim);
            this.fpv.reset();
            if (rep.hard) this.fx.spawnCue(new THREE.Vector3(p.sim.px, p.sim.py, p.sim.pz));
          }
          this.telemetryErrSum += rep.errorM;
          this.telemetryErrN++;
          this.telemetryErrMax = Math.max(this.telemetryErrMax, rep.errorM);
        }
        this.localCls = p.sim.cls;
      }
    }
  }

  onEvent(ev: GameEvent): void {
    const myId = this.net.sessionId;
    const now = performance.now();
    switch (ev.t) {
      case 'fire': {
        const a = new THREE.Vector3(ev.ox, ev.oy, ev.oz);
        const b = new THREE.Vector3(ev.ex, ev.ey, ev.ez);
        this.rays.push({ at: now, a, b, color: 0xff8a00 });
        if (ev.shooter !== myId) {
          this.fx.tracer(this.muzzleFor(ev.shooter, a), b, 0xffd27a);
          this.fx.muzzleFlash(this.muzzleFor(ev.shooter, a));
          if (ev.hit === 1) this.fx.sparks(b, new THREE.Vector3(-ev.dx, -ev.dy, -ev.dz), 0xffc266);
          this.audio.rifle(a, false, this.listenerPos());
        } else if (ev.hit === 1) {
          this.fx.sparks(b, new THREE.Vector3(-ev.dx, -ev.dy, -ev.dz), 0xffc266);
        }
        break;
      }
      case 'bite': {
        const a = new THREE.Vector3(ev.ox, ev.oy, ev.oz);
        const d = new THREE.Vector3(ev.dx, ev.dy, ev.dz);
        this.biteViz.push({ at: now, a, b: a.clone().addScaledVector(d, BITE.reach - BITE.sweepRadius) });
        if (ev.shooter !== myId) {
          this.fx.biteSwipe(a, d);
          this.audio.bite(a, this.listenerPos());
          const r = this.remotes.get(ev.shooter);
          r?.avatar.setFlash?.(1);
        }
        break;
      }
      case 'hit': {
        const p = new THREE.Vector3(ev.px, ev.py, ev.pz);
        if (ev.shooter === myId) {
          this.hitAt = now;
          this.hitKind = ev.killed ? 'kill' : ev.armourDmg > 0 && ev.dmg === 0 ? 'armour' : 'flesh';
          this.audio.hitMarker(ev.killed, this.hitKind === 'armour');
        }
        if (ev.target === myId) {
          this.damageFlashAt = now;
          const src = this.remotes.get(ev.shooter)?.lastInterp;
          if (src && this.ctrl) {
            const dx = src.px - this.ctrl.sim.px;
            const dz = src.pz - this.ctrl.sim.pz;
            const worldAng = Math.atan2(-dx, -dz);
            this.damageDirs.push({ at: now, angle: worldAng - this.assist.yaw });
          }
          this.audio.hurt(ev.armourDmg > 0 && ev.dmg === 0, this.localCls === PlayerClass.Ripper);
        } else {
          this.fx.hitPuff(p, ev.armourDmg > 0 && ev.dmg === 0 ? 0x66ccff : 0xc4122f);
          this.audio.impact(p, ev.armourDmg > 0 && ev.dmg === 0, this.listenerPos());
        }
        break;
      }
      case 'death': {
        const v = this.view?.players.find((x) => x.id === ev.victim);
        const k = this.view?.players.find((x) => x.id === ev.killer);
        const mine = ev.killer === myId || ev.victim === myId;
        const text = ev.killer && ev.killer !== ev.victim ? `${k?.name ?? '?'} ${ev.kind === 'bite' ? '⟫ bit' : '⟫ shot'} ${v?.name ?? '?'}` : `${v?.name ?? '?'} died`;
        setState((s) => ({ killFeed: [...s.killFeed.slice(-5), { id: ++this.killId, text, at: now, mine }] }));
        const p = new THREE.Vector3(ev.px, ev.py, ev.pz);
        this.fx.deathCue(p, v?.sim.cls === PlayerClass.Ripper ? 0x8a1020 : 0x66ccff);
        this.audio.death(p, v?.sim.cls === PlayerClass.Ripper, ev.victim === myId, this.listenerPos());
        if (ev.victim === myId && this.ctrl) {
          this.deathPos.set(this.ctrl.sim.px, this.ctrl.sim.py, this.ctrl.sim.pz);
          this.deathYaw = this.assist.yaw;
          this.deadFor = 0;
        }
        break;
      }
      case 'respawn': {
        const e = this.remotes.get(ev.id);
        if (e?.lastInterp) this.fx.spawnCue(new THREE.Vector3(e.lastInterp.px, e.lastInterp.py, e.lastInterp.pz));
        break;
      }
      case 'leap': {
        if (ev.id !== myId) {
          const e = this.remotes.get(ev.id);
          if (e?.lastInterp) this.audio.leap(new THREE.Vector3(e.lastInterp.px, e.lastInterp.py, e.lastInterp.pz), this.listenerPos());
        }
        break;
      }
      case 'reload': {
        if (ev.id !== myId) {
          const e = this.remotes.get(ev.id);
          if (e?.lastInterp) this.audio.reload(new THREE.Vector3(e.lastInterp.px, e.lastInterp.py, e.lastInterp.pz), this.listenerPos());
        }
        break;
      }
      case 'shot-result': {
        if (ev.id === myId) {
          this.lastShotText = `${ev.result}${ev.result === 'ok' ? (ev.hit ? ' HIT' : ' miss') : ''} rewind ${ev.rewindMs.toFixed(0)}ms #${ev.seq}`;
        }
        break;
      }
      default:
        break;
    }
  }

  private listenerPos(): THREE.Vector3 {
    return this.renderer.camera.position;
  }

  private muzzleFor(shooterId: string, fallback: THREE.Vector3): THREE.Vector3 {
    const r = this.remotes.get(shooterId);
    return r ? r.avatar.root.localToWorld(new THREE.Vector3(0.18, 1.35, -0.7)) : fallback;
  }

  // ---- main loop --------------------------------------------------------------------------------

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.frameCount++;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK_DT && steps < 5) {
      this.fixedTick(now);
      this.acc -= TICK_DT;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    const alpha = this.acc / TICK_DT;
    this.assist.update(dt);
    this.render(dt, alpha, now);
    this.updateHud(now);
  }

  private playing(): boolean {
    return view_isPlaying(this.view) && !!this.me?.alive && !!this.ctrl;
  }

  private fixedTick(now: number): void {
    if (!this.playing() || !this.ctrl) return;
    const ctrl = this.ctrl;
    const s = this.input.sample();
    const locked = this.input.locked;
    const frame = {
      epoch: ctrl.epoch,
      clientTimeMs: now,
      moveX: locked ? s.moveX : 0,
      moveZ: locked ? s.moveZ : 0,
      yaw: this.assist.yaw,
      pitch: this.assist.pitch,
      jump: locked && s.jump,
      sprint: locked && s.sprint,
      primary: locked && s.primary,
      secondary: locked && s.secondary,
      interact: locked && s.interact,
      reload: locked && s.reload,
    };
    const { frame: sent, result, before } = ctrl.predict(frame);
    this.net.queueInput(sent);
    this.assist.onTick(before, ctrl.sim);
    this.presentStep(result, before, ctrl.sim, now);
  }

  /** Immediate local presentation of a predicted step (muzzle flash, sounds): never gameplay authority. */
  private presentStep(r: StepResult, before: PlayerSim, after: PlayerSim, now: number): void {
    const pos = new THREE.Vector3(after.px, after.py, after.pz);
    if (r.fired) {
      const ray = shotRay(after, r.shotIndex, r.spreadDeg);
      const hit = this.world.rayCast(ray.origin.x, ray.origin.y, ray.origin.z, ray.dir.x, ray.dir.y, ray.dir.z, 300);
      const t = hit ? hit.t : 80;
      const end = new THREE.Vector3(ray.origin.x + ray.dir.x * t, ray.origin.y + ray.dir.y * t, ray.origin.z + ray.dir.z * t);
      const muzzle = this.fpv.muzzleWorld(this.renderer.camera);
      this.fx.tracer(muzzle, end, 0x9be7ff);
      this.fx.muzzleFlash(muzzle, true);
      if (hit) this.fx.sparks(end, new THREE.Vector3(hit.nx, hit.ny, hit.nz), 0xffc266);
      this.cam.kickRecoil();
      this.fpv.kick();
      this.audio.rifle(pos, true, this.listenerPos());
      this.rays.push({ at: now, a: new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z), b: end, color: 0x00e5ff });
    }
    if (r.bit) {
      this.fpv.bite();
      {
        const vd = viewDir(after.yaw, after.pitch);
        this.fx.biteSwipe(this.renderer.camera.position, new THREE.Vector3(vd.x, vd.y, vd.z), true);
      }
      this.audio.bite(pos, this.listenerPos(), true);
    }
    if (r.leaped) {
      this.cam.kickLeap();
      this.audio.leap(pos, this.listenerPos(), true);
    }
    if (r.reloadStarted) {
      this.fpv.reload();
      this.audio.reload(pos, this.listenerPos(), true);
    }
    if (r.jumped) this.audio.jump(true);
    if (r.landed) this.audio.land(r.moved, true);
    if (r.fireRejected === 'empty' && this.input.sample().primary && now - this.lastFootstep > 250) {
      this.audio.dryFire();
      this.lastFootstep = now;
    }
    // footsteps / claws, cadence driven by distance travelled on a surface
    const speed = Math.hypot(after.vx, after.vy, after.vz);
    if (after.surface !== SurfaceState.Air && speed > 1.5) {
      this.stepDist += speed * TICK_DT;
      const stride = after.cls === PlayerClass.Marine ? (after.sprinting ? 2.4 : 1.9) : 1.25;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.audio.step(after.cls === PlayerClass.Marine, after.surface !== SurfaceState.Ground, speed / 8);
      }
    }
    void before;
  }
  private stepDist = 0;

  private render(dt: number, alpha: number, now: number): void {
    const cam = this.renderer.camera;
    const playing = this.playing();
    let fov: number = MARINE.fov;
    this.offset.set(0, 0, 0);
    if (playing && this.ctrl) {
      const c = this.ctrl;
      c.smooth(dt);
      this.offset.set(c.offX, c.offY, c.offZ);
      // blend between last two predicted ticks for >60 Hz displays
      const s: PlayerSim = { ...c.sim, px: c.prev.px + (c.sim.px - c.prev.px) * alpha, py: c.prev.py + (c.sim.py - c.prev.py) * alpha, pz: c.prev.pz + (c.sim.pz - c.prev.pz) * alpha };
      fov = this.cam.update(cam, s, this.assist.yaw, this.assist.pitch, this.offset, dt);
      this.fpv.setVisible(true);
      this.fpv.update(dt, s, this.localCls === PlayerClass.Marine ? 'marine' : 'ripper', this.input.sample().primary && this.input.locked);
      this.wasAlive = true;
    } else if (this.me && !this.me.alive && this.ctrl && view_isPlaying(this.view)) {
      // death cam: hold the death position and drift up/back
      this.deadFor += dt;
      const t = Math.min(this.deadFor, 3);
      cam.position.set(this.deathPos.x, this.deathPos.y + 1.2 + t * 0.25, this.deathPos.z);
      cam.rotation.set(-0.4, this.deathYaw + t * 0.25, 0, 'YXZ');
      this.fpv.setVisible(false);
      fov = MARINE.fov;
      this.wasAlive = false;
    } else {
      // lobby / not yet spawned: orbit the map overview
      const t = now / 6000;
      cam.position.set(18 + Math.cos(t) * 10, 9, 17 + Math.sin(t) * 9);
      cam.lookAt(18, 1, 17);
      this.fpv.setVisible(false);
    }
    this.renderer.setHorizontalFov(fov);

    // remote entities
    const serverNow = this.net.clock.serverNow(now);
    const renderT = serverNow - NET.interpolationBufferMs;
    const showGhosts = this.toggles.interpGhosts && this.dev;
    for (const r of this.remotes.values()) {
      const snap = r.snapshot;
      const st = r.buffer.sample(renderT);
      if (!st || !snap || !snap.alive) {
        r.hide();
        continue;
      }
      r.apply(st, snap, dt);
      void showGhosts;
    }

    this.fx.update(dt, now);
    this.audio.updateListener(cam);
    this.drawDebug(now);
    this.renderer.render();
  }

  // ---- debug ------------------------------------------------------------------------------------

  private drawDebug(now: number): void {
    const dd = this.debugDraw;
    const any = this.dev && Object.values(this.toggles).some(Boolean);
    dd.visible = any;
    this.rays = this.rays.filter((r) => now - r.at < 1500);
    this.biteViz = this.biteViz.filter((r) => now - r.at < 900);
    if (!any) return;
    dd.begin();
    const T = this.toggles;
    if (T.colliders) {
      // local collider
      if (this.ctrl && this.me?.alive) {
        const s = this.ctrl.sim;
        if (s.cls === PlayerClass.Marine) dd.box(s.px - MARINE.colliderRadius, s.py, s.pz - MARINE.colliderRadius, s.px + MARINE.colliderRadius, s.py + MARINE.standingHeight, s.pz + MARINE.colliderRadius, 0x00ff88);
        else dd.sphere(s.px, s.py, s.pz, RIPPER.colliderRadius, 0x00ff88);
      }
      for (const r of this.remotes.values()) {
        const st = r.lastInterp;
        const sn = r.snapshot;
        if (!st || !sn?.alive) continue;
        if (sn.sim.cls === PlayerClass.Marine) dd.box(st.px - MARINE.colliderRadius, st.py, st.pz - MARINE.colliderRadius, st.px + MARINE.colliderRadius, st.py + MARINE.standingHeight, st.pz + MARINE.colliderRadius, 0x33aa66);
        else dd.sphere(st.px, st.py, st.pz, RIPPER.colliderRadius, 0x33aa66);
      }
    }
    if (T.hurtVolumes) {
      for (const p of this.view?.players ?? []) {
        if (!p.alive) continue;
        const c = hurtCapsule(p.sim);
        dd.capsule(c.a, c.b, c.r, p.id === this.net.sessionId ? 0xffee00 : 0xff3355);
      }
    }
    if (T.hitRays) for (const r of this.rays) dd.line(r.a.x, r.a.y, r.a.z, r.b.x, r.b.y, r.b.z, r.color);
    if (T.biteSweep) {
      for (const b of this.biteViz) {
        dd.line(b.a.x, b.a.y, b.a.z, b.b.x, b.b.y, b.b.z, 0xff00ff);
        dd.sphere(b.b.x, b.b.y, b.b.z, BITE.sweepRadius, 0xff00ff);
      }
      if (this.ctrl && this.localCls === PlayerClass.Ripper && this.me?.alive) {
        const s = this.ctrl.sim;
        const o = biteOrigin(s);
        const d = viewDir(s.yaw, s.pitch);
        const e = { x: o.x + d.x * (BITE.reach - BITE.sweepRadius), y: o.y + d.y * (BITE.reach - BITE.sweepRadius), z: o.z + d.z * (BITE.reach - BITE.sweepRadius) };
        dd.line(o.x, o.y, o.z, e.x, e.y, e.z, 0x884488);
        dd.sphere(e.x, e.y, e.z, BITE.sweepRadius, 0x884488);
      }
    }
    if (T.surfaceProbes && this.ctrl && this.localCls === PlayerClass.Ripper) {
      const s = this.ctrl.sim;
      dd.sphere(s.px, s.py, s.pz, RIPPER.surfaceProbeDistance, 0x00aaff);
      for (const c of this.world.surfacesNear(s.px, s.py, s.pz, RIPPER.surfaceProbeDistance + 0.4)) {
        dd.line(s.px, s.py, s.pz, c.qx, c.qy, c.qz, c.dist <= RIPPER.surfaceProbeDistance ? 0x00ff66 : 0x555555);
        dd.arrow(c.qx, c.qy, c.qz, c.nx * 0.3, c.ny * 0.3, c.nz * 0.3, 0xffff00);
      }
      dd.arrow(s.px, s.py, s.pz, s.nx * 0.6, s.ny * 0.6, s.nz * 0.6, 0xff00ff);
      dd.arrow(s.px, s.py, s.pz, s.vx * 0.15, s.vy * 0.15, s.vz * 0.15, 0xffffff);
    }
    if (T.traversalProbes) {
      for (let i = 0; i < VENT_PATH.length - 1; i++) {
        const a = VENT_PATH[i];
        const b = VENT_PATH[i + 1];
        dd.line(a.x, a.y, a.z, b.x, b.y, b.z, 0x9966ff);
      }
      for (const p of VENT_PATH) dd.sphere(p.x, p.y, p.z, 0.2, 0x9966ff);
    }
    if (T.spawnVolumes) {
      for (const sp of MARINE_SPAWNS) dd.box(sp.x - 0.4, sp.y, sp.z - 0.4, sp.x + 0.4, sp.y + 1.8, sp.z + 0.4, 0x00aaff);
      for (const sp of BLOOM_SPAWNS) dd.sphere(sp.x, sp.y, sp.z, 0.4, 0xff2266);
    }
    if (T.interpGhosts) {
      // raw latest server snapshot of each remote (red) versus the interpolated body (see colliders)
      for (const r of this.remotes.values()) {
        const l = r.buffer.latest();
        if (l?.alive) dd.sphere(l.sim.px, l.sim.py + (l.sim.cls === PlayerClass.Marine ? 0.9 : 0), l.sim.pz, 0.25, 0xff4444);
      }
      if (this.ctrl && this.me?.alive) dd.sphere(this.me.sim.px, this.me.sim.py + (this.me.sim.cls === PlayerClass.Marine ? 0.9 : 0), this.me.sim.pz, 0.25, 0xff4444);
    }
    dd.end();
  }

  setToggle(t: DebugToggle, on: boolean): void {
    this.toggles[t] = on;
    if (getState().debug) setState({ debug: this.debugState() });
  }

  debugState(): DebugState {
    const c = this.ctrl;
    const now = performance.now();
    this.reconWindow = this.reconWindow.filter((t) => now - t < 5000);
    const lastShot = this.lastShotText;
    const tickDrift = this.view ? this.net.clock.serverNow(now) / TICK_MS - this.view.serverTick : 0;
    const sim = c?.sim;
    return {
      fps: this.renderer.stats.fps,
      frameMs: this.renderer.stats.frameMs,
      frameMsMax: this.renderer.stats.frameMsMax,
      drawCalls: this.renderer.stats.drawCalls,
      serverTick: this.view?.serverTick ?? 0,
      tickDriftMs: tickDrift * TICK_MS,
      rttMs: this.net.clock.rtt,
      jitterMs: this.net.clock.jitter,
      inputSeq: c ? c.nextSeq - 1 : 0,
      lastAck: c?.lastAck ?? 0,
      unacked: c?.unacked ?? 0,
      predErrM: c?.stats.lastErrorM ?? 0,
      predErrMaxM: c?.stats.maxErrorM ?? 0,
      reconPerSec: this.reconWindow.length / 5,
      reconTotal: c?.stats.reconciliations ?? 0,
      surfaceBreaks: c?.stats.surfaceBreaks ?? 0,
      correctionM: c?.correctionMagnitude ?? 0,
      speed: sim ? Math.hypot(sim.vx, sim.vy, sim.vz) : 0,
      surface: sim ? SURFACE_NAMES[sim.surface] : '-',
      normal: sim ? `${sim.nx.toFixed(2)}, ${sim.ny.toFixed(2)}, ${sim.nz.toFixed(2)}` : '-',
      lastShot,
      patchesPerSec: this.net.stats.patchesPerSec,
      simLagMs: this.net.sim.cfg.lagMs,
      simJitterMs: this.net.sim.cfg.jitterMs,
      viewAssist: this.assist.enabled,
      toggles: { ...this.toggles },
    };
  }

  setSimLatency(lagMs: number, jitterMs: number): void {
    this.net.sim.cfg.lagMs = lagMs;
    this.net.sim.cfg.jitterMs = jitterMs;
  }

  // ---- HUD / telemetry --------------------------------------------------------------------------

  private updateHud(now: number): void {
    if (now - this.lastHudAt < 100) return;
    this.lastHudAt = now;
    const me = this.me;
    const sim = this.ctrl?.sim;
    const serverNow = this.net.clock.serverNow(now);
    const respawnIn = me && !me.alive && me.respawnAtMs > 0 ? Math.max(0, (me.respawnAtMs - serverNow) / 1000) : 0;
    const useSim = me?.alive && sim ? sim : me?.sim;
    const hud: HudState = me
      ? {
          alive: me.alive,
          cls: useSim?.cls ?? me.sim.cls,
          health: me.health,
          armour: me.armour,
          ammo: useSim?.ammo ?? 0,
          reserve: useSim?.reserve ?? 0,
          reloading: useSim && useSim.reloadTicks > 0 ? 1 - useSim.reloadTicks / Math.round(RIFLE.reloadSec * 60) : 0,
          energy: useSim?.energy ?? 0,
          leapReady: !!useSim && useSim.leapCd <= 0 && useSim.energy >= RIPPER.leapEnergyCost,
          protected: me.protected,
          respawnIn,
          spread: useSim ? Math.min(RIFLE.bloomCapDeg, RIFLE.baseSpreadDeg + useSim.bloom + Math.min(1, Math.hypot(useSim.vx, useSim.vz) / MARINE.walkSpeed) * (RIFLE.movingSpreadDeg - RIFLE.baseSpreadDeg)) : 0.5,
          hitMarkerAt: this.hitAt,
          hitKind: this.hitKind,
          damageFlashAt: this.damageFlashAt,
          damageDirs: this.damageDirs.filter((d) => now - d.at < 1200),
          speed: sim ? Math.hypot(sim.vx, sim.vy, sim.vz) : 0,
          surface: sim?.surface ?? 0,
          locked: this.input.locked,
          rtt: this.net.clock.rtt,
        }
      : emptyHud();
    this.damageDirs = this.damageDirs.filter((d) => now - d.at < 1200);
    const killFeed = getState().killFeed.filter((k) => now - k.at < 6000);
    setState((s) => ({ hud: { ...hud, locked: this.input.locked }, killFeed: killFeed.length === s.killFeed.length ? s.killFeed : killFeed, debug: this.dev && s.debug ? this.debugState() : s.debug }));

    // client-side telemetry to the server every 5 s (feeds structured logs)
    if (now - this.lastTelemetry > 5000 && this.me) {
      const secs = (now - (this.lastTelemetry || now - 5000)) / 1000;
      this.lastTelemetry = now;
      this.net.telemetry({
        rtt: this.net.clock.rtt,
        errAvg: this.telemetryErrN ? this.telemetryErrSum / this.telemetryErrN : 0,
        errMax: this.telemetryErrMax,
        recPerSec: this.telemetryRec / Math.max(0.1, secs),
        recCount: this.telemetryRec,
        windowSec: secs,
        reasons: this.telemetryReasons,
        fps: this.renderer.stats.fps,
      } as unknown as Record<string, number>);
      this.telemetryReasons = {};
      this.telemetryRec = 0;
      this.telemetryErrSum = this.telemetryErrN = this.telemetryErrMax = 0;
    }
    void this.lastRecTotal;
    void clonePlayerSim;
    void eyePosition;
    void this.wasAlive;
    void this.frameCount;
    void this.lastCls;
    void this.hitKind;
  }
}

function view_isPlaying(v: MatchView | null): boolean {
  return !!v && v.phase === 'playing';
}
