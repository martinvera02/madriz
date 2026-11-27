import * as THREE from 'three';
import { angleDiff, clamp } from '../config';
import { Character, randomLook, type Look } from '../entities/character';
import type { Player } from '../entities/player';
import type { Vehicle } from '../entities/vehicle';
import type { CollisionWorld } from '../world/collision';
import type { Ground } from '../world/roads';
import type { Hud } from '../ui/hud';
import type { Police } from './police';
import type { Target } from './combat';
import type { MapIcon } from '../ui/mapIcons';
import type { Landmark } from '../world/landmarks';

/**
 * Misiones: marcadores de inicio repartidos por la ciudad, un encargo activo cada vez,
 * objetivo y temporizador en pantalla, rótulos de inicio / superada / fallida y progreso guardado.
 * Cada misión es una pequeña máquina de estados (MissionRun) que el gestor actualiza cada frame.
 */

/** Lo que una misión necesita del resto del juego (lo da main.ts). */
export interface MissionCtx {
  scene: THREE.Scene;
  world: CollisionWorld;
  ground: Ground;
  player: Player;
  police: Police;
  hud: Hud;
  addMoney(eur: number): void;
  /** Punto en la calzada más cercana (para destinos en coche). */
  snapCar(x: number, z: number): THREE.Vector3;
  /** Punto en la acera más cercana (para destinos a pie). */
  snapWalk(x: number, z: number): THREE.Vector3;
  /** Aparca un coche en la calzada más cercana; queda en la lista de aparcados del juego. */
  parkCar(type: string, color: number, x: number, z: number): Vehicle;
  removeCar(v: Vehicle): void;
  exitVehicle(): void;
  /** Asustar a los peatones de alrededor. */
  alarm(pos: THREE.Vector3, r: number): void;
  /** ¿Se ve b desde a? */
  los(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** Un tirador de misión dispara al jugador desde `from` (con coberturas y coche como la policía). */
  shootAtPlayer(from: THREE.Vector3, heavy?: boolean): void;
  /** Edificio con interior por su nombre (p. ej. la azotea del Círculo). */
  landmark(name: string): Landmark | null;
}

type Step = 'ok' | { fail: string } | null;

interface MissionRun {
  /** Texto del objetivo actual. */
  objective: string;
  /** Punto al que guiar (brújula, minimapa y marcador en el suelo). */
  target: THREE.Vector3 | null;
  /** Segundos que quedan (si hay contrarreloj). */
  timer: number | null;
  update(dt: number): Step;
  /** Recompensa final (puede depender de cómo se ha hecho). */
  reward(): number;
  targets(): Target[];
  /** ¿Este coche es de la misión? (para que no lo retire el gestor de aparcados). */
  owns(v: Vehicle): boolean;
  cleanup(success: boolean): void;
}

interface MissionDef {
  id: string;
  title: string;
  giver: string;
  giverLook: Look;
  /** Lugar de inicio (coordenadas del mapa, se ajusta a la acera). */
  at: [number, number];
  place: string;
  requires: string | null;
  intro: string[];
  make(ctx: MissionCtx): MissionRun;
}

// ------------------------------------------------------------------ piezas comunes

/** Marcador luminoso en el suelo: cilindro translúcido, disco y rombo flotante. */
export class Marker {
  readonly group = new THREE.Group();
  private readonly gem: THREE.Mesh;
  private t = Math.random() * 10;
  constructor(color: number, radius = 1.3, height = 1.1) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 28, 1, true).translate(0, height / 2, 0), mat);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 28).rotateX(-Math.PI / 2).translate(0, 0.04, 0), mat.clone());
    (disc.material as THREE.MeshBasicMaterial).opacity = 0.18;
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0).scale(1, 1.5, 1), new THREE.MeshBasicMaterial({ color }));
    this.gem.position.y = height + 0.9;
    this.group.add(wall, disc, this.gem);
    this.group.traverse((o) => { o.renderOrder = 5; });
  }
  /** `from`: posición del jugador; el rombo se oculta si estás dentro (taparía la cámara). */
  update(dt: number, from?: THREE.Vector3) {
    this.t += dt;
    if (from) { const g = this.group.position; this.gem.visible = (from.x - g.x) ** 2 + (from.z - g.z) ** 2 > 9; }
    this.gem.rotation.y = this.t * 1.6;
    this.gem.position.y = 2 + Math.sin(this.t * 2.2) * 0.15;
  }
}

