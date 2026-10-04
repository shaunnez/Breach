import {
  clonePlayerSim,
  createPlayerSim,
  createTestCellA,
  emptyInput,
  newStepResult,
  stepPlayer,
  SurfaceViewAssist,
  PlayerClass,
  type InputFrame,
  type PlayerSim,
  type StepResult,
} from '../src/index';

export const world = createTestCellA();

export class Runner {
  s: PlayerSim;
  out: StepResult = newStepResult();
  seq = 0;
  tick = 0;
  view = new SurfaceViewAssist();
  log: StepResult[] = [];
  constructor(cls: PlayerClass, x: number, y: number, z: number, yaw = 0) {
    this.s = createPlayerSim(cls, x, y, z, yaw, 12345);
    this.view.reset(yaw, 0);
  }
  step(patch: Partial<InputFrame> = {}, useAssist = true): StepResult {
    const i = emptyInput(this.seq++);
    i.yaw = useAssist ? this.view.yaw : this.s.yaw;
    i.pitch = useAssist ? this.view.pitch : this.s.pitch;
    Object.assign(i, patch);
    const prev = clonePlayerSim(this.s);
    stepPlayer(this.s, i, world, this.out);
    if (useAssist) {
      this.view.onTick(prev, this.s);
      this.view.update(1 / 60);
    }
    this.tick++;
    this.log.push({ ...this.out });
    return this.out;
  }
  run(ticks: number, patch: Partial<InputFrame> | (() => Partial<InputFrame>) = {}, useAssist = true): void {
    for (let i = 0; i < ticks; i++) this.step(typeof patch === 'function' ? patch() : patch, useAssist);
  }
}
