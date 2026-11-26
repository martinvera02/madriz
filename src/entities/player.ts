import * as THREE from 'three';
import { angleDiff } from '../config';
import { CollisionWorld } from '../world/collision';
import { Character } from './character';
import { Vehicle } from './vehicle';
import { Input } from '../systems/input';
import type { Ground } from '../world/roads';

const WALK = 3.4;
const RUN = 7.6;
const JUMP = 5.2;
const GRAVITY = 18;

const clampAxis = (v: number) => Math.max(-1, Math.min(1, v));

export class Player {
  readonly ch = new Character({ skin: 0xe0ac85, shirt: 0xf2f2f2, pants: 0x2b3a55, hair: 0x1a1410 });
  readonly pos = new THREE.Vector3();
  heading = 0;
  /** Altura suavizada de la figura (para la cámara). */
  get smoothY() { return this.ch.root.position.y; }
  /** Velocidad a pie (para los pasos). */
  get footSpeed() { return this.moveSpeed; }
  get grounded() { return this.onGround; }
  private velY = 0;
  private onGround = true;
  private moveSpeed = 0;
  private moveDir = 0;
  vehicle: Vehicle | null = null;

  constructor(scene: THREE.Scene) {
    scene.add(this.ch.root);
  }

  /** Vida del jugador (0–100). */
  health = 100;
  /** Suelo fijo (dentro de los locales, que están fuera del mapa). */
  floorOverride: number | null = null;
  /** Apuntando: el cuerpo mira hacia la cámara y se anda más despacio, de lado si hace falta. */
  aiming = false;

  updateOnFoot(dt: number, input: Input, camYaw: number, world: CollisionWorld, ground: Ground) {
    const fwd = clampAxis(input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) - input.pad.ly);
    const str = clampAxis(input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) + input.pad.lx);
    const running = input.isDown('ShiftLeft') || input.isDown('ShiftRight') || input.padDown(2);
    const moving = fwd !== 0 || str !== 0;
    const mag = Math.min(1, Math.hypot(fwd, str));
    const target = moving ? (this.aiming ? 2.2 : running ? RUN : WALK) * Math.max(0.35, mag) : 0;
    this.moveSpeed += (target - this.moveSpeed) * Math.min(1, dt * (target > this.moveSpeed ? 5 : 7)); // arranques y frenadas progresivos

    if (moving) {
      // Dirección relativa a la cámara (la cámara mira hacia camYaw)
      const cf = new THREE.Vector2(Math.sin(camYaw), Math.cos(camYaw));
      const cr = new THREE.Vector2(-cf.y, cf.x);
      const dx = cf.x * fwd + cr.x * str;
      const dz = cf.y * fwd + cr.y * str;
      const desired = Math.atan2(dx, dz);
      this.moveDir += angleDiff(desired, this.moveDir) * Math.min(1, dt * 9);
      if (!this.aiming) this.heading += angleDiff(desired, this.heading) * Math.min(1, dt * 9);
    }
    if (this.aiming) this.heading += angleDiff(camYaw, this.heading) * Math.min(1, dt * 16);
    const dir = this.aiming ? this.moveDir : this.heading;
    this.pos.x += Math.sin(dir) * this.moveSpeed * dt;
    this.pos.z += Math.cos(dir) * this.moveSpeed * dt;

    // Salto y gravedad
    if (this.onGround && (input.wasPressed('Space') || input.padPressed(0))) {
      this.velY = JUMP;
      this.onGround = false;
    }
    this.velY -= GRAVITY * dt;
    this.pos.y += this.velY * dt;
    world.resolveCircle(this.pos, 0.4, this.pos.y);
    const floor = this.floorOverride ?? ground.heightAt(this.pos.x, this.pos.z, this.pos.y);
    const g = world.groundHeight(this.pos.x, this.pos.z, this.pos.y, floor);
    if (this.pos.y <= g || (this.onGround && this.pos.y - g < 0.4 && this.velY <= 0)) {
      // pegado al suelo al bajar cuestas y escaleras
      this.pos.y = g;
      this.velY = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // la figura sigue la altura con suavidad (bordillos, escalones) en vez de dar saltitos
    const r = this.ch.root.position;
    r.x = this.pos.x; r.z = this.pos.z;
    r.y = Math.abs(this.pos.y - r.y) > 1 || !this.onGround ? this.pos.y : r.y + (this.pos.y - r.y) * Math.min(1, dt * 14);
    this.ch.root.rotation.y = this.heading;
    this.ch.animate(dt, this.moveSpeed, !this.onGround);
  }

  enter(v: Vehicle) {
    this.vehicle = v;
    v.driver = 'player';
    this.ch.root.visible = false;
  }

  /** Bajar por el lado del conductor (izquierda); si está bloqueado, por la derecha. */
  exit(world: CollisionWorld, ground: Ground) {
    const v = this.vehicle!;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const rx = -fz, rz = fx;
    const off = v.type.width / 2 + 0.7;
    for (const side of [-1, 1, 0]) {
      const x = v.pos.x + rx * off * side + (side === 0 ? fx * (v.type.length / 2 + 1) : 0);
      const z = v.pos.z + rz * off * side + (side === 0 ? fz * (v.type.length / 2 + 1) : 0);
      const y = ground.heightAt(x, z, v.pos.y + 1);
      if (!world.pointBlocked(x, y + 0.5, z)) {
        this.pos.set(x, y, z);
        break;
      }
    }
    this.heading = v.heading;
    v.driver = 'none';
    this.vehicle = null;
    this.ch.root.visible = true;
    this.ch.root.position.copy(this.pos);
  }
}