/** Personaje de misión (a pie), con huida sencilla esquivando paredes. */
class MissionNpc {
  readonly ch: Character;
  readonly pos = new THREE.Vector3();
  heading = 0;
  health = 100;
  alive = true;
  mode: 'idle' | 'flee' | 'surrender' = 'idle';
  speed = 0;
  fleeT = 0;
  constructor(look: Look, private ctx: MissionCtx, x: number, z: number, onHit?: (n: MissionNpc, dmg: number, melee: boolean) => void) {
    this.ch = new Character(look);
    this.pos.set(x, ctx.ground.heightAt(x, z), z);
    ctx.scene.add(this.ch.root);
    this.onHit = onHit ?? null;
  }
  private onHit: ((n: MissionNpc, dmg: number, melee: boolean) => void) | null;
  target(): Target {
    return {
      pos: this.pos, radius: 0.3, height: 1.75, alive: this.alive,
      hit: (dmg, dx, dz, melee) => {
        if (!this.alive) return;
        this.health -= dmg;
        this.ch.play('hit');
        this.pos.x += dx * 0.25; this.pos.z += dz * 0.25;
        if (this.health <= 0) { this.alive = false; this.ch.setAction('none'); this.ch.setProp('none'); }
        this.onHit?.(this, dmg, melee);
      },
    };
  }
  face(p: THREE.Vector3) { this.heading = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }
  update(dt: number, from: THREE.Vector3) {
    if (!this.alive) { this.ch.setDown(1); this.ch.animate(dt, 0); this.sync(); return; }
    let want = 0;
    if (this.mode === 'flee') {
      this.fleeT += dt;
      // corre más que andando, pero se cansa: al rato el jugador le alcanza
      want = this.fleeT < 14 ? 6.6 : 4.6;
      const away = Math.atan2(this.pos.x - from.x, this.pos.z - from.z);
      // elegir el rumbo libre que más aleja, sin giros bruscos
      let best = this.heading, bs = -Infinity;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const ok = this.free(a, 1.4) && this.free(a, 3);
        if (!ok) continue;
        const score = -Math.abs(angleDiff(a, away)) * 1.0 - Math.abs(angleDiff(a, this.heading)) * 0.6;
        if (score > bs) { bs = score; best = a; }
      }
      this.heading += clamp(angleDiff(best, this.heading), -dt * 6, dt * 6);
    } else if (this.mode === 'surrender') {
      this.face(from);
    }
    this.speed += (want - this.speed) * Math.min(1, dt * 5);
    if (this.speed > 0.05) {
      const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt, nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;
      if (this.free(this.heading, 0.5)) { this.pos.x = nx; this.pos.z = nz; }
      else this.speed *= 0.3;
    }
    this.ctx.world.resolveCircle(this.pos, 0.35, this.pos.y);
    this.pos.y = this.ctx.ground.heightAt(this.pos.x, this.pos.z, this.pos.y + 0.6);
    this.ch.animate(dt, this.speed);
    this.sync();
  }
  private free(a: number, d: number) {
    const x = this.pos.x + Math.sin(a) * d, z = this.pos.z + Math.cos(a) * d;
    const y = this.ctx.ground.heightAt(x, z, this.pos.y + 0.6);
    return Math.abs(y - this.pos.y) < 0.6 && !this.ctx.world.pointBlocked(x, y + 0.9, z);
  }
  private sync() {
    this.ch.root.position.copy(this.pos);
    this.ch.root.rotation.y = this.heading;
  }
  dispose() { this.ctx.scene.remove(this.ch.root); this.ch.dispose(); }
}

const near = (a: THREE.Vector3, b: THREE.Vector3, r: number) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < r * r && Math.abs(a.y - b.y) < 4;

/** El taller de Embajadores (fin de «Coche caliente» y taller de reparación). */
export const TALLER_AT: [number, number] = [40, 1180];
/** La armería (calle de la Montera). */
export const ARMERIA_AT: [number, number] = [121, -248];

// ------------------------------------------------------------------ misión 1: el primer recado

function recado(ctx: MissionCtx): MissionRun {
  const market = ctx.snapCar(-440, 112);
  const plaza = ctx.snapCar(198, 870);
  let phase = 0;
  const run: MissionRun = {
    objective: 'Consigue un coche', target: null, timer: null,
    update(dt) {
      const v = ctx.player.vehicle;
      if (phase === 0) {
        if (v) { phase = 1; ctx.hud.toast('Al Mercado de San Miguel'); }
        return null;
      }
      if (phase === 1) {
        run.target = market;
        run.objective = v ? 'Recoge el paquete en el Mercado de San Miguel' : 'Vuelve a un coche';
        if (v && near(v.pos, market, 7) && v.speed < 4) {
          phase = 2;
          run.timer = 160;
          ctx.hud.say('Puesto del mercado', '¡Toma, y que no se rompa, que es jamón del bueno!', v.pos, false, 4);
          ctx.hud.toast('Paquete recogido');
        }
        return null;
      }
      run.target = plaza;
      run.timer! -= dt;
      run.objective = v ? 'Entrega el paquete en la plaza de Lavapiés' : 'Vuelve a un coche: el paquete no va andando';
      if (run.timer! <= 0) return { fail: 'Se ha pasado la hora de la entrega' };
      if (v && v.health <= 0) return { fail: 'El coche ha quedado inservible y el jamón también' };
      if (v && near(v.pos, plaza, 8) && v.speed < 4) {
        ctx.hud.say('Clienta', '¡Por fin! Dile a Paco que gracias.', v.pos, false, 4);
        return 'ok';
      }
      return null;
    },
    reward: () => 150,
    targets: () => [],
    owns: () => false,
    cleanup() {},
  };
  return run;
}

// ------------------------------------------------------------------ misión 2: cobro pendiente

