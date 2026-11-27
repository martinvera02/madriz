import * as THREE from 'three';
import { angleDiff } from '../config';

/**
 * Helicóptero de la policía (5 estrellas): sigue al jugador en círculos a unos 45 m sobre el suelo,
 * le alumbra con el foco de noche y un tirador dispara desde la puerta abierta.
 * Se puede derribar: con la vida a cero cae girando y revienta contra el suelo.
 */
export class Helicopter {
  readonly mesh = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  heading = 0;
  health = 600;
  /** Cayendo (derribado) y ya en el suelo. */
  falling = false;
  crashed = false;
  private rotor: THREE.Object3D;
  private tailRotor: THREE.Object3D;
  private orbit = Math.random() * Math.PI * 2;
  private spin = 0;
  readonly light: THREE.SpotLight;

  constructor() {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.45, metalness: 0.2 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1d3f8c, roughness: 0.5, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.7, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x2b3a46, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.75 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.mesh) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o;
    };
    // cabina: cápsula achatada con franja azul y morro acristalado
    const cab = add(new THREE.CapsuleGeometry(1.15, 2.4, 4, 10).rotateX(Math.PI / 2), white, 0, 0, 0);
    cab.scale.set(1, 0.95, 1);
    add(new THREE.CapsuleGeometry(1.17, 2.0, 4, 10).rotateX(Math.PI / 2), blue, 0, -0.35, 0.1).scale.set(1, 0.35, 1);
    add(new THREE.SphereGeometry(1.0, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), glass, 0, 0.15, 1.75).scale.set(1.02, 0.9, 0.7);
    // botalón de cola, deriva y rotor de cola
    add(new THREE.CylinderGeometry(0.22, 0.38, 5.2, 8).rotateX(Math.PI / 2), white, 0, 0.35, -4.0);
    add(new THREE.BoxGeometry(0.12, 1.4, 0.8), blue, 0, 0.95, -6.4);
    add(new THREE.BoxGeometry(1.6, 0.08, 0.5), blue, 0, 0.45, -6.1);
    this.tailRotor = new THREE.Group();
    this.tailRotor.position.set(0.22, 0.9, -6.5);
    add(new THREE.BoxGeometry(0.04, 1.5, 0.14), dark, 0, 0, 0, this.tailRotor);
    this.mesh.add(this.tailRotor);
    // patines
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.1, 0.1, 3.4), dark, s * 1.0, -1.45, 0.2);
      for (const z of [-0.6, 1.0]) add(new THREE.BoxGeometry(0.08, 0.5, 0.08), dark, s * 0.85, -1.2, z).rotation.z = s * 0.35;
    }
    // mástil y rotor principal (cuatro palas)
    add(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8), dark, 0, 1.3, 0);
    this.rotor = new THREE.Group();
    this.rotor.position.set(0, 1.6, 0);
    for (let k = 0; k < 4; k++) {
      const b = add(new THREE.BoxGeometry(0.28, 0.05, 5.2), dark, 0, 0, 0, this.rotor);
      b.geometry.translate(0, 0, 2.6);
      b.rotation.y = (k * Math.PI) / 2;
    }
    this.mesh.add(this.rotor);
    // foco orientable bajo el morro
    this.light = new THREE.SpotLight(0xf4f1e6, 0, 140, 0.16, 0.5, 1.2);
    this.light.position.set(0, -1.2, 1.6);
    this.mesh.add(this.light, this.light.target);
  }

  /** Aparece a `d` metros del objetivo, ya a su altura de crucero. */
  spawn(target: THREE.Vector3, groundY: number, d = 260) {
    const a = Math.random() * Math.PI * 2;
    this.pos.set(target.x + Math.sin(a) * d, groundY + 55, target.z + Math.cos(a) * d);
    this.vel.set(0, 0, 0);
    this.heading = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.health = 600; this.falling = false; this.crashed = false;
    this.mesh.visible = true;
  }

  /**
   * Vuelo: punto de órbita a 30 m del objetivo, a `alt` m sobre el suelo, con aceleración limitada.
   * Derribado: cae girando hasta `groundY` (devuelve true el instante en que toca suelo).
   */
  update(dt: number, target: THREE.Vector3, groundY: number, night: number, alt = 45): boolean {
    this.rotor.rotation.y += dt * (this.falling ? 14 : 26);
    this.tailRotor.rotation.x += dt * 40;
    if (this.crashed) return false;
    if (this.falling) {
      this.vel.y -= 9.8 * dt;
      this.spin += dt * 4;
      this.heading += this.spin * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.sync(dt, 0);
      if (this.pos.y <= groundY + 1.2) {
        this.pos.y = groundY + 1.2; this.crashed = true;
        // restos calcinados
        this.mesh.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.color) { m.color.setHex(0x1d1b1a); m.roughness = 1; } });
        this.mesh.rotation.z = 0.5;
        return true;
      }
      return false;
    }
    this.orbit += dt * 0.22;
    const gx = target.x + Math.sin(this.orbit) * 30, gz = target.z + Math.cos(this.orbit) * 30, gy = groundY + alt;
    const want = new THREE.Vector3(gx - this.pos.x, gy - this.pos.y, gz - this.pos.z);
    const dist = want.length();
    const maxV = 28;
    want.multiplyScalar(Math.min(maxV, dist * 0.6) / Math.max(dist, 1e-3));
    const k = Math.min(1, dt * 1.2);
    this.vel.lerp(want, k);
    this.pos.addScaledVector(this.vel, dt);
    // morro hacia el jugador (el tirador va en la puerta y el foco en el morro)
    const h = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.heading += angleDiff(h, this.heading) * Math.min(1, dt * 1.5);
    this.light.intensity = night > 0.3 ? 2600 : 0;
    this.light.target.position.copy(target).sub(this.pos).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.heading);
    this.sync(dt, 1);
    return false;
  }

  /** Derribado. */
  shootDown() {
    if (this.falling) return;
    this.falling = true;
    this.light.intensity = 0;
    this.vel.multiplyScalar(0.4);
  }

  /** Posición de la puerta del tirador (lado izquierdo). */
  gunner(out: THREE.Vector3) {
    return out.set(Math.cos(this.heading) * 1.3, -0.4, -Math.sin(this.heading) * 1.3).add(this.pos);
  }

  private sync(dt: number, tilt: number) {
    this.mesh.position.copy(this.pos);
    // inclinación hacia donde avanza
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const fwd = this.vel.x * s + this.vel.z * c, side = this.vel.x * c - this.vel.z * s;
    this.mesh.rotation.set(THREE.MathUtils.clamp(fwd * 0.012, -0.3, 0.3) * tilt, this.heading, THREE.MathUtils.clamp(-side * 0.012, -0.3, 0.3) * tilt + (this.falling ? Math.sin(this.spin) * 0.3 : 0), 'YXZ');
    void dt;
  }

  dispose() {
    this.mesh.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
}
