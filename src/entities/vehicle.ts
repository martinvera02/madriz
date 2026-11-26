import * as THREE from 'three';
import { clamp } from '../config';
import { CollisionWorld } from '../world/collision';
import type { Ground } from '../world/roads';
import { Character, randomLook } from './character';
import { BODIES, buildModel, lightMaterial, wheelGeometry, vehicleUniforms, type Livery, type VehicleModel } from './vehicleModels';

export { vehicleUniforms };

/** Datos mecánicos de cada modelo. Par motor en Nm (ya con el "factor arcade"), relaciones de cambio y grupo. */
interface Mech {
  mass: number; torque: number; idle: number; redline: number; gears: number[]; final: number;
  drive: 'F' | 'R' | '4'; dragK: number; mu: number; brake: number; cgFront: number; cgH: number;
}

export interface VehicleType {
  id: string;
  name: string;
  length: number;
  width: number;
  wheelR: number;
  wheelbase: number;
  maxSpeed: number; // m/s (IA y referencia)
  accel: number; // aceleración de la IA (modelo simplificado)
  grip: number;
  mass: number;
  mech: Mech;
  /** Colores de pintura con su peso (parque móvil español: blanco, gris, negro, plata…). */
  colors: [number, number][];
  livery: Livery['kind'];
  engine: 'gasolina' | 'diesel' | 'hibrido' | 'v8' | 'gnc';
}

const STREET: [number, number][] = [
  [0xf3f3f1, 24], [0x9da3a8, 16], [0x6c7177, 12], [0x1b1c1e, 14], [0xc5c8cb, 10], [0x1f3d73, 6], [0xa3161c, 6],
  [0x2b4f3a, 2], [0x5a3d2b, 2], [0xd9cfb8, 2], [0x3c6fb0, 3], [0xe58a1f, 1], [0x7a1c2a, 2],
];
const mk = (id: string, name: string, mech: Mech, colors: [number, number][], extra: Partial<VehicleType> = {}): VehicleType => {
  const b = BODIES[id === 'taxi' || id === 'policia' ? 'berlina' : id] ?? { L: 12, W: 2.55, R: 0.5, wf: 3.3, wr: -2.8 };
  const g = mech.gears;
  const vmax = Math.min(70, ((mech.redline / 60) * 2 * Math.PI * b.R) / (g[g.length - 1] * mech.final));
  return {
    id, name, length: b.L, width: b.W, wheelR: b.R, wheelbase: b.wf - b.wr,
    maxSpeed: vmax * 0.8, accel: Math.min(13, (mech.torque * g[0] * mech.final) / b.R / mech.mass * 0.83),
    grip: 9 * mech.mu, mass: mech.mass, mech, colors, livery: 'plain', engine: 'gasolina', ...extra,
  };
};

export const VEHICLE_TYPES: Record<string, VehicleType> = {
  utilitario: mk('utilitario', 'Utilitario', { mass: 1150, torque: 230, idle: 850, redline: 6400, gears: [3.6, 2.1, 1.42, 1.08, 0.86], final: 4.0, drive: 'F', dragK: 0.38, mu: 1.0, brake: 1.0, cgFront: 0.6, cgH: 0.5 }, STREET),
  compacto: mk('compacto', 'Compacto', { mass: 1300, torque: 330, idle: 800, redline: 6300, gears: [3.6, 2.1, 1.45, 1.1, 0.88, 0.72], final: 3.65, drive: 'F', dragK: 0.37, mu: 1.03, brake: 1.0, cgFront: 0.6, cgH: 0.52 }, STREET, { engine: 'diesel' }),
  berlina: mk('berlina', 'Berlina', { mass: 1420, torque: 330, idle: 750, redline: 6000, gears: [3.5, 2.05, 1.4, 1.05, 0.84, 0.7], final: 3.6, drive: 'F', dragK: 0.35, mu: 1.0, brake: 1.0, cgFront: 0.58, cgH: 0.52 }, STREET),
  suv: mk('suv', 'SUV', { mass: 1560, torque: 380, idle: 750, redline: 5600, gears: [3.7, 2.1, 1.4, 1.03, 0.82, 0.68], final: 3.9, drive: 'F', dragK: 0.46, mu: 0.98, brake: 0.95, cgFront: 0.57, cgH: 0.66 }, STREET, { engine: 'diesel' }),
  furgoneta: mk('furgoneta', 'Furgoneta', { mass: 1480, torque: 320, idle: 800, redline: 5000, gears: [3.9, 2.1, 1.35, 0.97, 0.76], final: 4.2, drive: 'F', dragK: 0.5, mu: 0.95, brake: 0.92, cgFront: 0.57, cgH: 0.7 }, [[0xf5f5f3, 70], [0xc9ccd0, 15], [0x1f3d73, 8], [0xa3161c, 7]], { engine: 'diesel' }),
  furgon: mk('furgon', 'Furgón de reparto', { mass: 2500, torque: 520, idle: 750, redline: 4300, gears: [4.3, 2.4, 1.5, 1.0, 0.8, 0.66], final: 4.4, drive: 'R', dragK: 0.85, mu: 0.9, brake: 0.85, cgFront: 0.5, cgH: 0.95 }, [[0xf5f5f3, 80], [0xd6d8da, 12], [0xf2c200, 4], [0x9a1b1e, 4]], { engine: 'diesel' }),
  deportivo: mk('deportivo', 'Deportivo', { mass: 1450, torque: 640, idle: 900, redline: 7400, gears: [3.3, 2.25, 1.65, 1.28, 1.03, 0.84], final: 3.5, drive: 'R', dragK: 0.33, mu: 1.16, brake: 1.15, cgFront: 0.5, cgH: 0.44 }, [[0xb8202a, 30], [0xf0c020, 12], [0x1a1a1a, 25], [0xf4f4f4, 15], [0x2350a8, 10], [0xff6a00, 8]], { engine: 'v8' }),
  taxi: mk('taxi', 'Taxi', { mass: 1420, torque: 320, idle: 700, redline: 5600, gears: [3.3, 1.95, 1.3, 1.0, 0.8, 0.68], final: 3.6, drive: 'F', dragK: 0.34, mu: 1.0, brake: 1.0, cgFront: 0.58, cgH: 0.52 }, [[0xf7f7f2, 1]], { livery: 'taxi', engine: 'hibrido' }),
  policia: mk('policia', 'Policía Municipal', { mass: 1500, torque: 430, idle: 750, redline: 6200, gears: [3.4, 2.1, 1.45, 1.1, 0.88, 0.72], final: 3.7, drive: 'F', dragK: 0.34, mu: 1.08, brake: 1.1, cgFront: 0.57, cgH: 0.52 }, [[0xf4f4f2, 1]], { livery: 'policia', engine: 'gasolina', accel: 11, maxSpeed: 34 }),
  autobus: mk('autobus', 'Autobús EMT', { mass: 12500, torque: 2600, idle: 600, redline: 2400, gears: [3.4, 1.9, 1.42, 1.0, 0.75], final: 5.9, drive: 'R', dragK: 3.2, mu: 0.85, brake: 0.75, cgFront: 0.45, cgH: 1.0 }, [[0x1f62c0, 1]], { livery: 'emt', engine: 'gnc', accel: 3.5, maxSpeed: 22 }),
};