function cobro(ctx: MissionCtx): MissionRun {
  const spot = ctx.snapWalk(-314, 619);
  let rata: MissionNpc | null = null;
  let phase = 0;
  let killedBy: 'shot' | 'car' | null = null;
  const run: MissionRun = {
    objective: 'Busca al Rata en la plaza de Cascorro', target: spot, timer: null,
    update(dt) {
      const p = ctx.player;
      const me = p.vehicle ? p.vehicle.pos : p.pos;
      if (!rata && me.distanceTo(spot) < 150) {
        rata = new MissionNpc({ ...randomLook(), skin: 0xc99b78, shirt: 0x5b6b3a, top: 'hoodie', pants: 0x2a2a2a, hairStyle: 'beanie', capColor: 0x1a1a1a, female: false }, ctx, spot.x, spot.z,
          (n, _dmg, melee) => {
            if (!n.alive) { killedBy = melee ? null : 'shot'; return; }
            if (n.health <= 45 && n.mode !== 'surrender') {
              n.mode = 'surrender';
              n.ch.setAction('handsUp');
              ctx.hud.say('El Rata', '¡Vale, vale! ¡Para! ¡Te pago, te pago!', n.pos, true, 3.5);
            } else if (n.mode === 'idle') n.mode = 'flee';
          });
        rata.ch.setAction('phone');
        rata.ch.setProp('phone');
      }
      if (!rata) return null;
      rata.update(dt, me);
      // atropello con tu coche
      if (p.vehicle && rata.alive && p.vehicle.speed > 4 && near(p.vehicle.pos, rata.pos, 1.8)) {
        rata.health = 0; rata.alive = false; killedBy = 'car';
        ctx.police.crime('kill', rata.pos);
      }
      if (!rata.alive) return { fail: killedBy === 'car' ? 'Atropellado no paga nadie' : 'El Rata no puede pagar desde el cementerio' };
      run.target = rata.pos;
      if (phase === 0) {
        run.objective = 'Busca al Rata en la plaza de Cascorro';
        if (me.distanceTo(rata.pos) < 14 || rata.mode !== 'idle') {
          phase = 1;
          rata.ch.setAction('none'); rata.ch.setProp('none');
          if (rata.mode === 'idle') rata.mode = 'flee';
          ctx.hud.say('El Rata', '¡¿Pagarle a Paco?! ¡Ni de coña!', rata.pos, true, 3);
          ctx.alarm(rata.pos, 20);
        }
        return null;
      }
      if (rata.mode === 'flee') {
        run.objective = 'Atrapa al Rata y dale un escarmiento (sin matarlo)';
        if (me.distanceTo(rata.pos) > 160) return { fail: 'Se te ha escapado el Rata' };
        return null;
      }
      run.objective = 'Cobra la deuda: acércate al Rata';
      if (!p.vehicle && near(p.pos, rata.pos, 2.4)) {
        ctx.hud.say('El Rata', 'Toma… 300 pavos. Y dile a Paco que no vuelva a mandarte.', rata.pos, false, 4);
        return 'ok';
      }
      return null;
    },
    reward: () => 300,
    targets: () => (rata ? [rata.target()] : []),
    owns: () => false,
    cleanup(success) {
      const r = rata;
      if (!r) return;
      if (success && r.alive) {
        // se va andando y desaparece al rato
        r.mode = 'idle'; r.ch.setAction('none');
        setTimeout(() => r.dispose(), 6000);
      } else setTimeout(() => r.dispose(), 15000);
      rata = null;
    },
  };
  return run;
}

// ------------------------------------------------------------------ misión 3: coche caliente

function cocheCaliente(ctx: MissionCtx): MissionRun {
  const p0 = ctx.snapCar(-746, -712);
  const car = ctx.parkCar('deportivo', 0xb8202a, p0.x, p0.z);
  const taller = ctx.snapCar(TALLER_AT[0], TALLER_AT[1]);
  let phase = 0;
  const run: MissionRun = {
    objective: 'Roba el deportivo rojo aparcado en la plaza de España', target: car.pos, timer: null,
    update() {
      const p = ctx.player;
      if (car.health <= 0 || car.burnt) return { fail: 'El deportivo ha quedado destrozado' };
      if (phase === 0) {
        if (p.vehicle === car) {
          phase = 1;
          ctx.police.heat = Math.max(ctx.police.heat, 60);
          ctx.hud.toast('¡Salta la alarma!');
        }
        return null;
      }
      run.target = taller;
      const pct = Math.round(car.health);
      if (p.vehicle !== car) {
        run.target = car.pos;
        run.objective = 'Vuelve al deportivo';
        if (p.pos.distanceTo(car.pos) > 80) return { fail: 'Has abandonado el deportivo' };
        return null;
      }
      const hot = ctx.police.stars > 0;
      run.objective = hot ? `Pierde a la policía y llévalo al taller de Embajadores · coche al ${pct} %` : `Llévalo al taller de Embajadores sin destrozarlo · coche al ${pct} %`;
      if (near(car.pos, taller, 7) && car.speed < 3) {
        if (hot) { run.objective = 'Con la policía detrás no puedes entrar en el taller'; return null; }
        ctx.hud.say('Lola', `Precioso. Al ${pct} %… te pago según lo traes.`, car.pos, false, 4);
        return 'ok';
      }
      return null;
    },
    reward: () => Math.round(500 * Math.max(0.3, car.health / 100)),
    targets: () => [],
    owns: (v) => v === car,
    cleanup(success) {
      if (success) {
        if (ctx.player.vehicle === car) ctx.exitVehicle();
        ctx.removeCar(car);
      } else if (ctx.player.vehicle !== car) ctx.removeCar(car);
    },
  };
  return run;
}


