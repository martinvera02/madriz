import * as THREE from 'three';
import { angleDiff, clamp } from '../config';
import { CollisionWorld } from '../world/collision';

/** Cámara orbital en tercera persona con autocentrado al conducir y colisión con edificios. */
export class CameraRig {
  yaw = Math.PI; // dirección en la que mira la cámara
  pitch = 0.28;
  private dist = 5.5;
  private idle = 0;
  private shake = 0;
  private readonly target = new THREE.Vector3();
  /** Primera persona: la cámara va en los ojos del personaje o en el asiento del conductor. */
  firstPerson = false;
  /** Sensibilidad del ratón (multiplicador) y eje vertical invertido. */
  sens = 1;
  invertY = false;
  private fpCarYaw = 0; // giro de la cabeza respecto al coche
  private bob = 0;
  private curD = 5.5;
  private aimK = 0;
  private fpY = NaN;

  constructor(readonly camera: THREE.PerspectiveCamera, private world: CollisionWorld, private heightAt: (x: number, z: number, y?: number) => number) {}

  addShake(amount: number) { this.shake = Math.min(1, this.shake + amount); }

  update(dt: number, mouseDX: number, mouseDY: number, focus: THREE.Vector3, opts: { inCar: boolean; carHeading: number; speed: number; lookBack?: boolean; padX?: number; padY?: number; eye?: THREE.Vector3; walkSpeed?: number; aiming?: boolean }) {
    mouseDX *= this.sens;
    mouseDY *= this.sens * (this.invertY ? -1 : 1);
    if (opts.padX || opts.padY) { mouseDX += (opts.padX ?? 0) * 900 * dt; mouseDY += (opts.padY ?? 0) * 600 * dt; }
    if (this.firstPerson && opts.eye) { this.updateFirstPerson(dt, mouseDX, mouseDY, opts as typeof opts & { eye: THREE.Vector3 }); return; }
    if (mouseDX || mouseDY) {
      this.yaw -= mouseDX * 0.0024;
      this.pitch = clamp(this.pitch + mouseDY * 0.0022, -0.25, 1.15);
      this.idle = 0;
    } else this.idle += dt;

    if (opts.inCar && this.idle > 1.0 && opts.speed > 2) {
      this.yaw += angleDiff(opts.carHeading, this.yaw) * Math.min(1, dt * 2.5);
      this.pitch += (0.2 - this.pitch) * Math.min(1, dt * 1.5);
    }

    // apuntando: cámara al hombro, más cerca y con menos campo de visión
    this.aimK += ((opts.aiming ? 1 : 0) - this.aimK) * Math.min(1, dt * 10);
    const wantDist = opts.inCar ? 9 + Math.min(opts.speed, 40) * 0.08 : 5.5 - 3.1 * this.aimK;
    this.dist += (wantDist - this.dist) * Math.min(1, dt * 3);
    const height = opts.inCar ? 2.0 : 1.6;
    // horizontal ágil, vertical más lenta: los bordillos y las cuestas no sacuden la imagen
    const kx = Math.min(1, dt * (opts.inCar ? 14 : 10)), ky = Math.min(1, dt * (opts.inCar ? 8 : 5));
    this.target.x += (focus.x - this.target.x) * kx;
    this.target.z += (focus.z - this.target.z) * kx;
    this.target.y += (focus.y + height - this.target.y) * ky;
    if (this.target.distanceToSquared(focus) > 400) this.target.copy(focus).setY(focus.y + height);
    const shoulder = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)).multiplyScalar(0.6 * this.aimK);

    const yaw = opts.lookBack && opts.inCar ? opts.carHeading + Math.PI : this.yaw; // mirar atrás
    const dir = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(yaw) * Math.cos(this.pitch),
    );
    // Acercar la cámara si hay un edificio entre ella y el jugador
    let d = this.dist;
    for (let s = 0.8; s <= this.dist; s += 0.5) {
      const px = this.target.x - dir.x * s, py = this.target.y - dir.y * s, pz = this.target.z - dir.z * s;
      if (py < this.heightAt(px, pz, py) + 0.4 || this.world.pointBlocked(px, py, pz)) { d = Math.max(0.8, s - 0.6); break; }
    }
    // se acerca rápido si hay un obstáculo, pero vuelve a alejarse despacio
    this.curD = d < this.curD ? d : Math.min(d, this.curD + dt * 2.5);
    const cam = this.camera;
    cam.position.copy(this.target).add(shoulder).addScaledVector(dir, -this.curD);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    cam.lookAt(this.target.clone().add(shoulder));

    this.setFov(dt, 62 + (opts.inCar ? Math.min(opts.speed, 50) * 0.25 : 0) - 10 * this.aimK);
  }

  private setFov(dt: number, fov: number) {
    const cam = this.camera;
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }

  private updateFirstPerson(dt: number, mouseDX: number, mouseDY: number, opts: { inCar: boolean; carHeading: number; speed: number; lookBack?: boolean; eye: THREE.Vector3; walkSpeed?: number; aiming?: boolean }) {
    const cam = this.camera;
    if (opts.inCar) {
      // La cabeza mira al frente del coche; el ratón la gira y vuelve sola al centro
      if (mouseDX || mouseDY) { this.fpCarYaw = clamp(this.fpCarYaw - mouseDX * 0.0024, -2.2, 2.2); this.idle = 0; }
      else { this.idle += dt; if (this.idle > 0.8) this.fpCarYaw *= Math.exp(-3 * dt); }
      this.pitch = clamp(this.pitch + mouseDY * 0.0022, -0.6, 0.6);
      if (!mouseDY && this.idle > 0.8) this.pitch += (0.06 - this.pitch) * Math.min(1, dt * 2);
      this.yaw = opts.carHeading + this.fpCarYaw + (opts.lookBack ? Math.PI : 0);
    } else {
      this.yaw -= mouseDX * 0.0024;
      this.pitch = clamp(this.pitch + mouseDY * 0.0022, -1.35, 1.35);
      this.fpCarYaw = 0;
    }
    // balanceo al andar
    const ws = opts.inCar ? 0 : opts.walkSpeed ?? 0;
    this.bob += (dt * ws) / ((0.85 + Math.max(0, Math.min(1, (ws - 4.5) / 2.5)) * 0.55));
    // balanceo de cabeza sutil, al ritmo de los pasos
    const k = Math.min(1, ws / 5);
    const bobY = Math.sin(this.bob * Math.PI * 2) * 0.014 * k;
    const bobX = Math.cos(this.bob * Math.PI) * 0.01 * k;
    if (Number.isNaN(this.fpY) || Math.abs(opts.eye.y - this.fpY) > 1.5 || opts.inCar) this.fpY = opts.eye.y;
    else this.fpY += (opts.eye.y - this.fpY) * Math.min(1, dt * 10);
    cam.position.copy(opts.eye);
    cam.position.y = this.fpY + bobY;
    cam.position.x += Math.cos(this.yaw) * bobX;
    cam.position.z -= Math.sin(this.yaw) * bobX;
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.15;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.15;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    cam.lookAt(cam.position.clone().add(dir));
    this.target.copy(cam.position);
    this.setFov(dt, (opts.aiming ? 56 : 72) + (opts.inCar ? Math.min(opts.speed, 50) * 0.18 : 0));
  }
}