export interface DriveInput { throttle: number; steer: number; handbrake: boolean; }

let nextId = 1;
const _v = new THREE.Vector3();

/** Efectos que el vehículo emite (los recoge main.ts para humo, marcas de frenada y sonido). */
export interface VehicleFxSink {
  smoke(x: number, y: number, z: number, dark: number, size: number): void;
  skid(x: number, y: number, z: number, heading: number, id: number, wheel: number): void;
}

export class Vehicle {
  static fx: VehicleFxSink | null = null;
  readonly id = nextId++;
  readonly mesh = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly wheels: { pivot: THREE.Object3D; spin: THREE.Object3D; front: boolean; x: number; z: number }[] = [];
  readonly pos = new THREE.Vector3();
  heading = 0; // 0 = mirando a +Z
  readonly vel = new THREE.Vector2(); // (x, z)
  private vy = 0;
  private pitch = 0;
  private roll = 0;
  airborne = false;
  steerAngle = 0;
  private wheelSpin = 0;
  driver: 'none' | 'ai' | 'player' = 'none';
  /** Ocultar al conductor (cámara en primera persona dentro del coche). */
  hideDriver = false;
  /** Lejos de la cámara: sin conductor visible ni sombras de las ruedas (menos llamadas de dibujo). */
  far = false;
  setFar(on: boolean) {
    if (on === this.far) return;
    this.far = on;
    for (const w of this.wheels) for (const c of w.spin.children) (c as THREE.Mesh).castShadow = !on;
    if (on) this.driverMesh.visible = false;
    else this.driverMesh.visible = this.driver !== 'none' && !this.hideDriver && !this.burnt;
  }
  /** Último golpe fuerte (m/s) para efectos. */
  lastImpact = 0;
  readonly color: number;
  private model: VehicleModel;
  private lightU: ReturnType<typeof lightMaterial>['uniforms'];
  private driverMesh: THREE.Object3D;
  private driverCh!: Character;
  private pillars: THREE.Object3D | null = null;
  private lightMat!: THREE.Material;

  // ---- estado mecánico (lo lee el sonido y el HUD)
  yawRate = 0;
  rpm = 800;
  gear = 1;
  private shiftT = 0;
  throttleIn = 0;
  brakeIn = 0;
  skid = 0; // 0..1 (derrape / frenada bloqueada)
  horn = false;
  /** Rotativos encendidos (coches de policía). */
  siren = false;
  blink = 0; // -1 derecha, 1 izquierda
  headlights = false;
  health = 100;
  /** Calcinado tras una explosión (ya no arranca). */
  burnt = false;
  private ax = 0;
  private aLat = 0;
  private bodyP = 0; private bodyPv = 0;
  private bodyR = 0; private bodyRv = 0;
  private smokeT = 0;
  private skidAcc = 0;
  private orig: { g: THREE.BufferGeometry; p: Float32Array }[] = [];

