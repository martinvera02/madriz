import * as THREE from 'three';
import type { VehicleFxSink } from '../entities/vehicle';

/** Humo (neumáticos, escape, motor averiado) y marcas de frenada sobre el asfalto. */
export class VehicleEffects implements VehicleFxSink {
  readonly group = new THREE.Group();
  private readonly N = 500;
  private pos: Float32Array;
  private vel: Float32Array;
  private data: Float32Array; // edad, vida, tamaño, oscuridad
  private attrPos: THREE.BufferAttribute;
  private attrSize: THREE.BufferAttribute;
  private attrAlpha: THREE.BufferAttribute;
  private attrDark: THREE.BufferAttribute;
  private next = 0;

  private marks: THREE.InstancedMesh;
  private readonly M = 1400;
  private mNext = 0;
  private last = new Map<number, { x: number; y: number; z: number; t: number }>();
  private time = 0;
  private dummy = new THREE.Object3D();

  constructor() {
    const n = this.N;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.data = new Float32Array(n * 4);
    const g = new THREE.BufferGeometry();
    this.attrPos = new THREE.BufferAttribute(this.pos, 3);
    this.attrSize = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.attrAlpha = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.attrDark = new THREE.BufferAttribute(new Float32Array(n), 1);
    for (const a of [this.attrPos, this.attrSize, this.attrAlpha, this.attrDark]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attrPos);
    g.setAttribute('aSize', this.attrSize);
    g.setAttribute('aAlpha', this.attrAlpha);
    g.setAttribute('aDark', this.attrDark);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute float aDark;
        varying float vA; varying float vD;
        uniform float uScale;
        void main() {
          vA = aAlpha; vD = aDark;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(90.0, aSize * uScale / max(0.5, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying float vD;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.1, d) * vA;
          vec3 col = mix(vec3(0.86, 0.86, 0.84), vec3(0.09, 0.09, 0.1), vD);
          gl_FragColor = vec4(col, a);
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    this.group.add(pts);

    const mg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mm = new THREE.MeshBasicMaterial({ color: 0x0b0b0b, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.marks = new THREE.InstancedMesh(mg, mm, this.M);
    this.marks.frustumCulled = false;
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.M; i++) this.marks.setMatrixAt(i, this.dummy.matrix);
    this.group.add(this.marks);
  }

  smoke(x: number, y: number, z: number, dark: number, size: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.N;
    this.pos[i * 3] = x + (Math.random() - 0.5) * 0.3;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
    this.vel[i * 3] = (Math.random() - 0.5) * 0.8;
    this.vel[i * 3 + 1] = 0.6 + Math.random() * 0.6 + dark * 0.8;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    this.data[i * 4] = 0;
    this.data[i * 4 + 1] = 1.4 + Math.random() * 1.2 + dark;
    this.data[i * 4 + 2] = size;
    this.data[i * 4 + 3] = dark;
  }

  skid(x: number, y: number, z: number, heading: number, id: number, wheel: number) {
    const key = id * 8 + wheel;
    const l = this.last.get(key);
    this.last.set(key, { x, y, z, t: this.time });
    let cx = x, cz = z, len = 0.45, ang = heading;
    if (l && this.time - l.t < 0.25) {
      const dx = x - l.x, dz = z - l.z, d = Math.hypot(dx, dz);
      if (d < 0.05) return;
      if (d < 2) { cx = (x + l.x) / 2; cz = (z + l.z) / 2; len = d + 0.05; ang = Math.atan2(dx, dz); }
    }
    const d = this.dummy;
    d.position.set(cx, y + 0.09, cz);
    d.rotation.set(0, ang, 0);
    d.scale.set(0.2, 1, len);
    d.updateMatrix();
    this.marks.setMatrixAt(this.mNext, d.matrix);
    this.mNext = (this.mNext + 1) % this.M;
    this.marks.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, wind: { x: number; z: number } = { x: 0.4, z: 0.2 }) {
    this.time += dt;
    const sz = this.attrSize.array as Float32Array, al = this.attrAlpha.array as Float32Array, dk = this.attrDark.array as Float32Array;
    for (let i = 0; i < this.N; i++) {
      const life = this.data[i * 4 + 1];
      if (life <= 0) { al[i] = 0; continue; }
      const age = (this.data[i * 4] += dt);
      if (age >= life) { this.data[i * 4 + 1] = 0; al[i] = 0; continue; }
      const t = age / life;
      this.vel[i * 3 + 1] *= Math.exp(-0.6 * dt);
      this.pos[i * 3] += (this.vel[i * 3] + wind.x * t) * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += (this.vel[i * 3 + 2] + wind.z * t) * dt;
      sz[i] = this.data[i * 4 + 2] * (0.6 + t * 2.4);
      al[i] = (1 - t) * (t < 0.1 ? t * 10 : 1) * (0.35 + this.data[i * 4 + 3] * 0.35);
      dk[i] = this.data[i * 4 + 3];
    }
    this.attrPos.needsUpdate = this.attrSize.needsUpdate = this.attrAlpha.needsUpdate = this.attrDark.needsUpdate = true;
  }
}