// ------------------------------------------------------------------ matones armados (azotea)

/** Tirador de misión: se queda en su sitio, se asoma, apunta y dispara si te ve; esquiva de lado. */
class Gunman {
  readonly ch: Character;
  readonly pos = new THREE.Vector3();
  heading = 0;
  health = 100;
  alive = true;
  private fireT = 1.5 + Math.random() * 1.5;
  private strafe = 0;
  private strafeT = 0;
  private deadT = 0;
  constructor(look: Look, private ctx: MissionCtx, x: number, y: number, z: number, private home = new THREE.Vector3(x, y, z)) {
    this.ch = new Character(look);
    this.pos.set(x, y, z);
    this.ch.setProp('pistol');
    ctx.scene.add(this.ch.root);
  }
  target(): Target {
    return {
      pos: this.pos, radius: 0.3, height: 1.75, alive: this.alive,
      hit: (dmg, dx, dz) => {
        if (!this.alive) return;
        this.health -= dmg;
        this.ch.play('hit');
        this.pos.x += dx * 0.2; this.pos.z += dz * 0.2;
        if (this.health <= 0) { this.alive = false; this.ch.setAction('none'); this.ch.setProp('none'); }
      },
    };
  }
  update(dt: number, me: THREE.Vector3, active: boolean) {
    if (!this.alive) { this.deadT += dt; this.ch.setDown(Math.min(1, this.deadT * 3)); this.ch.animate(dt, 0); this.sync(); return; }
    const d = this.pos.distanceTo(me);
    const eye = this.pos.clone().setY(this.pos.y + 1.5), aim = me.clone().setY(me.y + 1.1);
    const sees = active && d < 40 && this.ctx.los(eye, aim);
    this.heading = Math.atan2(me.x - this.pos.x, me.z - this.pos.z);
    this.ch.setAction(sees ? 'aimPistol' : 'none');
    if (sees) {
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = 0.9 + Math.random() * 0.9;
        this.ch.play('recoil');
        this.ctx.shootAtPlayer(this.ch.muzzle(new THREE.Vector3()), false);
      }
    }
    // pasitos de lado para no quedarse quieto, sin alejarse de su sitio
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = 1.2 + Math.random() * 1.6; this.strafe = active ? (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.6 ? 1.6 : 0) : 0; }
    const sx = Math.cos(this.heading) * this.strafe * dt, sz = -Math.sin(this.heading) * this.strafe * dt;
    const nx = this.pos.x + sx, nz = this.pos.z + sz;
    if (Math.hypot(nx - this.home.x, nz - this.home.z) < 2.5 && !this.ctx.world.pointBlocked(nx, this.pos.y + 0.9, nz)) { this.pos.x = nx; this.pos.z = nz; }
    this.ch.animate(dt, Math.abs(this.strafe) > 0 ? 1.2 : 0);
    this.sync();
  }
  private sync() { this.ch.root.position.copy(this.pos); this.ch.root.rotation.y = this.heading; }
  dispose() { this.ctx.scene.remove(this.ch.root); this.ch.dispose(); }
}

// ------------------------------------------------------------------ misión 4: por debajo de Bailén

/** Punto del túnel de Bailén bajo la calle (entre la plaza de España y el Palacio). */
const TUNEL_AT: [number, number] = [-806, -380];

function tunel(ctx: MissionCtx): MissionRun {
  const p0 = ctx.snapCar(-640, -760);
  const van = ctx.parkCar('furgoneta', 0xf5f5f3, p0.x, p0.z);
  const drop = ctx.snapCar(-1480, -235);
  const terrain = (x: number, z: number) => ctx.ground.terrain.heightAt(x, z);
  const tY = terrain(TUNEL_AT[0], TUNEL_AT[1]);
  const tunnelPt = new THREE.Vector3(TUNEL_AT[0], ctx.ground.heightAt(TUNEL_AT[0], TUNEL_AT[1], tY - 7), TUNEL_AT[1]);
  const underground = (p: THREE.Vector3) => p.y < terrain(p.x, p.z) - 3;
  let phase = 0;
  const run: MissionRun = {
    objective: 'Coge la furgoneta blanca aparcada junto a la plaza de España', target: van.pos, timer: null,
    update(dt) {
      const p = ctx.player;
      if (van.burnt) return { fail: 'La furgoneta ha reventado con la mercancía dentro' };
      if (phase === 0) {
        if (p.vehicle === van) {
          phase = 1;
          ctx.police.heat = Math.max(ctx.police.heat, 250);
          ctx.hud.say('Lola (al móvil)', '¡Un chivatazo! Métete en el túnel de Bailén, ahí abajo no te siguen.', van.pos, true, 4.5);
        }
        return null;
      }
      if (p.vehicle !== van) {
        run.target = van.pos;
        run.objective = 'Vuelve a la furgoneta';
        if (p.pos.distanceTo(van.pos) > 80) return { fail: 'Has abandonado la furgoneta' };
        return null;
      }
      // dentro del túnel la policía pierde la pista
      if (underground(van.pos)) ctx.police.heat = Math.max(0, ctx.police.heat - dt * 30);
      if (phase === 1) {
        run.target = tunnelPt;
        run.objective = 'Métete en el túnel de Bailén (baja por la rampa de la plaza de España)';
        if (underground(van.pos) && Math.hypot(van.pos.x - tunnelPt.x, van.pos.z - tunnelPt.z) < 30) {
          phase = 2;
          ctx.hud.toast('Ahí abajo no te ven: aprovecha');
        }
        return null;
      }
      const hot = ctx.police.stars > 0;
      run.target = drop;
      run.objective = hot ? 'Pierde a la policía y lleva la furgoneta a Madrid Río, junto al Puente del Rey' : 'Lleva la furgoneta a Madrid Río, junto al Puente del Rey';
      if (near(van.pos, drop, 9) && van.speed < 3) {
        if (hot) { run.objective = 'Con la policía detrás no se descarga: piérdela'; return null; }
        ctx.hud.say('Contacto de Lola', 'Justo a tiempo. Ni un rasguño… bueno, casi.', van.pos, false, 4);
        return 'ok';
      }
      return null;
    },
    reward: () => 700,
    targets: () => [],
    owns: (v) => v === van,
    cleanup(success) {
      if (success) {
        if (ctx.player.vehicle === van) ctx.exitVehicle();
        ctx.removeCar(van);
      } else if (ctx.player.vehicle !== van) ctx.removeCar(van);
    },
  };
  return run;
}