  constructor(readonly type: VehicleType, color?: number) {
    this.color = color ?? pickWeighted(type.colors);
    const liv: Livery = { kind: type.livery, paint: this.color, plate: this.id % 8, variant: this.id % 4 };
    this.model = buildModel(type.id, liv);
    const m = this.model.materials;
    const bodyMesh = new THREE.Mesh(this.model.body, m.paint);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.body.add(bodyMesh);
    const glass = new THREE.Mesh(this.model.glass, m.glass);
    glass.renderOrder = 2;
    this.body.add(glass);
    const lm = lightMaterial();
    this.lightU = lm.uniforms;
    this.lightMat = lm.material;
    this.body.add(new THREE.Mesh(this.model.lights, lm.material));
    if (this.model.decals) this.body.add(new THREE.Mesh(this.model.decals, m.decal));
    // Conductor: el mismo modelo de persona que los peatones, sentado
    const dch = (this.driverCh = new Character(randomLook()));
    dch.sit();
    this.driverMesh = dch.root;
    this.pillars = new THREE.Mesh(this.model.cockpit, new THREE.MeshStandardMaterial({ color: 0x2f3034, roughness: 0.9, side: THREE.DoubleSide }));
    this.pillars.visible = false;
    this.body.add(this.pillars);
    const [sx, sy, sz] = this.model.driverSeat;
    dch.root.position.set(sx, sy + 0.27 - 0.92 * 0.95, sz + 0.05);
    dch.root.scale.setScalar(0.95);
    this.driverMesh.visible = false;
    this.body.add(this.driverMesh);
    for (const g of [this.model.body, this.model.glass, this.model.lights]) this.orig.push({ g, p: (g.attributes.position.array as Float32Array).slice() });

    // Ruedas: el pivote gira con la dirección (solo delanteras) y el hijo rueda
    const wg = wheelGeometry(this.model.wheelStyle);
    for (const w of this.model.wheels) {
      const pivot = new THREE.Group();
      pivot.position.set(w.x, w.r, w.z);
      const spin = new THREE.Group();
      const wm = new THREE.Mesh(wg, m.wheel);
      wm.scale.set(w.x > 0 ? w.w : -w.w, w.r, w.r);
      wm.castShadow = true;
      spin.add(wm);
      pivot.add(spin);
      this.mesh.add(pivot);
      this.wheels.push({ pivot, spin, front: w.front, x: w.x, z: w.z });
    }
    if (type.id === 'autobus') {
      // eje trasero gemelo: segunda rueda por dentro
      for (const w of this.model.wheels.filter((q) => !q.front)) {
        const wm = new THREE.Mesh(wg, m.wheel);
        wm.scale.set(w.w, w.r, w.r);
        wm.position.set(-Math.sign(w.x) * 0.32, 0, 0);
        this.wheels.find((q) => q.x === w.x && q.z === w.z)!.spin.add(wm);
      }
    }
    this.mesh.add(this.body);
  }

  get speed() { return this.vel.length(); }

