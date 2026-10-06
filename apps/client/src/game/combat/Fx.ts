import * as THREE from 'three';

/** Cheap, pooled, readable VFX: tracers, muzzle flash, sparks, organic hit puffs, bite swipe, death + spawn cues. */

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}
interface Flash {
  sprite: THREE.Sprite;
  light: THREE.PointLight | null;
  life: number;
}
interface Ring {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  grow: number;
  baseScale: number;
}

function radialTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,220,150,0.8)');
  grad.addColorStop(1, 'rgba(255,160,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX_P = 400;

export class Fx {
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private rings: Ring[] = [];
  private tracerGeo = new THREE.BoxGeometry(0.012, 0.012, 1);
  private flashTex = radialTexture();
  // particles
  private pPos = new Float32Array(MAX_P * 3);
  private pCol = new Float32Array(MAX_P * 3);
  private pVel = new Float32Array(MAX_P * 3);
  private pLife = new Float32Array(MAX_P);
  private pMax = new Float32Array(MAX_P);
  private pBase = new Float32Array(MAX_P * 3);
  private pNext = 0;
  private points: THREE.Points;
  private ownFlashLight: THREE.PointLight;
  private tmp = new THREE.Color();

  constructor(private readonly scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.06, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pLife.fill(0);
    this.ownFlashLight = new THREE.PointLight(0x9be7ff, 0, 7, 2);
    scene.add(this.ownFlashLight);
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number): void {
    const len = a.distanceTo(b);
    if (len < 0.2) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.scale.set(1, 1, len);
    mesh.lookAt(b);
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.09, max: 0.09 });
  }

  muzzleFlash(at: THREE.Vector3, own = false): void {
    const mat = new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at);
    sprite.scale.setScalar(own ? 0.28 : 0.4);
    this.scene.add(sprite);
    this.flashes.push({ sprite, light: null, life: 0.05 });
    if (own) {
      this.ownFlashLight.position.copy(at);
      this.ownFlashLight.intensity = 14;
    }
  }

  private emit(pos: THREE.Vector3, vel: THREE.Vector3, color: number, life: number): void {
    const i = this.pNext++ % MAX_P;
    this.pPos[i * 3] = pos.x;
    this.pPos[i * 3 + 1] = pos.y;
    this.pPos[i * 3 + 2] = pos.z;
    this.pVel[i * 3] = vel.x;
    this.pVel[i * 3 + 1] = vel.y;
    this.pVel[i * 3 + 2] = vel.z;
    this.tmp.setHex(color);
    this.pBase[i * 3] = this.tmp.r;
    this.pBase[i * 3 + 1] = this.tmp.g;
    this.pBase[i * 3 + 2] = this.tmp.b;
    this.pLife[i] = life;
    this.pMax[i] = life;
  }

  sparks(pos: THREE.Vector3, normal: THREE.Vector3, color: number): void {
    for (let i = 0; i < 9; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2).addScaledVector(normal, 2.2 + Math.random() * 2);
      this.emit(pos, v, color, 0.25 + Math.random() * 0.25);
    }
  }

  hitPuff(pos: THREE.Vector3, color: number): void {
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 1.4, (Math.random() - 0.5) * 1.6);
      this.emit(pos, v, color, 0.35 + Math.random() * 0.25);
    }
  }

  biteSwipe(at: THREE.Vector3, dir: THREE.Vector3, own = false): void {
    const geo = new THREE.RingGeometry(0.5, 0.58, 20, 1, -0.9, 1.8);
    const mat = new THREE.MeshBasicMaterial({ color: own ? 0xff4d6d : 0xff7a90, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(at).addScaledVector(dir, 0.9);
    mesh.lookAt(at.clone().add(dir.clone().multiplyScalar(2)));
    mesh.rotateZ(own ? 0.4 : Math.random() * 3);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.16, max: 0.16, grow: 0.8, baseScale: 0.7 });
  }

  deathCue(pos: THREE.Vector3, color: number): void {
    for (let i = 0; i < 34; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3);
      this.emit(pos.clone().add(new THREE.Vector3(0, 0.6, 0)), v, color, 0.6 + Math.random() * 0.5);
    }
    this.ring(pos, color, 1.4, 0.5);
  }

  spawnCue(pos: THREE.Vector3): void {
    this.ring(pos.clone().setY(pos.y + 0.05), 0x7affd9, 1.8, 0.7);
    for (let i = 0; i < 14; i++) this.emit(pos, new THREE.Vector3((Math.random() - 0.5) * 0.8, 1 + Math.random() * 2, (Math.random() - 0.5) * 0.8), 0x7affd9, 0.7);
  }

  private ring(pos: THREE.Vector3, color: number, grow: number, life: number): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.5, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.rings.push({ mesh, life, max: life, grow, baseScale: 1 });
  }

  update(dt: number, _now: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (t.life / t.max) * 0.9);
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        (t.mesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        f.sprite.material.dispose();
        this.flashes.splice(i, 1);
      }
    }
    this.ownFlashLight.intensity = Math.max(0, this.ownFlashLight.intensity - dt * 280);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const u = 1 - r.life / r.max;
      r.mesh.scale.setScalar(r.baseScale + u * r.grow);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - u) * 0.8);
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
    for (let i = 0; i < MAX_P; i++) {
      if (this.pLife[i] <= 0) {
        this.pCol[i * 3] = this.pCol[i * 3 + 1] = this.pCol[i * 3 + 2] = 0;
        continue;
      }
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= 7 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      const k = Math.max(0, this.pLife[i] / this.pMax[i]);
      this.pCol[i * 3] = this.pBase[i * 3] * k;
      this.pCol[i * 3 + 1] = this.pBase[i * 3 + 1] * k;
      this.pCol[i * 3 + 2] = this.pBase[i * 3 + 2] * k;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    for (const t of this.tracers) this.scene.remove(t.mesh);
    for (const f of this.flashes) this.scene.remove(f.sprite);
    for (const r of this.rings) this.scene.remove(r.mesh);
    this.scene.remove(this.points);
    this.scene.remove(this.ownFlashLight);
    this.points.geometry.dispose();
    this.tracerGeo.dispose();
    this.flashTex.dispose();
  }
}
