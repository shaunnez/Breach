import type * as THREE from 'three';

/**
 * Procedural VS01 sound set (E8). Everything is synthesised with WebAudio so the slice ships with
 * zero binary audio assets; the same method names are the integration points for the
 * ElevenLabs-sourced, edited samples listed in the bible (swap `play*` bodies for buffer playback).
 * Positional sounds use HRTF panners so Marines can hear a Ripper before seeing it.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private ambientStarted = false;
  private creakTimer: ReturnType<typeof setTimeout> | null = null;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC() as AudioContext;
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  resume(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    this.startAmbient();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
  }

  updateListener(cam: THREE.Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = cam.position;
    const f = { x: 0, y: 0, z: -1 };
    const u = { x: 0, y: 1, z: 0 };
    const e = (cam as THREE.PerspectiveCamera).matrixWorld.elements;
    f.x = -e[8];
    f.y = -e[9];
    f.z = -e[10];
    u.x = e[4];
    u.y = e[5];
    u.z = e[6];
    if (l.positionX) {
      l.positionX.value = p.x;
      l.positionY.value = p.y;
      l.positionZ.value = p.z;
      l.forwardX.value = f.x;
      l.forwardY.value = f.y;
      l.forwardZ.value = f.z;
      l.upX.value = u.x;
      l.upY.value = u.y;
      l.upZ.value = u.z;
    }
  }

  // ---- building blocks ----------------------------------------------------------------------------

  /** Output node: positional (HRTF) when pos is given, else plain stereo. Returns [input, volumeScale]. */
  private out(pos?: THREE.Vector3, listener?: THREE.Vector3): { node: AudioNode; far: number } | null {
    const ctx = this.ensure();
    if (!ctx || !this.master) return null;
    if (!pos) return { node: this.master, far: 0 };
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2.5;
    p.rolloffFactor = 1.25;
    p.maxDistance = 120;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    }
    p.connect(this.master);
    const far = listener ? Math.hypot(pos.x - listener.x, pos.y - listener.y, pos.z - listener.z) : 0;
    return { node: p, far };
  }

  private noise(dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, dest: AudioNode, t0 = 0, freqEnd?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + t0;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, dest: AudioNode, t0 = 0, lp?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime + t0;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let n: AudioNode = o;
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      o.connect(f);
      n = f;
    }
    n.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** distant sounds lose highs: simple per-sound lowpass */
  private distantLp(dest: AudioNode, far: number): AudioNode {
    const ctx = this.ctx!;
    if (far < 18) return dest;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.max(700, 6000 - far * 140);
    f.connect(dest);
    return f;
  }

  // ---- Marine -------------------------------------------------------------------------------------

  rifle(pos: THREE.Vector3, own: boolean, listener?: THREE.Vector3): void {
    const o = this.out(own ? undefined : pos, listener);
    if (!o) return;
    const d = this.distantLp(o.node, o.far);
    const v = own ? 0.9 : 0.8;
    this.noise(0.07, 'bandpass', 2200, 0.8, v * 0.7, d); // crack
    this.noise(0.14, 'lowpass', 700, 0.6, v * 0.5, d); // body
    this.tone('sine', 190, 52, 0.12, v * 0.75, d); // thump
    this.tone('square', 920, 380, 0.04, v * 0.12, d); // pulse tick
  }

  reload(pos: THREE.Vector3, listener?: THREE.Vector3, own = false): void {
    const o = this.out(own ? undefined : pos, listener);
    if (!o) return;
    const v = own ? 0.6 : 0.4;
    this.noise(0.05, 'highpass', 2400, 0.7, v, o.node, 0.0);
    this.tone('square', 480, 300, 0.05, v * 0.2, o.node, 0.0);
    this.noise(0.08, 'bandpass', 900, 1.2, v * 0.9, o.node, 0.45);
    this.tone('triangle', 260, 180, 0.09, v * 0.4, o.node, 0.45);
    this.noise(0.05, 'highpass', 3000, 0.7, v, o.node, 1.7);
    this.noise(0.12, 'lowpass', 500, 0.7, v * 1.1, o.node, 1.95);
    this.tone('square', 640, 520, 0.05, v * 0.2, o.node, 1.95);
  }

  dryFire(): void {
    const o = this.out();
    if (!o) return;
    this.noise(0.03, 'highpass', 3500, 1, 0.35, o.node);
  }

  step(marine: boolean, onWall: boolean, speed: number, pos?: THREE.Vector3, listener?: THREE.Vector3): void {
    const o = this.out(pos, listener);
    if (!o) return;
    const v = Math.min(1, 0.35 + speed * 0.5) * (pos ? 1.0 : 0.7);
    if (marine) {
      this.noise(0.11, 'lowpass', 520 + Math.random() * 120, 0.9, v * 0.9, o.node);
      this.tone('sine', 1500 + Math.random() * 300, 900, 0.03, v * 0.08, o.node);
    } else {
      // claws on metal: two quick ticks, plus a scrape accent on walls/ceilings
      this.noise(0.025, 'bandpass', 3800 + Math.random() * 1500, 2.4, v * 0.8, o.node);
      this.noise(0.025, 'bandpass', 5200 + Math.random() * 900, 2.2, v * 0.55, o.node, 0.045);
      if (onWall) this.noise(0.18, 'bandpass', 2600, 1.6, v * 0.35, o.node, 0.02, 1800);
    }
  }

  jump(own: boolean): void {
    const o = this.out();
    if (!o || !own) return;
    this.noise(0.06, 'lowpass', 600, 0.8, 0.3, o.node);
  }

  land(impact: number, own: boolean): void {
    const o = this.out();
    if (!o || !own) return;
    const v = Math.min(1, 0.4 + impact * 2);
    this.noise(0.13, 'lowpass', 380, 0.9, v * 0.9, o.node);
    this.tone('sine', 120, 55, 0.12, v * 0.5, o.node);
  }

  // ---- Ripper -------------------------------------------------------------------------------------

  leap(pos: THREE.Vector3, listener?: THREE.Vector3, own = false): void {
    const o = this.out(own ? undefined : pos, listener);
    if (!o) return;
    const v = own ? 0.5 : 0.7;
    this.tone('sawtooth', 240, 880, 0.18, v * 0.25, o.node, 0, 2400);
    this.tone('sawtooth', 880, 380, 0.22, v * 0.2, o.node, 0.16, 2000);
    this.noise(0.25, 'bandpass', 1500, 1.4, v * 0.35, o.node, 0, 600);
  }

  bite(pos: THREE.Vector3, listener?: THREE.Vector3, own = false): void {
    const o = this.out(own ? undefined : pos, listener);
    if (!o) return;
    const v = own ? 0.7 : 0.9;
    this.noise(0.06, 'bandpass', 2800, 1.1, v * 0.8, o.node);
    this.tone('sawtooth', 130, 70, 0.18, v * 0.35, o.node, 0.0, 700);
    this.noise(0.1, 'lowpass', 450, 0.8, v * 0.6, o.node, 0.07);
  }

  // ---- shared ----------------------------------------------------------------------------------

  hurt(armour: boolean, ripper: boolean): void {
    const o = this.out();
    if (!o) return;
    if (armour) {
      this.noise(0.12, 'bandpass', 1800, 2.5, 0.5, o.node);
      this.tone('triangle', 900, 500, 0.12, 0.2, o.node);
    } else if (ripper) {
      this.tone('square', 1400, 600, 0.16, 0.22, o.node, 0, 3200);
      this.noise(0.12, 'bandpass', 2400, 1.2, 0.3, o.node);
    } else {
      this.tone('sawtooth', 190, 120, 0.2, 0.3, o.node, 0, 900);
      this.noise(0.09, 'lowpass', 700, 0.8, 0.4, o.node);
    }
  }

  impact(pos: THREE.Vector3, armour: boolean, listener?: THREE.Vector3): void {
    const o = this.out(pos, listener);
    if (!o) return;
    if (armour) this.noise(0.08, 'bandpass', 2000, 2.2, 0.5, o.node);
    else this.noise(0.1, 'lowpass', 500, 0.9, 0.55, o.node);
  }

  hitMarker(kill: boolean, armour: boolean): void {
    const o = this.out();
    if (!o) return;
    this.tone('sine', armour ? 760 : 1250, armour ? 700 : 1100, 0.05, 0.22, o.node);
    if (kill) this.tone('sine', 1650, 1500, 0.09, 0.25, o.node, 0.06);
  }

  death(pos: THREE.Vector3, ripper: boolean, own: boolean, listener?: THREE.Vector3): void {
    const o = this.out(own ? undefined : pos, listener);
    if (!o) return;
    if (ripper) {
      this.tone('square', 1300, 160, 0.55, 0.28, o.node, 0, 2800);
      this.noise(0.5, 'bandpass', 1800, 1.1, 0.3, o.node, 0, 500);
    } else {
      this.tone('sawtooth', 220, 70, 0.5, 0.32, o.node, 0, 800);
      this.noise(0.25, 'lowpass', 420, 0.8, 0.6, o.node, 0.35);
    }
  }

  // ---- ambience -----------------------------------------------------------------------------------

  private startAmbient(): void {
    if (this.ambientStarted || !this.ctx || !this.master) return;
    this.ambientStarted = true;
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0.22;
    bus.connect(this.master);
    // ventilation bed: looping filtered noise with a slow LFO on the cutoff
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 120;
    lfo.connect(lfoG).connect(lp.frequency);
    src.connect(lp).connect(bus);
    src.start();
    lfo.start();
    // electrical hum
    for (const [f, g] of [
      [60, 0.05],
      [120, 0.03],
      [180, 0.012],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(bus);
      o.start();
    }
    // distant machinery: pulsing sub tone
    const m = ctx.createOscillator();
    m.type = 'triangle';
    m.frequency.value = 41;
    const mg = ctx.createGain();
    mg.gain.value = 0.05;
    const pulse = ctx.createOscillator();
    pulse.frequency.value = 0.8;
    const pg = ctx.createGain();
    pg.gain.value = 0.04;
    pulse.connect(pg).connect(mg.gain);
    m.connect(mg).connect(bus);
    m.start();
    pulse.start();
    // room-tone variation: occasional metallic creaks / vent gusts
    const creak = () => {
      if (!this.ctx) return;
      if (Math.random() < 0.5) this.noise(0.5 + Math.random() * 0.6, 'bandpass', 700 + Math.random() * 900, 4, 0.03, bus, 0, 300 + Math.random() * 400);
      else this.noise(1.2, 'lowpass', 500, 0.7, 0.05, bus, 0, 220);
      this.creakTimer = setTimeout(creak, 6000 + Math.random() * 9000);
    };
    this.creakTimer = setTimeout(creak, 4000);
  }

  dispose(): void {
    if (this.creakTimer) clearTimeout(this.creakTimer);
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