// ------------------------------------------------------------------ misión 5: los puentes de Madrid Río

/** Contrarreloj por los puentes con calzada, de sur a norte, cambiando de orilla. */
const PUENTES: { at: [number, number]; name: string }[] = [
  { at: [-1631, 1440], name: 'Puente de San Isidro' },
  { at: [-1635, 296], name: 'Puente de Segovia' },
  { at: [-1959, -894], name: 'Puente de la Reina Victoria' },
];

function puentes(ctx: MissionCtx): MissionRun {
  const pts = PUENTES.map((b) => ({ ...b, p: ctx.snapCar(b.at[0], b.at[1]) }));
  let i = -1;
  let time = 0;
  const run: MissionRun = {
    objective: 'Súbete a un coche', target: null, timer: null,
    update(dt) {
      const v = ctx.player.vehicle;
      if (i < 0) {
        if (v) { i = 0; run.timer = 75; ctx.hud.toast('¡Al Puente de San Isidro!'); }
        return null;
      }
      if (!v) return { fail: 'La carrera se hace en coche' };
      if (v.health <= 0) return { fail: 'Has reventado el coche' };
      run.timer! -= dt;
      time += dt;
      if (run.timer! <= 0) return { fail: 'Se ha acabado el tiempo' };
      const cp = pts[i];
      run.target = cp.p;
      run.objective = `Cruza el ${cp.name} (${i + 1}/${pts.length})`;
      if (near(v.pos, cp.p, 12)) {
        i++;
        if (i >= pts.length) {
          ctx.hud.say('Rafa (al móvil)', `¡${Math.round(time)} segundos! Eso es conducir.`, v.pos, false, 4);
          return 'ok';
        }
        // cada puente da tiempo para el siguiente tramo
        run.timer! += i === 1 ? 95 : 85;
        ctx.hud.toast(`${cp.name} ✓ · ahora el ${pts[i].name}`);
      }
      return null;
    },
    // 400 € y hasta 300 más cuanto más rápido (unos 3 minutos es buen tiempo)
    reward: () => 400 + Math.round(Math.max(0, Math.min(300, (260 - time) * 3))),
    targets: () => [],
    owns: () => false,
    cleanup() {},
  };
  return run;
}

// ------------------------------------------------------------------ misión 6: vistas desde la azotea

