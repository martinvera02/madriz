import * as THREE from 'three';
import type { CollisionWorld } from '../world/collision';
import type { Ground } from '../world/roads';
import type { Vehicle } from '../entities/vehicle';
import type { Character, Action, Prop } from '../entities/character';

/*
 * Armas y combate (sandbox): puños, bate, pistola, subfusil y escopeta.
 * Disparo por rayo desde la cámara (mira en el centro), con dispersión, munición y recarga;
 * golpes cuerpo a cuerpo en un cono delante del personaje. Los impactos dañan a personas y
 * coches (que pueden acabar ardiendo y explotando) y levantan polvo o chispas.
 */

export type WeaponId = 'punos' | 'bate' | 'pistola' | 'subfusil' | 'escopeta';
export interface WeaponDef {
  id: WeaponId; name: string; melee: boolean; damage: number; rate: number; range: number;
  mag?: number; reserve?: number; spread?: number; pellets?: number; auto?: boolean; reload?: number;
  prop: Prop; aim: Action; ready: Action; recoil?: 'recoil' | 'recoilBig';
}

export const WEAPONS: WeaponDef[] = [
  { id: 'punos', name: 'Puños', melee: true, damage: 14, rate: 0.38, range: 1.35, prop: 'none', aim: 'guard', ready: 'none' },
  { id: 'bate', name: 'Bate', melee: true, damage: 48, rate: 0.75, range: 1.9, prop: 'bat', aim: 'holdBat', ready: 'holdBat' },
  { id: 'pistola', name: 'Pistola', melee: false, damage: 34, rate: 0.26, range: 140, mag: 12, reserve: 96, spread: 0.008, reload: 1.3, prop: 'pistol', aim: 'aimPistol', ready: 'none', recoil: 'recoil' },
  { id: 'subfusil', name: 'Subfusil', melee: false, damage: 17, rate: 0.085, range: 120, mag: 30, reserve: 240, spread: 0.022, auto: true, reload: 1.9, prop: 'smg', aim: 'aimRifle', ready: 'none', recoil: 'recoil' },
  { id: 'escopeta', name: 'Escopeta', melee: false, damage: 13, rate: 0.95, range: 45, mag: 6, reserve: 42, spread: 0.06, pellets: 9, reload: 2.4, prop: 'shotgun', aim: 'aimRifle', ready: 'none', recoil: 'recoilBig' },
];

/** Algo a lo que se puede golpear o disparar. */
export interface Target {
  pos: THREE.Vector3; radius: number; height: number;
  alive: boolean;
  hit(damage: number, dirX: number, dirZ: number, melee: boolean, from: THREE.Vector3): void;
}

export interface CombatHooks {
  targets(): Target[];
  vehicles(): Vehicle[];
  smoke(x: number, y: number, z: number, dark: number, size: number): void;
  sound(kind: 'shot' | 'melee' | 'swish' | 'reload' | 'empty' | 'explosion' | 'ricochet', weapon: WeaponId | null, pos: THREE.Vector3): void;
  /** Disparos o peleas que asustan a la gente de alrededor. */
  alarm(pos: THREE.Vector3, radius: number): void;
  explode(v: Vehicle): void;
  /** Empieza una recarga (para la animación y el sonido). */
  onReload?(w: WeaponDef, duration: number): void;
  /** Delito cometido (para la policía): disparo, herido, muerto… */
  crime?(kind: 'shot' | 'hurt' | 'kill' | 'melee', pos: THREE.Vector3, target?: Target): void;
}