  /** Explosión: carrocería calcinada, sin conductor, salta por los aires. */
  burn() {
    if (this.burnt) return;
    this.burnt = true;
    this.health = -100;
    const mat = new THREE.MeshStandardMaterial({ color: 0x1d1b1a, roughness: 1 });
    this.body.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry === this.model.body) m.material = mat; });
    this.vy = 6;
    this.airborne = true;
    this.pos.y += 0.1;
    this.yawRate += (Math.random() - 0.5) * 2;
    this.driverMesh.visible = false;
  }

  /** Liberar la memoria de GPU de este coche (geometrías propias y conductor). */
  dispose() {
    this.model.body.dispose(); this.model.glass.dispose(); this.model.cockpit.dispose(); this.model.lights.dispose(); this.model.decals?.dispose();
    (this.lightMat as THREE.Material).dispose();
    this.driverCh.dispose();
  }

  /** Posición de los ojos del conductor en coordenadas de mundo. */
  eyeWorld(out: THREE.Vector3) {
    const [x, y, z] = this.model.driverSeat;
    this.mesh.updateMatrixWorld();
    return out.set(x, this.model.eyeY, z - 0.22).applyMatrix4(this.body.matrixWorld);
    void y;
  }
  forward() { return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading)); }
  /** Velocidad longitudinal con signo. */
  forwardSpeed() { return this.vel.x * Math.sin(this.heading) + this.vel.y * Math.cos(this.heading); }

  place(x: number, z: number, heading: number, y = 0) {
    this.pos.set(x, y, z);
    this.heading = heading;
    this.vel.set(0, 0);
    this.yawRate = 0;
    this.syncMesh(0);
  }

  /** Centros de los dos círculos de colisión (delante y detrás). */
  circles(): [number, number, number, number, number] {
    const t = this.type;
    const off = t.length / 2 - t.width / 2;
    const fx = Math.sin(this.heading) * off, fz = Math.cos(this.heading) * off;
    return [this.pos.x + fx, this.pos.z + fz, this.pos.x - fx, this.pos.z - fz, t.width / 2 + 0.05];
  }

  /** Volcar/enderezar: vuelve a ponerlo de pie en el sitio. */
  reset(ground: Ground) {
    this.pitch = this.roll = 0;
    this.vel.multiplyScalar(0);
    this.yawRate = 0;
    this.pos.y = ground.heightAt(this.pos.x, this.pos.z) + 0.3;
  }

  update(dt: number, input: DriveInput, world: CollisionWorld, ground?: Ground) {
    if (this.driver === 'player') this.physics(dt, input);
    else this.arcade(dt, input);

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;

    // Colisiones con el escenario
    this.lastImpact = 0;
    const [ax, az, bx, bz, r] = this.circles();
    const a = { x: ax, z: az }, b = { x: bx, z: bz };
    const ha = world.resolveCircle(a, r, this.pos.y);
    const hb = world.resolveCircle(b, r, this.pos.y);
    if (ha || hb) {
      const dx = ((a.x - ax) + (b.x - bx)) / 2;
      const dz = ((a.z - az) + (b.z - bz)) / 2;
      this.pos.x += dx; this.pos.z += dz;
      const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
      const n = ha && hb ? { x: ha.nx + hb.nx, z: ha.nz + hb.nz } : ha ? { x: ha.nx, z: ha.nz } : { x: hb!.nx, z: hb!.nz };
      const l = Math.hypot(n.x, n.z) || 1;
      n.x /= l; n.z /= l;
      const vn = this.vel.x * n.x + this.vel.y * n.z;
      if (vn < 0) {
        this.vel.x -= n.x * vn * 1.3;
        this.vel.y -= n.z * vn * 1.3;
        this.vel.multiplyScalar(0.82);
        this.lastImpact = -vn;
        // un golpe con una sola esquina hace girar el coche
        if (ha && !hb) this.yawRate += angleSign(ha, nfx, nfz) * Math.min(2.5, -vn * 0.12);
        if (hb && !ha) this.yawRate -= angleSign(hb, nfx, nfz) * Math.min(2.5, -vn * 0.12);
        if (-vn > 4) this.damage(-n.x, -n.z, -vn);
      }
      if (ha && !hb) this.heading += angleSign(ha, nfx, nfz) * 0.015;
      if (hb && !ha) this.heading -= angleSign(hb, nfx, nfz) * 0.015;
    }

    if (ground) this.followGround(dt, ground);
    this.updateLights(dt);
    this.effects(dt);
    this.syncMesh(dt);
  }

  // ------------------------------------------------------------------ modelo simplificado (IA)
  private arcade(dt: number, input: DriveInput) {
    const t = this.type;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    let vf = this.vel.x * fx + this.vel.y * fz;
    let vr = this.vel.x * rx + this.vel.y * rz;
    if (!this.airborne) vf -= 9.8 * Math.sin(this.pitch) * dt * 0.8;
    const v0 = vf;
    if (this.airborne) { /* sin tracción */ } else if (input.throttle > 0) {
      if (vf < -0.5) vf += t.accel * 2.2 * dt;
      else vf += t.accel * input.throttle * (1 - clamp(vf / t.maxSpeed, 0, 1) ** 2) * dt;
    } else if (input.throttle < 0) {
      if (vf > 0.5) vf -= t.accel * 2.2 * dt;
      else if (vf > -t.maxSpeed * 0.3) vf -= t.accel * 0.6 * dt;
    } else {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), (1.2 + Math.abs(vf) * 0.04) * dt);
    }
    vf -= vf * Math.abs(vf) * 0.009 * dt;
    const grip = input.handbrake ? 1.4 : t.grip;
    vr *= Math.exp(-grip * dt);
    if (input.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 7 * dt);
    const maxSteer = 0.58 / (1 + Math.abs(vf) / 11);
    this.steerAngle += (input.steer * maxSteer - this.steerAngle) * Math.min(1, dt * 8);
    this.yawRate = (vf / t.wheelbase) * Math.tan(this.steerAngle) * (input.handbrake ? 1.35 : 1) * -1;
    this.heading += this.yawRate * dt;
    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    this.vel.set(nfx * vf - nfz * vr, nfz * vf + nfx * vr);
    this.ax = (vf - v0) / Math.max(dt, 1e-4);
    this.aLat = -this.yawRate * vf;
    this.throttleIn = Math.max(0, input.throttle);
    this.brakeIn = input.throttle < 0 && vf > 0.5 ? 1 : 0;
    this.gear = vf < -0.3 ? -1 : 1;
    this.engineRpm(Math.abs(vf), dt);
  }

  /** RPM aproximadas a partir de la velocidad y la marcha automática (también para la IA). */
  private engineRpm(v: number, dt: number) {
    const m = this.type.mech;
    const g = m.gears;
    if (this.gear > 0) {
      const rpmAt = (gi: number) => (v / (2 * Math.PI * this.type.wheelR)) * 60 * g[gi - 1] * m.final;
      if (this.gear < g.length && rpmAt(this.gear) > m.redline * 0.86) { this.gear++; this.shiftT = 0.22; }
      else if (this.gear > 1 && rpmAt(this.gear - 1) < m.redline * 0.55 && !(this.throttleIn > 0.5 && rpmAt(this.gear) > m.redline * 0.4)) { this.gear--; this.shiftT = 0.18; }
    }
    const ratio = this.gear < 0 ? g[0] : g[this.gear - 1];
    const wheelRpm = (v / (2 * Math.PI * this.type.wheelR)) * 60 * ratio * m.final;
    let target = Math.max(m.idle + this.throttleIn * (this.gear === 1 && v < 3 ? 1800 : 0), wheelRpm);
    if (this.skid > 0.4 && this.throttleIn > 0.5) target += 1500 * this.skid; // patinan las ruedas motrices
    target = Math.min(target, m.redline);
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 9 : 5));
    this.shiftT = Math.max(0, this.shiftT - dt);
  }

  // ------------------------------------------------------------------ modelo de neumáticos (jugador)
  private physics(dt: number, input: DriveInput) {
    // dos subpasos internos: las fuerzas de los neumáticos son rígidas
    const h = dt / 2;
    for (let k = 0; k < 2; k++) this.physicsStep(h, input);
    this.engineRpm(Math.abs(this.forwardSpeed()), dt);
  }

  private physicsStep(dt: number, input: DriveInput) {
    const t = this.type, m = t.mech, b = BODIES[t.id === 'taxi' || t.id === 'policia' ? 'berlina' : t.id];
    const mass = m.mass, g = 9.81;
    const wf = b ? b.wf : 3.3, wr = b ? b.wr : -2.8, wb = wf - wr;
    const a = wb * (1 - m.cgFront), bb = wb * m.cgFront; // distancias del c.d.g. a los ejes
    const Iz = mass * (t.length * t.length + t.width * t.width) / 12 * 0.85;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx; // derecha
    const vf = this.vel.x * fx + this.vel.y * fz;
    const vr = this.vel.x * rx + this.vel.y * rz;
    const speed = Math.hypot(vf, vr);

    // Pedales: el mismo eje sirve de acelerador/freno/marcha atrás como en los juegos
    let thr = 0, brk = 0;
    if (input.throttle > 0) { if (vf < -0.6) brk = input.throttle; else thr = input.throttle; if (this.gear < 0 && vf > -0.6) this.gear = 1; }
    else if (input.throttle < 0) { if (vf > 0.6) brk = -input.throttle; else { thr = -input.throttle; this.gear = -1; } }
    if (this.health <= 0 || this.burnt) thr = 0;
    this.throttleIn = thr; this.brakeIn = brk;

    // Cargas por eje con transferencia longitudinal
    const Nf = Math.max(0.15, mass * g * m.cgFront - mass * this.ax * m.cgH / wb);
    const Nr = Math.max(0.15, mass * g * (1 - m.cgFront) + mass * this.ax * m.cgH / wb);
    const mu = m.mu * (this.airborne ? 0 : 1);

    // Motor: par según la curva y la marcha
    const ratio = this.gear < 0 ? -m.gears[0] : m.gears[Math.max(0, this.gear - 1)];
    const rpmN = clamp(this.rpm / m.redline, 0, 1);
    const curve = 0.72 + 0.5 * Math.sin(Math.PI * clamp(rpmN * 1.05, 0, 1)) * 0.56 + (rpmN < 0.2 ? 0.1 : 0);
    let drive = this.shiftT > 0 ? 0 : (thr * m.torque * curve * ratio * m.final * 0.88) / t.wheelR;
    if (this.rpm >= m.redline - 30 && this.gear > 0 && thr > 0) drive *= 0.2; // corte de inyección
    if (this.gear < 0) drive = -Math.abs(drive) * 0.7;
    // límite de tracción del eje motriz
    const Nd = m.drive === 'F' ? Nf : m.drive === 'R' ? Nr : Nf + Nr;
    const tract = mu * Nd;
    let spin = 0;
    if (Math.abs(drive) > tract) { spin = clamp((Math.abs(drive) / tract - 1.3) / 1.2, 0, 1); drive = Math.sign(drive) * tract * 0.92; }
    let Fx = drive;
    // frenos (reparto 65/35) y resistencias
    const brakeF = brk * mu * mass * g * m.brake * 0.95;
    if (Math.abs(vf) > 0.05) Fx -= Math.sign(vf) * brakeF;
    else if (brk > 0) Fx -= vf * mass / dt * 0.5;
    Fx -= vf * Math.abs(vf) * m.dragK * 1.9 + Math.sign(vf) * Math.min(Math.abs(vf) * 400, 0.013 * mass * g);
    if (thr === 0 && brk === 0) Fx -= Math.sign(vf) * Math.min(Math.abs(vf) * mass * 0.6, mass * 0.55); // freno motor
    if (!this.airborne) Fx -= mass * g * Math.sin(this.pitch); // cuestas

    // Dirección: menos ángulo cuanto más rápido, con retorno y contravolante asistido
    const maxSteer = (t.id === 'autobus' ? 0.62 : 0.6) / (1 + speed / 12);
    let target = input.steer * maxSteer;
    if (speed > 6 && input.steer === 0) target += clamp(Math.atan2(vr, Math.abs(vf)) * 0.6, -0.25, 0.25); // ayuda a recuperar el derrape
    const rate = 2.6 + (Math.abs(target) < Math.abs(this.steerAngle) ? 2 : 0);
    this.steerAngle += clamp(target - this.steerAngle, -rate * dt, rate * dt);
    const d = this.steerAngle;

    // Ángulos de deriva y fuerzas laterales (curva tipo Pacejka simplificada)
    const r = this.yawRate;
    const avf = Math.max(Math.abs(vf), 0.5);
    const sgn = vf >= 0 ? 1 : -1;
    const latF = vr - a * r, latR = vr + bb * r;
    const alphaF = Math.atan2(latF, avf) - d * sgn;
    const alphaR = Math.atan2(latR, avf);
    const tire = (al: number, N: number, muE: number) => muE * N * Math.sin(1.45 * Math.atan(1.9 * al / 0.1));
    const hb = input.handbrake;
    let muF = mu, muR = mu * (hb ? 0.6 : 1);
    // círculo de fricción en el eje motriz
    const useF = m.drive === 'F' ? Math.min(1, Math.abs(drive) / Math.max(1, mu * Nf)) : 0;
    const useR = m.drive === 'R' ? Math.min(1, Math.abs(drive) / Math.max(1, mu * Nr)) : 0;
    muF *= Math.sqrt(Math.max(0.15, 1 - useF * useF));
    muR *= Math.sqrt(Math.max(0.15, 1 - useR * useR));
    const Fyf = -tire(alphaF, Nf, muF);
    let Fyr = -tire(alphaR, Nr, muR * 1.08); // el eje trasero agarra un poco más: tendencia subviradora estable
    if (hb && Math.abs(vf) > 0.5) Fx -= Math.sign(vf) * mu * Nr * 0.6;
    if (hb && Math.abs(vf) <= 0.5) Fx -= vf * mass / dt * 0.3;
    if (speed < 0.6) Fyr *= speed / 0.6;

    // Ecuaciones del movimiento (fuerzas en ejes del coche → mundo)
    const Flong = Fx - Fyf * Math.sin(d);
    const Flat = Fyf * Math.cos(d) + Fyr;
    const accF = Flong / mass, accR = Flat / mass;
    const rDot = (-a * Fyf * Math.cos(d) + bb * Fyr) / Iz;
    // a muy baja velocidad, modelo cinemático (sin deriva)
    const blend = clamp((speed - 1.5) / 3, 0, 1);
    this.vel.x += (fx * accF + rx * accR) * dt;
    this.vel.y += (fz * accF + rz * accR) * dt;
    this.yawRate += rDot * dt;
    if (blend < 1) {
      const vf2 = this.vel.x * fx + this.vel.y * fz;
      const vr2 = this.vel.x * rx + this.vel.y * rz;
      const rKin = (-vf2 * Math.tan(d)) / wb;
      this.yawRate = this.yawRate * blend + rKin * (1 - blend);
      const vrK = vr2 * (blend + (1 - blend) * Math.exp(-12 * dt));
      this.vel.set(fx * vf2 + rx * vrK, fz * vf2 + rz * vrK);
    }
    if (this.airborne) this.yawRate *= Math.exp(-0.5 * dt);
    if (hb) this.yawRate *= Math.exp(-0.9 * dt);
    else if (speed > 4 && !this.airborne) {
      // control de estabilidad: frena el sobreviraje que supera lo que pide el volante
      const rRef = clamp((-vf * Math.tan(d)) / wb, -(mu * g) / speed, (mu * g) / speed);
      if (Math.abs(this.yawRate) > Math.abs(rRef) + 0.15) this.yawRate += (rRef - this.yawRate) * Math.min(1, 1.6 * dt);
    }
    this.yawRate = clamp(this.yawRate, -3, 3);
    this.heading += this.yawRate * dt;
    // aceleraciones suavizadas para la transferencia de pesos y el balanceo
    this.ax += (accF - this.ax) * Math.min(1, dt * 10);
    this.aLat += (accR - this.aLat) * Math.min(1, dt * 10);

    // derrape: deriva del eje trasero, ruedas bloqueadas o patinando
    const slip = Math.max(Math.abs(alphaR) > 0.16 ? (Math.abs(alphaR) - 0.16) * 3 : 0, Math.abs(alphaF) > 0.2 ? (Math.abs(alphaF) - 0.2) * 2 : 0, spin, brk > 0.9 && speed > 8 ? 0.5 : 0, hb && speed > 4 ? 0.8 : 0);
    this.skid = clamp(slip, 0, 1) * clamp(speed / 5, 0, 1) * (this.airborne ? 0 : 1);
  }

  /** Abolla la carrocería en el punto de impacto (dirección en mundo hacia el obstáculo). */
  damage(dx: number, dz: number, force: number) {
    this.health = Math.max(0, this.health - (force - 4) * (this.type.id === 'autobus' ? 0.8 : 3));
    // dirección local: +x izquierda, +z delante
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const L = this.type.length / 2, W = this.type.width / 2;
    const k = Math.min(W / Math.max(1e-3, Math.abs(lx)), L / Math.max(1e-3, Math.abs(lz)));
    const px = lx * k, pz = lz * k, py = 0.75;
    const R = Math.min(1.3, 0.55 + force * 0.04);
    const depth = Math.min(0.22, (force - 4) * 0.018);
    for (const o of this.orig) {
      const p = o.g.attributes.position as THREE.BufferAttribute;
      const arr = p.array as Float32Array;
      let moved = false;
      for (let i = 0; i < arr.length; i += 3) {
        const ddx = arr[i] - px, ddy = arr[i + 1] - py, ddz = arr[i + 2] - pz;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy * 0.5 + ddz * ddz);
        if (dist > R) continue;
        const f = depth * (1 - dist / R) ** 2;
        const nx = arr[i] - lx * f, ny = arr[i + 1] - f * 0.25, nz = arr[i + 2] - lz * f;
        // no más de 35 cm respecto a la forma original
        const ox = o.p[i], oy = o.p[i + 1], oz = o.p[i + 2];
        const dd = Math.hypot(nx - ox, ny - oy, nz - oz);
        const lim = dd > 0.35 ? 0.35 / dd : 1;
        arr[i] = ox + (nx - ox) * lim; arr[i + 1] = oy + (ny - oy) * lim; arr[i + 2] = oz + (nz - oz) * lim;
        moved = true;
      }
      if (moved) { p.needsUpdate = true; if (o.g === this.model.body) o.g.computeVertexNormals(); }
    }
  }

  private updateLights(dt: number) {
    const u = this.lightU;
    u.uBrake.value = this.brakeIn > 0.1 || (this.driver !== 'none' && this.speed < 0.3 && this.throttleIn === 0) ? 1 : 0;
    u.uRev.value = this.gear < 0 && this.driver !== 'none' ? 1 : 0;
    u.uSiren.value = this.siren && !this.burnt ? 1 : 0;
    const on = (Math.floor(performance.now() / 380) % 2) === 0 ? 1 : 0;
    u.uBlinkL.value = this.blink > 0 || this.health < 15 ? on : 0;
    u.uBlinkR.value = this.blink < 0 || this.health < 15 ? on : 0;
    this.driverMesh.visible = this.driver !== 'none' && !this.hideDriver && !this.burnt && !this.far;
    // vista desde el asiento: pilares delanteros y marco del techo (la chapa del habitáculo no se ve desde dentro)
    if (this.pillars) this.pillars.visible = this.hideDriver;
    void dt;
  }

  private effects(dt: number) {
    const fx = Vehicle.fx;
    if (!fx) return;
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const toW = (x: number, y: number, z: number) => _v.set(this.pos.x + x * c + z * s, this.pos.y + y, this.pos.z - x * s + z * c);
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.08;
      if (this.health < 35) {
        const p = toW(...this.model.hood);
        fx.smoke(p.x, p.y, p.z, this.health <= 0 ? 0.9 : 0.4, this.health <= 0 ? 1.6 : 0.9);
      }
      if (this.skid > 0.35) {
        for (const w of this.wheels) if (!w.front && Math.random() < 0.7) {
          const p = toW(w.x, 0.15, w.z);
          fx.smoke(p.x, p.y, p.z, 0, 0.6 + this.skid);
        }
      }
      if (this.throttleIn > 0.6 && this.speed < 6 && this.driver !== 'none') {
        const p = toW(...this.model.exhaust);
        fx.smoke(p.x, p.y, p.z, this.type.engine === 'diesel' ? 0.5 : 0.15, 0.35);
      }
    }
    // marcas de frenada cada 0,4 m mientras derrapa
    this.skidAcc += this.speed * dt;
    if (this.skid > 0.3 && this.skidAcc > 0.4) {
      this.skidAcc = 0;
      this.wheels.forEach((w, i) => {
        if (w.front && this.skid < 0.8) return;
        const p = toW(w.x, 0, w.z);
        fx.skid(p.x, p.y, p.z, this.heading, this.id, i);
      });
    }
  }

  /** Altura, cabeceo y alabeo según el terreno bajo las ruedas; saltos en los cambios de rasante. */
  private followGround(dt: number, ground: Ground) {
    const t = this.type;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    const hl = t.wheelbase / 2, hw = t.width * 0.42;
    const y = this.pos.y;
    const yF = ground.heightAt(this.pos.x + fx * hl, this.pos.z + fz * hl, y);
    const yB = ground.heightAt(this.pos.x - fx * hl, this.pos.z - fz * hl, y);
    const yR = ground.heightAt(this.pos.x + rx * hw, this.pos.z + rz * hw, y);
    const yL = ground.heightAt(this.pos.x - rx * hw, this.pos.z - rz * hw, y);
    const gy = (yF + yB) / 2;
    if (this.pos.y > gy + 0.08) {
      this.airborne = true;
      this.vy -= 18 * dt;
      this.pos.y += this.vy * dt;
    }
    if (this.pos.y <= gy + 0.08) {
      if (this.airborne && this.vy < -6) {
        this.lastImpact = Math.max(this.lastImpact, -this.vy * 0.6);
        this.bodyPv += this.vy * 0.04; // la suspensión absorbe la caída
      }
      this.vy = dt > 0 ? Math.max(-30, Math.min(30, (gy - this.pos.y) / dt)) * 0.6 : 0;
      this.pos.y = gy;
      this.airborne = false;
    }
    const targetPitch = Math.atan2(yF - yB, hl * 2);
    const targetRoll = Math.atan2(yR - yL, hw * 2);
    const k = Math.min(1, dt * (this.airborne ? 1.5 : 12));
    this.pitch += (targetPitch - this.pitch) * k;
    this.roll += (targetRoll - this.roll) * k;
  }

  private syncMesh(dt: number) {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(-this.pitch, this.heading, 0, 'YXZ');
    this.mesh.rotateZ(-this.roll);
    // Suspensión: cabeceo al acelerar/frenar y balanceo en curva (muelle amortiguado)
    if (dt > 0) {
      const soft = this.type.id === 'autobus' ? 1.4 : this.type.id === 'deportivo' ? 0.5 : 1;
      const tp = clamp(-this.ax * 0.0065 * soft, -0.06, 0.06);
      const tr = clamp(-this.aLat * 0.0075 * soft, -0.07, 0.07);
      const kS = 110, cS = 13;
      this.bodyPv += ((tp - this.bodyP) * kS - this.bodyPv * cS) * dt;
      this.bodyRv += ((tr - this.bodyR) * kS - this.bodyRv * cS) * dt;
      this.bodyP += this.bodyPv * dt;
      this.bodyR += this.bodyRv * dt;
      this.body.rotation.x = this.bodyP;
      this.body.rotation.z = this.bodyR;
    }
    const vf = this.forwardSpeed();
    this.wheelSpin += ((this.skid > 0.6 && this.brakeIn > 0.9 ? 0 : vf) / this.type.wheelR) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = -this.steerAngle;
    }
  }
}

