/** Keyboard + mouse (desktop) input with pointer lock. Produces per-tick samples; look deltas go straight to the view. */
export interface InputSample {
  moveX: number;
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  primary: boolean;
  secondary: boolean;
  cling: boolean;
  interact: boolean;
  reload: boolean;
}

export class InputController {
  private keys = new Set<string>();
  private buttons = new Set<number>();
  locked = false;
  sensitivity = 0.0022;
  onLook: (dx: number, dy: number) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
  onKey: (code: string, down: boolean) => void = () => {};
  /** dev: extra simulated look latency is not needed; movement lag lives in NetSim */
  constructor(private readonly canvas: HTMLCanvasElement) {
    try {
      const s = Number(localStorage.getItem('breach.sens'));
      if (s > 0.0002 && s < 0.02) this.sensitivity = s;
    } catch {}
  }

  attach(): void {
    window.addEventListener('keydown', this.kd);
    window.addEventListener('keyup', this.ku);
    window.addEventListener('mousedown', this.md);
    window.addEventListener('mouseup', this.mu);
    window.addEventListener('mousemove', this.mm);
    window.addEventListener('blur', this.clear);
    document.addEventListener('pointerlockchange', this.plc);
    this.canvas.addEventListener('contextmenu', this.prevent);
  }
  detach(): void {
    window.removeEventListener('keydown', this.kd);
    window.removeEventListener('keyup', this.ku);
    window.removeEventListener('mousedown', this.md);
    window.removeEventListener('mouseup', this.mu);
    window.removeEventListener('mousemove', this.mm);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('pointerlockchange', this.plc);
    this.canvas.removeEventListener('contextmenu', this.prevent);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  requestLock(): void {
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
    } catch {}
  }

  private prevent = (e: Event) => e.preventDefault();
  private clear = () => {
    this.keys.clear();
    this.buttons.clear();
  };
  private plc = () => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.clear();
    this.onLockChange(this.locked);
  };
  private kd = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === 'Tab') e.preventDefault();
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code) && this.locked) e.preventDefault();
    this.keys.add(e.code);
    this.onKey(e.code, true);
  };
  private ku = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    this.onKey(e.code, false);
  };
  private md = (e: MouseEvent) => {
    if (!this.locked) return;
    this.buttons.add(e.button);
    e.preventDefault();
  };
  private mu = (e: MouseEvent) => this.buttons.delete(e.button);
  private mm = (e: MouseEvent) => {
    if (!this.locked) return;
    const dx = Math.max(-250, Math.min(250, e.movementX));
    const dy = Math.max(-250, Math.min(250, e.movementY));
    this.onLook(dx * this.sensitivity, dy * this.sensitivity);
  };

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  sample(): InputSample {
    const k = this.keys;
    let moveX = 0;
    let moveZ = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) moveZ += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) moveZ -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) moveX += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) moveX -= 1;
    return {
      moveX,
      moveZ,
      jump: k.has('Space'),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      primary: this.buttons.has(0),
      secondary: this.buttons.has(2) || k.has('KeyC'),
      cling: k.has('KeyF'),
      interact: k.has('KeyE'),
      reload: k.has('KeyR'),
    };
  }
}