function azotea(ctx: MissionCtx): MissionRun {
  const lm = ctx.landmark('Círculo de Bellas Artes');
  const m = lm?.meta;
  const gunmen: Gunman[] = [];
  let phase = 0;
  if (!m) {
    // sin el Círculo (otra zona del mapa) la misión no tiene sentido
    return { objective: '', target: null, timer: null, update: () => ({ fail: 'El Círculo de Bellas Artes no está en este mapa' }), reward: () => 0, targets: () => [], owns: () => false, cleanup() {} };
  }
  const roofY = m.roofY;
  const roof = new THREE.Vector3(m.rcx, roofY, m.rcz);
  const lift = new THREE.Vector3(m.rlx, ctx.ground.heightAt(m.rlx, m.rlz, lm!.floor + 0.5), m.rlz);
  const bar = new THREE.Vector3(m.rbarx, roofY, m.rbarz);
  const onRoof = (p: THREE.Vector3) => p.y > roofY - 1.5 && Math.hypot(p.x - roof.x, p.z - roof.z) < 30;
  const look = (shirt: number): Look => ({ ...randomLook(), shirt, top: 'jacket', inner: 0x111111, pants: 0x1a1a1a, hairStyle: 'short', female: false });
  const run: MissionRun = {
    objective: 'Ve al Círculo de Bellas Artes y sube a la azotea (ascensores del vestíbulo)', target: lift, timer: null,
    update(dt) {
      const p = ctx.player;
      const me = p.vehicle ? p.vehicle.pos : p.pos;
      for (const g of gunmen) g.update(dt, me, phase === 1);
      if (phase === 0) {
        run.target = me.y > roofY - 4 ? roof : lift;
        if (onRoof(me)) {
          phase = 1;
          for (const [x, z, c] of [[m.rax, m.raz, 0x3a2a2a], [m.rbx, m.rbz, 0x2a2f3a], [m.rdx, m.rdz, 0x30302a]] as [number, number, number][]) gunmen.push(new Gunman(look(c), ctx, x, roofY, z));
          ctx.hud.say('El Tuerto', '¿Paco te manda a ti? Qué pena. ¡A por él!', gunmen[0].pos, true, 3.5);
          ctx.hud.toast('¡Es una trampa! Q para cubrirte');
          ctx.alarm(roof, 30);
        }
        return null;
      }
      if (phase === 1) {
        const left = gunmen.filter((g) => g.alive).length;
        run.target = gunmen.find((g) => g.alive)?.pos ?? null;
        run.objective = `Acaba con los matones del Tuerto (quedan ${left}) · Q para cubrirte`;
        if (left === 0) { phase = 2; ctx.police.heat = Math.max(ctx.police.heat, 120); ctx.hud.toast('Coge el sobre de la barra'); }
        return null;
      }
      if (phase === 2) {
        run.target = bar;
        run.objective = 'Coge el sobre que dejaron en la barra de la azotea';
        if (!p.vehicle && p.pos.distanceTo(bar) < 2.5) { phase = 3; ctx.hud.toast('Sobre recogido · ahora, a desaparecer'); }
        return null;
      }
      run.target = null;
      run.objective = ctx.police.stars > 0 ? 'Baja del Círculo y pierde a la policía' : 'Baja a la calle';
      if (ctx.police.stars === 0 && me.y < roofY - 6) {
        ctx.hud.say('Paco (al móvil)', 'El Tuerto, ¿eh? Me lo apunto. Buen trabajo, chaval.', me, false, 4);
        return 'ok';
      }
      return null;
    },
    reward: () => 600,
    targets: () => gunmen.map((g) => g.target()),
    owns: () => false,
    cleanup() {
      const gs = gunmen.splice(0);
      setTimeout(() => gs.forEach((g) => g.dispose()), 10000);
    },
  };
  return run;
}

const MISSIONS: MissionDef[] = [
  {
    id: 'recado', title: 'El primer recado', giver: 'Paco', place: 'Puerta del Sol',
    giverLook: { skin: 0xd9a77f, shirt: 0x3a3f46, top: 'jacket', inner: 0xe9e6df, pants: 0x2b2b30, hair: 0x9a9a9a, hairStyle: 'short' },
    at: [30, -6], requires: null,
    intro: ['¿Tú eres el nuevo? Pues a currar.', 'Recoge un paquete en el Mercado de San Miguel…', '…y llévalo a la plaza de Lavapiés. Rapidito, que lo esperan.'],
    make: recado,
  },
  {
    id: 'cobro', title: 'Cobro pendiente', giver: 'Paco', place: 'Tirso de Molina',
    giverLook: { skin: 0xd9a77f, shirt: 0x3a3f46, top: 'jacket', inner: 0xe9e6df, pants: 0x2b2b30, hair: 0x9a9a9a, hairStyle: 'short' },
    at: [-77, 462], requires: 'recado',
    intro: ['El Rata me debe 300 pavos desde agosto.', 'Suele estar por Cascorro. Convéncele…', '…pero vivo, que los muertos no pagan.'],
    make: cobro,
  },
  {
    id: 'coche', title: 'Coche caliente', giver: 'Lola', place: 'Plaza de Lavapiés',
    giverLook: { skin: 0xb98463, shirt: 0x7a2b2b, top: 'jacket', inner: 0x171a20, pants: 0x1d2a44, hair: 0x2a1a12, hairStyle: 'long', female: true },
    at: [198, 862], requires: 'cobro',
    intro: ['Paco dice que conduces bien. Ya veremos.', 'En la plaza de España hay un deportivo rojo que me han encargado.', 'Tráemelo al taller de Embajadores. Cuanto más entero, más cobras.'],
    make: cocheCaliente,
  },
  {
    id: 'tunel', title: 'Por debajo de Bailén', giver: 'Lola', place: 'Embajadores',
    giverLook: { skin: 0xb98463, shirt: 0x7a2b2b, top: 'jacket', inner: 0x171a20, pants: 0x1d2a44, hair: 0x2a1a12, hairStyle: 'long', female: true },
    at: [52, 1168], requires: 'coche',
    intro: ['El deportivo, de lujo. Tengo algo más gordo.', 'Una furgoneta con mercancía junto a la plaza de España.', 'Llévala a Madrid Río. Y si se complica, el túnel de Bailén es tu amigo.'],
    make: tunel,
  },
  {
    id: 'puentes', title: 'Los puentes de Madrid Río', giver: 'Rafa', place: 'Madrid Río',
    giverLook: { skin: 0xe0ac85, shirt: 0xd8b02a, top: 'hoodie', pants: 0x2b3a55, hair: 0x3a2a1a, hairStyle: 'short', female: false },
    at: [-1560, 1380], requires: 'coche',
    intro: ['¿Tú eres el que conduce para Lola?', 'Apuesto 400 pavos a que no cruzas San Isidro, Segovia y Reina Victoria a tiempo.', 'Cuanto más rápido, más te llevas. ¡Ya!'],
    make: puentes,
  },
  {
    id: 'azotea', title: 'Vistas desde la azotea', giver: 'Paco', place: 'Calle de Alcalá',
    giverLook: { skin: 0xd9a77f, shirt: 0x3a3f46, top: 'jacket', inner: 0xe9e6df, pants: 0x2b2b30, hair: 0x9a9a9a, hairStyle: 'short' },
    at: [560, -205], requires: 'tunel',
    intro: ['El Tuerto quiere hablar de negocios.', 'Te espera en la azotea del Círculo de Bellas Artes.', 'Sube por los ascensores. Y ojo, que el Tuerto no es de fiar.'],
    make: azotea,
  },
];