function pickWeighted(list: [number, number][]) {
  let tot = 0;
  for (const [, w] of list) tot += w;
  let r = Math.random() * tot;
  for (const [c, w] of list) { r -= w; if (r <= 0) return c; }
  return list[0][0];
}

function angleSign(h: { nx: number; nz: number }, fx: number, fz: number) {
  // Lado del golpe respecto al eje del coche
  return Math.sign(h.nx * -fz + h.nz * fx) || 1;
}

/** Choques entre vehículos: cada coche son dos círculos. */
export function resolveVehicleCollisions(vs: Vehicle[]) {
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    for (let j = i + 1; j < vs.length; j++) {
      const b = vs[j];
      const dx0 = a.pos.x - b.pos.x, dz0 = a.pos.z - b.pos.z;
      const reach = (a.type.length + b.type.length) / 2 + 0.5;
      if (dx0 * dx0 + dz0 * dz0 > reach * reach) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 2.5) continue;
      const ca = a.circles(), cb = b.circles();
      for (const [ax, az] of [[ca[0], ca[1]], [ca[2], ca[3]]]) {
        for (const [bx, bz] of [[cb[0], cb[1]], [cb[2], cb[3]]]) {
          const dx = ax - bx, dz = az - bz;
          const rr = ca[4] + cb[4];
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          const depth = rr - d;
          // los coches aparcados (sin conductor) apenas se mueven: así no acaban invadiendo el carril
          const ma = a.driver === 'none' && a.speed < 0.5 ? a.type.mass * 8 : a.type.mass;
          const mb = b.driver === 'none' && b.speed < 0.5 ? b.type.mass * 8 : b.type.mass;
          const wa = mb / (ma + mb);
          const wb = 1 - wa;
          a.pos.x += nx * depth * wa; a.pos.z += nz * depth * wa;
          b.pos.x -= nx * depth * wb; b.pos.z -= nz * depth * wb;
          // Impulso inelástico
          const rv = (a.vel.x - b.vel.x) * nx + (a.vel.y - b.vel.y) * nz;
          if (rv < 0) {
            const jimp = -(1.3) * rv;
            a.vel.x += nx * jimp * wa; a.vel.y += nz * jimp * wa;
            b.vel.x -= nx * jimp * wb; b.vel.y -= nz * jimp * wb;
            a.lastImpact = Math.max(a.lastImpact, -rv);
            b.lastImpact = Math.max(b.lastImpact, -rv);
            // el golpe descentrado hace girar
            const la = (ax - a.pos.x) * nz - (az - a.pos.z) * nx, lb = (bx - b.pos.x) * nz - (bz - b.pos.z) * nx;
            a.yawRate += clamp(la * jimp * wa * 0.08, -2, 2);
            b.yawRate -= clamp(lb * jimp * wb * 0.08, -2, 2);
            if (-rv > 4) { a.damage(-nx, -nz, -rv); b.damage(nx, nz, -rv); }
          }
        }
      }
    }
  }
}
