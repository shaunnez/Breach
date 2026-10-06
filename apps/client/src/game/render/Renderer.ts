import * as THREE from 'three';

/**
 * Renderer adapter. The shipping VS01 renderer is WebGLRenderer (bible section 4); everything that
 * creates or drives the renderer lives here so a later WebGPU migration is a one-file change.
 */
export interface RenderStats {
  fps: number;
  frameMs: number;
  frameMsMax: number;
  drawCalls: number;
  triangles: number;
}

export class GameRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  stats: RenderStats = { fps: 0, frameMs: 0, frameMsMax: 0, drawCalls: 0, triangles: 0 };
  private frames = 0;
  private acc = 0;
  private maxMs = 0;
  private lastT = performance.now();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.15;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // "medium" preset
    this.camera = new THREE.PerspectiveCamera(90, 1, 0.05, 200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.background = new THREE.Color(0x05080c);
    this.scene.fog = new THREE.FogExp2(0x05080c, 0.018);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  resize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  /** Vertical FOV from the bible's horizontal-equivalent FOV at 16:9 reference. */
  setHorizontalFov(deg: number): void {
    const aspect = this.camera.aspect || 16 / 9;
    const hr = (deg * Math.PI) / 180;
    const v = 2 * Math.atan(Math.tan(hr / 2) / aspect);
    this.camera.fov = (v * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    const t0 = performance.now();
    this.gl.render(this.scene, this.camera);
    const now = performance.now();
    const ms = now - t0;
    this.frames++;
    this.acc += now - this.lastT;
    this.lastT = now;
    this.maxMs = Math.max(this.maxMs, ms);
    if (this.acc >= 500) {
      this.stats = {
        fps: (this.frames * 1000) / this.acc,
        frameMs: this.acc / this.frames,
        frameMsMax: this.maxMs,
        drawCalls: this.gl.info.render.calls,
        triangles: this.gl.info.render.triangles,
      };
      this.frames = 0;
      this.acc = 0;
      this.maxMs = 0;
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.gl.dispose();
  }
}