// ------------------------------------------------------------------ gestor

export class Missions {
  done = new Set<string>();
  private active: { def: MissionDef; run: MissionRun } | null = null;
  private starts = new Map<string, { marker: Marker; pos: THREE.Vector3; giver: Character | null }>();
  private targetMarker = new Marker(0xd4c29a, 2.2, 1.6);
  private introQ: { t: number; text: string; who: string }[] = [];
  private banner = document.getElementById('mission-banner')!;
  private objEl = document.getElementById('objective')!;
  private timerEl = document.getElementById('mission-timer')!;
  private bannerT = 0;
  private cooldown = 0;

  constructor(private ctx: MissionCtx) {
    ctx.scene.add(this.targetMarker.group);
    this.targetMarker.group.visible = false;
  }

  get busy() { return !!this.active; }
  get title() { return this.active?.def.title ?? null; }

  /** Progreso para la partida guardada. */
  serialize() { return { done: [...this.done] }; }
  restore(p: unknown) {
    const d = (p as { done?: unknown })?.done;
    this.done = new Set(Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : []);
    if (this.active) this.abort();
    this.refreshStarts();
  }

  private available() { return MISSIONS.filter((m) => !this.done.has(m.id) && (!m.requires || this.done.has(m.requires))); }

  /** Crea o quita los marcadores de inicio según el progreso. */
  private refreshStarts() {
    const avail = new Set(this.available().map((m) => m.id));
    for (const [id, s] of this.starts) {
      if (avail.has(id) && !this.active) continue;
      this.ctx.scene.remove(s.marker.group);
      if (s.giver) { this.ctx.scene.remove(s.giver.root); s.giver.dispose(); }
      this.starts.delete(id);
    }
    if (this.active) return;
    for (const m of this.available()) {
      if (this.starts.has(m.id)) continue;
      const pos = this.ctx.snapWalk(m.at[0], m.at[1]);
      const marker = new Marker(0xb75b32);
      marker.group.position.copy(pos);
      this.ctx.scene.add(marker.group);
      this.starts.set(m.id, { marker, pos, giver: null });
    }
  }

  /** Puntos de las misiones para el minimapa y la brújula. */
  blips(): { x: number; z: number; color: string; size: number }[] {
    const out: { x: number; z: number; color: string; size: number }[] = [];
    if (this.active?.run.target) out.push({ x: this.active.run.target.x, z: this.active.run.target.z, color: '#d4c29a', size: 4.5 });
    for (const s of this.starts.values()) out.push({ x: s.pos.x, z: s.pos.z, color: '#b75b32', size: 4.5 });
    return out;
  }
  compass(): { x: number; z: number; color: string }[] {
    if (this.active?.run.target) return [{ x: this.active.run.target.x, z: this.active.run.target.z, color: '#d4c29a' }];
    // sin misión: el inicio más cercano
    let best: THREE.Vector3 | null = null, bd = Infinity;
    const me = this.ctx.player.vehicle ? this.ctx.player.vehicle.pos : this.ctx.player.pos;
    for (const s of this.starts.values()) { const d = s.pos.distanceTo(me); if (d < bd) { bd = d; best = s.pos; } }
    return best ? [{ x: best.x, z: best.z, color: '#b75b32' }] : [];
  }

  /** Iconos para el minimapa y el mapa completo. */
  icons(): MapIcon[] {
    const out: MapIcon[] = [];
    for (const [id, s] of this.starts) {
      const def = MISSIONS.find((m) => m.id === id)!;
      out.push({ x: s.pos.x, z: s.pos.z, kind: 'mission', label: `${def.giver}: «${def.title}»` });
    }
    const t = this.active?.run.target;
    if (t) out.push({ x: t.x, z: t.z, kind: 'target', label: this.active!.run.objective });
    return out;
  }
  /** Objetivo actual de la misión (el GPS lo prefiere al destino marcado). */
  get currentTarget(): THREE.Vector3 | null { return this.active?.run.target ?? null; }

  targets(): Target[] { return this.active ? this.active.run.targets() : []; }
  owns(v: Vehicle) { return !!this.active && this.active.run.owns(v); }

