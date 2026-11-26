import * as THREE from 'three';
import { clamp } from '../config';
import { buildingUniforms } from './buildingMaterial';

/**
 * Ciclo día/noche con la atmósfera de la dirección artística: cielos cubiertos, horizonte en
 * naranja oxidado al atardecer, noches azuladas y frías con farolas cálidas, niebla densa y lluvia.
 * `time` va de 0 a 24 (horas de juego). Por defecto 1 hora de juego = 30 s reales.
 */
export class Sky {
  time = 20.6; // se empieza al anochecer
  speed = 1 / 30;
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.5);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7458, 1.0);
  private readonly skyColor = new THREE.Color();
  private readonly dome: THREE.Mesh;
  private readonly domeU = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uTime: { value: 0 },
  };
  night = 0;
  /** 0 = seco, 1 = lluvia (el asfalto tarda en mojarse y en secarse). */
  rain = 0;
  wet = 0;
  raining = false;
  /** Dentro de un local: no se ve la lluvia. */
  indoor = false;
  private readonly rainMesh: THREE.LineSegments;
  private readonly rainPos: Float32Array;

  constructor(private scene: THREE.Scene, private streetLights: THREE.MeshStandardMaterial, private lightPools: THREE.MeshBasicMaterial) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -110; c.right = 110; c.top = 110; c.bottom = -110; c.near = 1; c.far = 700;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.Fog(0x536477, 60, 900);
    streetLights.emissive.setHex(0xffc27a);

    // Bóveda celeste: degradado vertical, resplandor anaranjado del sol bajo y nubes de bandas
    const domeMat = new THREE.ShaderMaterial({
      uniforms: this.domeU,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uTop, uHorizon, uGlow, uSunDir;
        uniform float uTime;
        varying vec3 vDir;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float y = clamp(vDir.y, -0.2, 1.0);
          vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, y));
          float sunAmt = pow(max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);
          col += uGlow * sunAmt * (1.0 - smoothstep(0.0, 0.35, y));
          // capa de nubes baja y pesada (cielo encapotado)
          vec2 p = vDir.xz / max(0.08, vDir.y + 0.12) * 1.4 + vec2(uTime * 0.004, 0.0);
          float cl = n(p) * 0.6 + n(p * 2.3) * 0.3 + n(p * 5.1) * 0.1;
          col = mix(col, col * 0.78 + uHorizon * 0.12, smoothstep(0.45, 0.75, cl) * smoothstep(0.0, 0.25, y));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // Lluvia: segmentos que rodean la cámara
    const N = 2600;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) this.seedDrop(i, new THREE.Vector3(), true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb8c6d6, transparent: true, opacity: 0.0, depthWrite: false }));
    this.rainMesh.frustumCulled = false;
    scene.add(this.rainMesh);
  }

  private seedDrop(i: number, c: THREE.Vector3, anyHeight = false) {
    const x = c.x + (Math.random() - 0.5) * 80, z = c.z + (Math.random() - 0.5) * 80;
    const y = c.y + (anyHeight ? Math.random() * 40 - 8 : 30 + Math.random() * 6);
    const p = this.rainPos;
    p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
    p[i * 6 + 3] = x + 0.12; p[i * 6 + 4] = y - 0.9; p[i * 6 + 5] = z + 0.05;
  }

  toggleRain() { this.raining = !this.raining; return this.raining; }

  update(dt: number, focus: THREE.Vector3, realDt = dt, eye?: THREE.Vector3) {
    this.time = (this.time + dt * this.speed) % 24;
    const t = this.time;
    this.domeU.uTime.value += realDt;

    const dayFrac = (t - 7) / 14;
    const elev = Math.sin(clamp(dayFrac, -0.15, 1.15) * Math.PI);
    const azim = dayFrac * Math.PI;
    const dir = new THREE.Vector3(Math.cos(azim) * 0.8, Math.max(elev, 0.08), 0.45).normalize();
    this.sun.position.copy(focus).addScaledVector(dir, 350);
    this.sun.target.position.copy(focus);
    this.domeU.uSunDir.value.copy(dir);
    this.dome.position.copy(eye ?? focus);

    const day = clamp(elev * 2.2, 0, 1);
    const golden = clamp(1 - Math.abs(elev - 0.14) / 0.24, 0, 1) * (elev > -0.08 ? 1 : 0);
    this.night = clamp(1 - elev * 4, 0, 1);
    const overcast = 0.45 + this.rain * 0.45;

    // Paleta: azul noche #202B3A, gris azulado #536477, naranja oxidado #B75B32
    const top = new THREE.Color(0x202b3a).lerp(new THREE.Color(0x6f8aa6), day).lerp(new THREE.Color(0x536477), overcast * day * 0.6);
    const horizon = new THREE.Color(0x2c3746).lerp(new THREE.Color(0xa9b4bf), day).lerp(new THREE.Color(0xb75b32), golden * 0.75);
    const glow = new THREE.Color(0xb75b32).multiplyScalar(golden * 1.1 * (1 - this.rain * 0.6));
    this.domeU.uTop.value.copy(top);
    this.domeU.uHorizon.value.copy(horizon);
    this.domeU.uGlow.value.copy(glow);
    this.skyColor.copy(horizon);
    this.scene.background = this.skyColor;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(horizon).lerp(new THREE.Color(0x536477), 0.35 + 0.3 * this.night);
    fog.near = 30 + 60 * day * (1 - this.rain);
    fog.far = THREE.MathUtils.lerp(520, 1100, day) * (1 - this.rain * 0.45);

    // Sol cálido y bajo al atardecer, luna fría de noche; sombras marcadas
    this.sun.color.setHex(0xe8e4dc).lerp(new THREE.Color(0xd9814a), golden).lerp(new THREE.Color(0x7f93bd), this.night);
    this.sun.intensity = (0.55 + 2.4 * day) * (1 - this.rain * 0.5);
    this.hemi.intensity = 0.55 + 0.45 * day + this.night * 0.75; // noches azuladas, legibles
    this.hemi.color.setHex(0xaec0d6).lerp(new THREE.Color(0x6f86a3), this.night);
    this.hemi.groundColor.setHex(0x6e6458).lerp(new THREE.Color(0x2a3548), this.night);

    buildingUniforms.uNight.value = this.night;
    this.streetLights.emissiveIntensity = this.night * 4;
    this.lightPools.opacity = this.night * 0.75 * (1 + this.wet * 0.45); // en mojado, la luz se refleja

    // Lluvia y asfalto mojado
    this.rain += ((this.raining ? 1 : 0) - this.rain) * Math.min(1, realDt * 0.5);
    this.wet += ((this.raining ? 1 : 0) - this.wet) * Math.min(1, realDt * (this.raining ? 0.15 : 0.03));
    const rm = this.rainMesh.material as THREE.LineBasicMaterial;
    rm.opacity = this.rain * 0.6;
    this.rainMesh.visible = this.rain > 0.02 && !this.indoor;
    if (this.rainMesh.visible) {
      const c = eye ?? focus;
      const p = this.rainPos;
      const fall = 26 * realDt;
      for (let i = 0; i < p.length / 6; i++) {
        p[i * 6 + 1] -= fall; p[i * 6 + 4] -= fall;
        p[i * 6] += 0.6 * realDt; p[i * 6 + 3] += 0.6 * realDt;
        if (p[i * 6 + 4] < c.y - 10 || Math.abs(p[i * 6] - c.x) > 40 || Math.abs(p[i * 6 + 2] - c.z) > 40) this.seedDrop(i, c, p[i * 6 + 4] >= c.y - 10);
      }
      (this.rainMesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  clock(): string {
    const h = Math.floor(this.time);
    const m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