export class Combat {
  readonly group = new THREE.Group();
  weapon = 0;
  readonly ammo: number[] = WEAPONS.map((w) => w.mag ?? 0);
  /** Partida nueva: puños y pistola con algo de munición; el resto se compra en la armería. */
  readonly owned: boolean[] = WEAPONS.map((w) => w.id === 'punos' || w.id === 'pistola');
  readonly reserve: number[] = WEAPONS.map((w) => (w.id === 'pistola' ? 24 : 0));
  private cooldown = 0;
  reloading = 0;
  private comboL = false;
  /** Tiempo desde el último disparo del jugador (la policía lo tiene en cuenta). */
  sinceShot = 1e9;
  hitMarker = 0;
  private tracers: { line: THREE.Line; life: number }[] = [];
  private flashes: { m: THREE.Mesh; life: number }[] = [];
  private pendingMelee: { t: number; from: THREE.Vector3; heading: number; w: WeaponDef } | null = null;
  private tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9 });
  private flashMat = new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
  private flashGeo = new THREE.SphereGeometry(0.12, 6, 4);

  constructor(private world: CollisionWorld, private ground: Ground, private hooks: CombatHooks) {}

  get def() { return WEAPONS[this.weapon]; }

  select(i: number) {
    if (i < 0 || i >= WEAPONS.length || i === this.weapon || !this.owned[i]) return false;
    this.weapon = i;
    this.reloading = 0;
    this.cooldown = 0.25;
    return true;
  }
  cycle(d: number) {
    for (let k = 1; k < WEAPONS.length; k++) {
      const i = (this.weapon + d * k + WEAPONS.length * k) % WEAPONS.length;
      if (this.owned[i]) return this.select(i);
    }
    return false;
  }
  /** Arma nueva: cargador lleno y dos de repuesto. */
  give(i: number) {
    if (this.owned[i]) return;
    this.owned[i] = true;
    const w = WEAPONS[i];
    this.ammo[i] = w.mag ?? 0;
    this.reserve[i] = (w.mag ?? 0) * 2;
  }

  reload() {
    const w = this.def;
    if (w.melee || this.reloading > 0) return;
    const need = (w.mag ?? 0) - this.ammo[this.weapon];
    if (need <= 0 || this.reserve[this.weapon] <= 0) return;
    this.reloading = w.reload ?? 1.5;
    this.hooks.onReload?.(w, this.reloading);
  }

  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceShot += dt;
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const w = this.def;
        const need = (w.mag ?? 0) - this.ammo[this.weapon];
        const take = Math.min(need, this.reserve[this.weapon]);
        this.ammo[this.weapon] += take;
        this.reserve[this.weapon] -= take;
        this.reloading = 0;
      }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.06) * 0.9;
      if (t.life <= 0) { this.group.remove(t.line); t.line.geometry.dispose(); (t.line.material as THREE.Material).dispose(); this.tracers.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      f.m.scale.setScalar(0.6 + Math.random() * 0.8);
      if (f.life <= 0) { this.group.remove(f.m); this.flashes.splice(i, 1); }
    }
    if (this.pendingMelee && (this.pendingMelee.t -= dt) <= 0) {
      const p = this.pendingMelee;
      this.pendingMelee = null;
      this.resolveMelee(p.from, p.heading, p.w);
    }
  }

  /**
   * El jugador ataca. `trigger` = gatillo pulsado este frame (o mantenido en automáticas).
   * Devuelve true si ha disparado/golpeado (para animación y retroceso de cámara).
   */
  attack(ch: Character, pos: THREE.Vector3, heading: number, aimOrigin: THREE.Vector3, aimDir: THREE.Vector3, aiming: boolean,
    /** Boca del cañón de la vista en primera persona (si no, la del muñeco). Su fogonazo lo dibuja la propia vista. */
    viewMuzzle?: THREE.Vector3): boolean {
    const w = this.def;
    if (this.cooldown > 0 || this.reloading > 0) return false;
    if (w.melee) {
      this.cooldown = w.rate;
      if (w.id === 'punos') { this.comboL = !this.comboL; ch.play(this.comboL ? 'punchL' : 'punchR'); }
      else ch.play('swing');
      this.hooks.sound('swish', w.id, pos);
      this.pendingMelee = { t: w.id === 'bate' ? 0.28 : 0.14, from: pos.clone(), heading, w };
      return true;
    }
    if (!aiming) return false;
    if (this.ammo[this.weapon] <= 0) {
      this.cooldown = 0.3;
      this.hooks.sound('empty', w.id, pos);
      this.reload();
      return false;
    }
    this.ammo[this.weapon]--;
    this.cooldown = w.rate;
    this.sinceShot = 0;
    if (w.recoil) ch.play(w.recoil);
    let muzzle: THREE.Vector3;
    if (viewMuzzle) muzzle = viewMuzzle.clone();
    else if (ch.aimReady) muzzle = ch.muzzle(new THREE.Vector3());
    else {
      // aún subiendo el arma: el disparo sale a la altura del hombro derecho, hacia donde apuntas
      const right = new THREE.Vector3(-Math.cos(heading), 0, Math.sin(heading));
      muzzle = pos.clone().add(new THREE.Vector3(0, 1.42, 0)).addScaledVector(right, 0.22).addScaledVector(aimDir, 0.55);
    }
    if (!viewMuzzle) this.muzzleFlash(muzzle);
    this.hooks.sound('shot', w.id, muzzle);
    this.hooks.alarm(pos, w.id === 'escopeta' ? 55 : 45);
    this.hooks.crime?.('shot', pos);
    for (let k = 0; k < (w.pellets ?? 1); k++) {
      const d = aimDir.clone();
      const s = w.spread ?? 0;
      d.x += (Math.random() - 0.5) * 2 * s; d.y += (Math.random() - 0.5) * 2 * s; d.z += (Math.random() - 0.5) * 2 * s;
      d.normalize();
      this.fire(aimOrigin, d, muzzle, w.damage, w.range, pos);
    }
    if (this.ammo[this.weapon] === 0) this.reload();
    return true;
  }

  /** Disparo de un PNJ (policía) hacia un punto. */
  npcShot(from: THREE.Vector3, to: THREE.Vector3, spread: number): THREE.Vector3 {
    const d = to.clone().sub(from).normalize();
    d.x += (Math.random() - 0.5) * spread; d.y += (Math.random() - 0.5) * spread; d.z += (Math.random() - 0.5) * spread;
    d.normalize();
    this.muzzleFlash(from);
    this.hooks.sound('shot', 'pistola', from);
    const end = this.traceWorld(from, d, 80);
    this.tracer(from, end);
    return d;
  }

  private muzzleFlash(at: THREE.Vector3) {
    const m = new THREE.Mesh(this.flashGeo, this.flashMat);
    m.position.copy(at);
    this.group.add(m);
    this.flashes.push({ m, life: 0.05 });
  }

  private tracer(a: THREE.Vector3, b: THREE.Vector3) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(g, this.tracerMat.clone());
    this.group.add(line);
    this.tracers.push({ line, life: 0.06 });
  }

  /** Distancia hasta el primer obstáculo del escenario (paredes, suelo) siguiendo el rayo. */
  traceWorld(o: THREE.Vector3, d: THREE.Vector3, range: number): THREE.Vector3 {
    const p = new THREE.Vector3();
    for (let s = 0.5; s <= range; s += 0.35) {
      p.copy(o).addScaledVector(d, s);
      if (p.y < this.ground.heightAt(p.x, p.z, p.y + 0.5) || this.world.pointBlocked(p.x, p.y, p.z)) return p;
    }
    return p.copy(o).addScaledVector(d, range);
  }

  private fire(o: THREE.Vector3, d: THREE.Vector3, muzzle: THREE.Vector3, dmg: number, range: number, shooter: THREE.Vector3) {
    const wall = this.traceWorld(o, d, range);
    let best = o.distanceTo(wall);
    let hitT: Target | null = null;
    let hitV: Vehicle | null = null;
    // personas: cápsula vertical
    for (const t of this.hooks.targets()) {
      if (!t.alive) continue;
      const r = this.rayCapsule(o, d, t.pos, t.radius, t.height);
      if (r !== null && r < best) { best = r; hitT = t; hitV = null; }
    }
    for (const v of this.hooks.vehicles()) {
      const c = v.circles();
      for (const [cx, cz] of [[c[0], c[1]], [c[2], c[3]]]) {
        const r = this.rayCapsule(o, d, new THREE.Vector3(cx, v.pos.y, cz), c[4], v.type.id === 'autobus' ? 3 : 1.45);
        if (r !== null && r < best) { best = r; hitV = v; hitT = null; }
      }
    }
    const end = o.clone().addScaledVector(d, best);
    this.tracer(muzzle, end);
    if (hitT) {
      hitT.hit(dmg, d.x, d.z, false, shooter);
      this.hooks.crime?.(hitT.alive ? 'hurt' : 'kill', shooter, hitT);
      this.hitMarker = 0.15;
      this.hooks.smoke(end.x, end.y, end.z, 0.75, 0.25); // salpicadura oscura, discreta
    } else if (hitV) {
      this.hitMarker = 0.1;
      hitV.health -= dmg * 0.35;
      hitV.lastImpact = Math.max(hitV.lastImpact, 1);
      this.hooks.smoke(end.x, end.y, end.z, 0.2, 0.2);
      this.hooks.sound('ricochet', null, end);
      if (hitV.health < -30 && !hitV.burnt) this.hooks.explode(hitV);
    } else if (best < range - 0.5) {
      this.hooks.smoke(end.x, end.y, end.z, 0.05, 0.35); // polvo de la pared
      if (Math.random() < 0.3) this.hooks.sound('ricochet', null, end);
    }
  }

  /** Rayo contra cilindro vertical (base en p, radio r, altura h). Devuelve la distancia o null. */
  private rayCapsule(o: THREE.Vector3, d: THREE.Vector3, p: THREE.Vector3, r: number, h: number): number | null {
    const wx = p.x - o.x, wz = p.z - o.z;
    const dd = d.x * d.x + d.z * d.z;
    if (dd < 1e-6) return null;
    let t = (wx * d.x + wz * d.z) / dd;
    if (t < 0) return null;
    const cx = o.x + d.x * t - p.x, cz = o.z + d.z * t - p.z;
    const dist2 = cx * cx + cz * cz;
    if (dist2 > r * r) return null;
    t -= Math.sqrt(Math.max(0, r * r - dist2) / dd); // entrada al cilindro
    const y = o.y + d.y * t;
    if (y < p.y + 0.05 || y > p.y + h) return null;
    return t * Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
  }

  private resolveMelee(from: THREE.Vector3, heading: number, w: WeaponDef) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    let any = false;
    for (const t of this.hooks.targets()) {
      if (!t.alive) continue;
      const dx = t.pos.x - from.x, dz = t.pos.z - from.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range + t.radius || Math.abs(t.pos.y - from.y) > 1.2) continue;
      if ((dx * fx + dz * fz) / (d || 1) < 0.45) continue; // fuera del cono delantero
      t.hit(w.damage, fx, fz, true, from);
      this.hooks.crime?.(t.alive ? 'melee' : 'kill', from, t);
      any = true;
    }
    for (const v of this.hooks.vehicles()) {
      const dx = v.pos.x - from.x, dz = v.pos.z - from.z;
      if (Math.hypot(dx, dz) > v.type.length / 2 + w.range) continue;
      if (dx * fx + dz * fz < 0) continue;
      if (w.id === 'bate') { v.damage(fx, fz, 7); v.health -= 4; any = true; }
    }
    if (any) { this.hitMarker = 0.15; this.hooks.sound('melee', w.id, from); this.hooks.alarm(from, 18); }
  }
}