  /** Acción con E si estás en un inicio de misión. */
  action(): { text: string; run: () => void } | null {
    if (this.active || this.cooldown > 0) return null;
    const p = this.ctx.player;
    if (p.vehicle) return null;
    for (const [id, s] of this.starts) {
      if (!near(p.pos, s.pos, 1.8)) continue;
      const def = MISSIONS.find((m) => m.id === id)!;
      return { text: `Misión: ${def.title}`, run: () => this.start(def) };
    }
    return null;
  }

  private start(def: MissionDef) {
    const s = this.starts.get(def.id);
    this.active = { def, run: def.make(this.ctx) };
    this.showBanner(def.title.toUpperCase(), def.place, 3.2);
    this.introQ = def.intro.map((text, i) => ({ t: 0.6 + i * 3.2, text, who: def.giver }));
    this.introPos = s ? s.pos.clone().setY(s.pos.y + 0.2) : this.ctx.player.pos.clone();
    // el que da el encargo se queda hasta terminar de hablar
    if (s?.giver) { this.leaving = s.giver; s.giver = null; this.leavingT = def.intro.length * 3.2 + 2; }
    this.refreshStarts();
  }
  private introPos = new THREE.Vector3();
  private leaving: Character | null = null;
  private leavingT = 0;

  /** Cancela la misión activa (muerte, cargar partida…). */
  fail(reason: string) {
    if (!this.active) return;
    const a = this.active;
    this.active = null;
    a.run.cleanup(false);
    this.showBanner('MISIÓN FALLIDA', reason, 4);
    this.introQ = [];
    this.cooldown = 3;
    this.refreshStarts();
  }
  private abort() {
    if (!this.active) return;
    this.active.run.cleanup(false);
    this.active = null;
    this.introQ = [];
  }

  private succeed() {
    const a = this.active!;
    const reward = a.run.reward();
    this.active = null;
    a.run.cleanup(true);
    this.done.add(a.def.id);
    this.ctx.addMoney(reward);
    const next = this.available();
    this.showBanner('MISIÓN SUPERADA', `+${reward.toLocaleString('es-ES')} €${next.length ? ' · nuevo encargo en el mapa' : ' · por ahora no hay más encargos'}`, 4.5);
    this.introQ = [];
    this.cooldown = 3;
    this.refreshStarts();
  }

  private showBanner(title: string, sub: string, t: number) {
    this.banner.innerHTML = `<b>${title}</b><small>${sub}</small>`;
    this.banner.classList.add('on');
    this.bannerT = t;
  }

  update(dt: number, playerDead: boolean) {
    if (this.starts.size === 0 && !this.active) this.refreshStarts();
    this.cooldown = Math.max(0, this.cooldown - dt);
    const me = this.ctx.player.vehicle ? this.ctx.player.vehicle.pos : this.ctx.player.pos;
    // marcadores de inicio y quien da el encargo
    for (const [id, s] of this.starts) {
      s.marker.update(dt, me);
      const d = s.pos.distanceTo(me);
      s.marker.group.visible = d < 400;
      if (!s.giver && d < 90) {
        const def = MISSIONS.find((m) => m.id === id)!;
        const ch = new Character(def.giverLook);
        ch.root.position.copy(s.pos).add(new THREE.Vector3(1.8, 0, 0));
        ch.root.rotation.y = -Math.PI / 2;
        ch.setAction(def.giver === 'Lola' ? 'smoke' : 'arms');
        if (def.giver === 'Lola') ch.setProp('cigarette');
        this.ctx.scene.add(ch.root);
        s.giver = ch;
      }
      if (s.giver) {
        if (d > 130) { this.ctx.scene.remove(s.giver.root); s.giver.dispose(); s.giver = null; }
        else s.giver.animate(dt, 0);
      }
    }
    if (this.leaving) {
      this.leaving.animate(dt, 0);
      this.leavingT -= dt;
      if (this.leavingT <= 0) { this.ctx.scene.remove(this.leaving.root); this.leaving.dispose(); this.leaving = null; }
    }
    // diálogo de inicio
    for (const q of this.introQ) {
      q.t -= dt;
      if (q.t <= 0) this.ctx.hud.say(q.who, q.text, this.leaving ? this.leaving.root.position : this.introPos, false, 3.1);
    }
    this.introQ = this.introQ.filter((q) => q.t > 0);
    // misión activa
    if (this.active) {
      if (playerDead) this.fail('Has caído');
      else {
        const r = this.active.run.update(dt);
        if (r === 'ok') this.succeed();
        else if (r) this.fail(r.fail);
      }
    }
    const run = this.active?.run ?? null;
    this.targetMarker.group.visible = !!run?.target;
    if (run?.target) { this.targetMarker.group.position.copy(run.target); this.targetMarker.update(dt, me); }
    this.objEl.textContent = run ? run.objective : '';
    this.objEl.classList.toggle('on', !!run);
    if (run?.timer != null) {
      const t = Math.max(0, Math.ceil(run.timer));
      this.timerEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      this.timerEl.classList.add('on');
      this.timerEl.classList.toggle('low', t <= 20);
    } else this.timerEl.classList.remove('on');
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.banner.classList.remove('on'); }
  }
}
