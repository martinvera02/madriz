import * as THREE from 'three';
import { angleDiff } from '../config';
import { CollisionWorld } from '../world/collision';
import { Ground } from '../world/roads';
import { Character, randomLook, type Action, type Prop } from '../entities/character';
import { Vehicle } from '../entities/vehicle';
import { RoadGraph, Edge } from './roadGraph';
import type { CarwayIndex } from '../world/spatial';
import type { TrafficLights } from './trafficLights';

/*
 * Peatones sobre la red peatonal real: aceras (a los lados de las calzadas),
 * calles peatonales, plazas, escaleras y caminos de los parques.
 */

type Mode = 'walk' | 'flee' | 'down' | 'talk' | 'chat' | 'cower' | 'surrender';

export interface Ped {
  ch: Character;
  pos: THREE.Vector3;
  heading: number;
  mode: Mode;
  edge: Edge | null;
  side: number; // -1 acera izquierda, 1 derecha
  bias: number;
  target: { x: number; z: number };
  speed: number;
  timer: number;
  wait: number; // esperando para cruzar
  idle: number; // pararse un momento (mirar un escaparate, el móvil…)
  vel: THREE.Vector3;
  fleeFrom: THREE.Vector3;
  id: number;
  health: number;
  dead: boolean;
  /** Qué hace mientras pasea o está parado (móvil, fumar, mirar escaparates…). */
  habit: Action;
  habitProp: Prop;
  partner: Ped | null;
  lookAt: THREE.Vector3 | null;
}

/** Frases de los peatones al hablarles (castizo y cotidiano). */
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
let pedIds = 0;
const LINES = {
  day: [
    '¿Qué pasa? Aquí, de paseo.', 'Uf, el metro hoy iba hasta arriba.', 'Perdona, voy con prisa, que llego tarde al curro.',
    '¿Sabes si abren el Rastro este domingo?', 'Ni de coña pago siete euros por una caña.', 'Hace un sol que raja, ¿eh?',
    'Mi cuñado dice que el Atleti este año sí.', 'Me han dicho que hay obras otra vez en la Castellana.', 'Vaya pintas llevas, chaval.',
    '¿Tienes hora? Se me ha muerto el móvil.', 'Aquí antes había una mercería de toda la vida...', 'Madrid es lo que tiene: o te encanta o te agobia.',
  ],
  night: [
    '¿Sabes de algún bar que siga abierto?', 'Vuelvo a casa, que mañana madrugo.', 'Qué frío hace ya por la noche.',
    'El búho tarda más que el último metro, te lo digo yo.', 'Shh, que hay gente durmiendo.', 'Llevo toda la noche dando vueltas, colega.',
  ],
  scared: ['¡Aparta eso, por favor!', '¡Tranquilo, tranquilo! No quiero problemas.', '¡No dispares!', '¡Llévate lo que quieras!'],
  hurt: ['¡Ay! ¿Pero qué haces?', '¡Eh! ¡Que llamo a la policía!', '¿Estás loco o qué?'],
  directions: (place: string) => [`Sigue recto y llegas a ${place}.`, `¿${place}? Por ahí, a cinco minutos andando.`, `Uf, ${place}... pregunta más adelante, que yo no soy de aquí.`],
};

export class Pedestrians {
  readonly peds: Ped[] = [];
  private rng = Math.random;
  carway: CarwayIndex | null = null;
  private grid = new Map<string, Ped[]>();
  lights: TrafficLights | null = null;
  /** Atropello (para la policía y el dinero que se cae). */
  onRunOver: ((p: Ped, v: Vehicle) => void) | null = null;

  constructor(private graph: RoadGraph, private scene: THREE.Scene, private world: CollisionWorld, private ground: Ground, private max = 90) {}

  private makePed(x: number, z: number): Ped {
    const ch = new Character(randomLook(this.rng));
    this.scene.add(ch.root);
    const p: Ped = {
      ch, pos: new THREE.Vector3(x, this.ground.heightAt(x, z), z), heading: this.rng() * Math.PI * 2, mode: 'walk',
      edge: null, side: this.rng() < 0.5 ? -1 : 1, bias: this.rng() * 2 - 1, target: { x, z },
      speed: 1.15 + this.rng() * 0.5, timer: 0, wait: 0, idle: 0, vel: new THREE.Vector3(), fleeFrom: new THREE.Vector3(),
      id: pedIds++, health: 100, dead: false, habit: 'none', habitProp: 'none', partner: null, lookAt: null,
    };
    // hábitos: algunos van mirando el móvil, otros con un café o fumando
    const h = this.rng();
    if (h < 0.18) { p.habit = 'phone'; p.habitProp = 'phone'; }
    else if (h < 0.24) { p.habit = 'smoke'; p.habitProp = 'cigarette'; }
    else if (h < 0.3) { p.habit = 'drink'; p.habitProp = 'coffee'; }
    ch.setProp(p.habitProp);
    ch.setAction(p.habit === 'drink' ? 'none' : p.habit);
    this.peds.push(p);
    return p;
  }

  private offset(p: Ped, e: Edge) {
    // En calles con coches van por la acera; en peatonales, repartidos por el ancho
    return e.road.car ? this.graph.laneOffset(e) * p.side : this.graph.laneOffset(e, p.bias);
  }

  private spawn(focus: THREE.Vector3) {
    const e = this.graph.randomEdgeNear(focus.x, focus.z, 25, 180, this.rng, (ed) => ed.len > 3);
    if (!e) return;
    const side = this.rng() < 0.5 ? -1 : 1;
    const off = e.road.car ? this.graph.laneOffset(e) * side : this.graph.laneOffset(e, this.rng() * 2 - 1);
    const pt = this.graph.pointOn(e, this.rng() * e.len, off, { x: 0, z: 0 });
    const y = this.ground.heightAt(pt.x, pt.z);
    if (this.world.pointBlocked(pt.x, y + 0.5, pt.z)) return;
    // Solo en aceras y zonas peatonales: nunca sobre una calzada (ni en pasos de cebra ni en medianas)
    if (this.carway && this.carway.on(pt.x, pt.z, 0.8)) return;
    if (this.carway && !e.road.car && this.carway.on(pt.x + 1.5, pt.z, 0) && this.carway.on(pt.x - 1.5, pt.z, 0)) return;
    const p = this.makePed(pt.x, pt.z);
    p.side = side;
    p.edge = e;
    this.graph.pointOn(e, e.len, this.offset(p, e), p.target);
    // a veces, dos personas paradas charlando
    if (this.rng() < 0.12 && this.peds.length < this.max - 1) {
      const a = this.rng() * Math.PI * 2;
      const qx = pt.x + Math.sin(a) * 1.1, qz = pt.z + Math.cos(a) * 1.1;
      if (!this.world.pointBlocked(qx, y + 0.5, qz) && !(this.carway && this.carway.on(qx, qz, 0.8))) {
        const q = this.makePed(qx, qz);
        q.edge = e; q.side = side;
        this.graph.pointOn(e, e.len, this.offset(q, e), q.target);
        p.mode = q.mode = 'chat';
        p.partner = q; q.partner = p;
        p.timer = q.timer = 15 + this.rng() * 30;
        p.heading = Math.atan2(qx - pt.x, qz - pt.z); q.heading = p.heading + Math.PI;
      }
    }
  }

  /** Hablar con un peatón: se para, mira al jugador y contesta. Devuelve la frase. */
  talkTo(p: Ped, from: THREE.Vector3, night: boolean, armed: boolean, place: string): string {
    if (p.dead || p.mode === 'down') return '';
    if (armed) { this.surrender(p, from); return pick(LINES.scared); }
    p.mode = 'talk';
    p.timer = 6;
    p.lookAt = from.clone();
    p.ch.setAction('talk');
    if (this.rng() < 0.3) return pick(LINES.directions(place));
    return pick(night ? LINES.night : LINES.day);
  }

  /** Manos arriba si le apuntan con un arma. */
  surrender(p: Ped, from: THREE.Vector3) {
    if (p.dead || p.mode === 'down' || p.mode === 'surrender' || p.mode === 'flee') return;
    p.mode = 'surrender';
    p.timer = 2 + this.rng() * 2;
    p.lookAt = from.clone();
    p.fleeFrom.copy(from);
    p.ch.setProp('none');
    p.ch.setAction('handsUp');
  }

  /** Tiros o peleas cerca: unos se agachan y se cubren, la mayoría huye. */
  alarm(pos: THREE.Vector3, radius: number) {
    for (const p of this.peds) {
      if (p.dead || p.mode === 'down') continue;
      const d2 = p.pos.distanceToSquared(pos);
      if (d2 > radius * radius) continue;
      p.ch.setProp('none');
      if (this.rng() < 0.3 && d2 < 400) {
        p.mode = 'cower'; p.timer = 2 + this.rng() * 3; p.ch.setAction('cower');
      } else {
        p.mode = 'flee'; p.timer = 7 + this.rng() * 5; p.ch.setAction('none');
      }
      p.fleeFrom.copy(pos);
      if (p.partner) { p.partner.partner = null; p.partner = null; }
    }
  }

  /** Daño a un peatón (disparo, golpe o explosión). */
  hit(p: Ped, damage: number, dx: number, dz: number, melee: boolean, from: THREE.Vector3) {
    if (p.dead) return;
    p.health -= damage;
    p.fleeFrom.copy(from);
    p.ch.setProp('none');
    if (p.health <= 0 || (melee && damage >= 40)) {
      p.dead = p.health <= 0;
      p.mode = 'down';
      p.timer = 0;
      p.ch.setAction('none');
      p.vel.set(dx * (melee ? 3 : 1.5), melee ? 2.5 : 1.2, dz * (melee ? 3 : 1.5));
    } else {
      p.ch.play('hit');
      p.mode = 'flee';
      p.timer = 8;
      p.ch.setAction('none');
    }
  }

  /** Para el combate: los peatones como dianas. */
  targets() {
    return this.peds.map((p) => ({
      pos: p.pos, radius: 0.3, height: p.mode === 'down' ? 0.4 : p.mode === 'cower' ? 1.1 : 1.75, alive: !p.dead,
      hit: (dmg: number, dx: number, dz: number, melee: boolean, from: THREE.Vector3) => this.hit(p, dmg, dx, dz, melee, from),
    }));
  }

  /** El peatón más cercano delante de un punto (para hablar). */
  nearest(pos: THREE.Vector3, heading: number, maxD = 2.6): Ped | null {
    let best: Ped | null = null, bd = maxD;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    for (const p of this.peds) {
      if (p.dead || p.mode === 'down') continue;
      const dx = p.pos.x - pos.x, dz = p.pos.z - pos.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.2) { bd = d; best = p; }
    }
    return best;
  }

  private advance(p: Ped) {
    if (!p.edge) return;
    const ne = this.graph.next(p.edge, this.rng);
    if (!ne) return;
    p.edge = ne;
    this.graph.pointOn(ne, ne.len, this.offset(p, ne), p.target);
  }

  /** Peatón que huye (p. ej. el conductor al que le robas el coche). */
  spawnFleeing(x: number, z: number, from: THREE.Vector3) {
    const p = this.makePed(x, z);
    p.mode = 'flee';
    p.timer = 8;
    p.fleeFrom.copy(from);
    return p;
  }

  update(dt: number, focus: THREE.Vector3, vehicles: Vehicle[], threat: THREE.Vector3 | null) {
    for (let k = this.peds.length - 1; k >= 0; k--) {
      const p = this.peds[k];
      if (p.pos.distanceTo(focus) > 230) {
        this.scene.remove(p.ch.root);
        p.ch.dispose();
        this.peds.splice(k, 1);
      }
    }
    let budget = 4;
    while (this.peds.length < this.max && budget-- > 0) this.spawn(focus);

    this.grid.clear();
    for (const p of this.peds) {
      const kx = Math.floor(p.pos.x / 2), kz = Math.floor(p.pos.z / 2);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const key = `${kx + i},${kz + j}`;
        let arr = this.grid.get(key);
        if (!arr) this.grid.set(key, (arr = []));
        arr.push(p);
      }
    }
    for (const p of this.peds) {
      if (p.mode === 'down') { this.updateDown(p, dt); continue; }
      if (p.mode === 'talk' || p.mode === 'chat' || p.mode === 'cower' || p.mode === 'surrender') {
        // parados: mirando a alguien, charlando, agachados o con las manos arriba
        p.timer -= dt;
        const look = p.mode === 'chat' ? p.partner?.pos ?? null : p.lookAt;
        if (look) p.heading += angleDiff(Math.atan2(look.x - p.pos.x, look.z - p.pos.z), p.heading) * Math.min(1, dt * 5);
        if (p.mode === 'chat') p.ch.setAction(Math.sin(p.timer * 0.7 + (p.partner && p.partner.id < p.id ? 0 : 2)) > 0 ? 'talk' : 'arms');
        if (p.timer <= 0) {
          if (p.mode === 'cower' || p.mode === 'surrender') { p.mode = 'flee'; p.timer = 7; p.ch.setAction('none'); }
          else {
            p.mode = 'walk'; p.partner = null; p.lookAt = null;
            p.ch.setProp(p.habitProp); p.ch.setAction(p.habit === 'drink' ? 'none' : p.habit);
          }
        }
        p.ch.root.position.copy(p.pos);
        p.ch.root.rotation.y = p.heading;
        p.ch.animate(dt, 0);
        continue;
      }

      // Atropellos
      for (const v of vehicles) {
        const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
        if (dx * dx + dz * dz > 40 || Math.abs(p.pos.y - v.pos.y) > 2.5) continue;
        const c = v.circles();
        const hit = [[c[0], c[1]], [c[2], c[3]]].some(([cx, cz]) => (p.pos.x - cx) ** 2 + (p.pos.z - cz) ** 2 < (c[4] + 0.35) ** 2);
        if (!hit) continue;
        if (v.speed > 3.5) {
          p.mode = 'down';
          p.timer = 0;
          p.health -= v.speed * 6;
          if (p.health <= 0) p.dead = true;
          p.ch.setAction('none'); p.ch.setProp('none');
          this.onRunOver?.(p, v);
          p.vel.set(v.vel.x * 0.85, 2 + v.speed * 0.15, v.vel.y * 0.85);
          v.vel.multiplyScalar(0.94);
          break;
        } else {
          const d = Math.hypot(dx, dz) || 1;
          p.pos.x += (dx / d) * 0.1;
          p.pos.z += (dz / d) * 0.1;
        }
      }
      if (p.mode === 'down') continue;

      if (threat && p.mode !== 'flee' && p.pos.distanceToSquared(threat) < 64) {
        p.mode = 'flee';
        p.timer = 5;
        p.fleeFrom.copy(threat);
      }

      let speed = p.speed;
      let desired = p.heading;
      if (p.mode === 'walk') {
        if ((p.pos.x - p.target.x) ** 2 + (p.pos.z - p.target.z) ** 2 < 1.5) this.advance(p);
        desired = Math.atan2(p.target.x - p.pos.x, p.target.z - p.pos.z);
        // Pausas cortas de vez en cuando
        if (p.idle > 0) {
          p.idle -= dt; speed = 0;
          if (p.idle <= 0) p.ch.setAction(p.habit === 'drink' ? 'none' : p.habit);
        } else if (this.rng() < dt * 0.02) {
          p.idle = 2 + this.rng() * 6;
          const r = this.rng();
          p.ch.setAction(p.habit !== 'none' ? (p.habit === 'drink' ? 'drink' : p.habit) : r < 0.4 ? 'look' : r < 0.7 ? 'arms' : r < 0.85 ? 'phone' : 'none');
          if (p.ch.action === 'phone' && p.habitProp === 'none') p.ch.setProp('phone');
        }
        // Antes de bajar a la calzada: mirar semáforo y coches
        if (speed > 0 && this.carway) {
          const sx = Math.sin(desired), sz = Math.cos(desired);
          const onRoad = this.carway.on(p.pos.x, p.pos.z, 0.2);
          const stepping = !onRoad && this.carway.on(p.pos.x + sx * 1.4, p.pos.z + sz * 1.4, 0);
          if (stepping) {
            let mustWait = !!this.lights?.pedestrianRed(p.pos.x, p.pos.z, sx, sz);
            if (!mustWait) {
              for (const v of vehicles) {
                const ox = p.pos.x - v.pos.x, oz = p.pos.z - v.pos.z;
                const d2 = ox * ox + oz * oz;
                if (d2 > 30 * 30 || v.speed < 1.5) continue;
                const vx = v.vel.x / v.speed, vz = v.vel.y / v.speed;
                const ahead = ox * vx + oz * vz;
                const t = ahead / v.speed;
                if (ahead > 0 && t < 4.5 && Math.abs(ox * vz - oz * vx) < 6) { mustWait = true; break; }
              }
            }
            if (mustWait) { speed = 0; p.wait += dt; } else p.wait = 0;
            if (p.wait > 40) { p.wait = 0; p.side = -p.side; this.advance(p); } // se cansa y da la vuelta
          }
        }
      } else {
        p.timer -= dt;
        speed = 5.5;
        desired = Math.atan2(p.pos.x - p.fleeFrom.x, p.pos.z - p.fleeFrom.z);
        if (p.timer < 0) {
          p.mode = 'walk';
          p.ch.setProp(p.habitProp);
          const near = this.graph.nearestEdgeFast(p.pos.x, p.pos.z);
          p.edge = near;
          if (near) this.graph.pointOn(near, near.len, this.offset(p, near), p.target);
        }
      }

      p.heading += angleDiff(desired, p.heading) * Math.min(1, dt * 6);
      p.pos.x += Math.sin(p.heading) * speed * dt;
      p.pos.z += Math.cos(p.heading) * speed * dt;
      // Separación entre peatones (no atravesarse)
      const key = `${Math.floor(p.pos.x / 2)},${Math.floor(p.pos.z / 2)}`;
      for (const o of this.grid.get(key) ?? []) {
        if (o === p) continue;
        const dx = p.pos.x - o.pos.x, dz = p.pos.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.49 && d2 > 1e-6) { const d = Math.sqrt(d2); p.pos.x += (dx / d) * (0.7 - d) * 0.5; p.pos.z += (dz / d) * (0.7 - d) * 0.5; }
      }
      const hitWall = this.world.resolveCircle(p.pos, 0.32, p.pos.y);
      if (hitWall && p.mode === 'walk') {
        p.timer += dt;
        if (p.timer > 2.5) { p.timer = 0; p.side = -p.side; p.bias = -p.bias; this.advance(p); }
      }
      p.pos.y = this.ground.heightAt(p.pos.x, p.pos.z, p.pos.y);

      p.ch.root.position.copy(p.pos);
      p.ch.root.rotation.y = p.heading;
      p.ch.animate(dt, speed);
    }
  }

  private updateDown(p: Ped, dt: number) {
    p.timer += dt;
    const g = this.ground.heightAt(p.pos.x, p.pos.z, p.pos.y);
    if (p.pos.y > g + 0.01 || p.vel.y > 0) {
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < g) { p.pos.y = g; p.vel.set(p.vel.x * 0.3, 0, p.vel.z * 0.3); }
      p.ch.root.rotation.y += dt * 6;
      this.world.resolveCircle(p.pos, 0.35, p.pos.y);
    } else {
      p.vel.multiplyScalar(Math.max(0, 1 - dt * 4));
      p.pos.addScaledVector(p.vel, dt);
      p.pos.y = this.ground.heightAt(p.pos.x, p.pos.z, p.pos.y);
    }
    p.ch.root.position.copy(p.pos);
    p.ch.setDown(Math.min(1, p.timer * 3));
    if (p.dead) {
      if (p.timer > 30) p.timer = 30; // se queda en el suelo (se retira al alejarse)
      return;
    }
    if (p.timer > 6) {
      p.ch.reset();
      p.mode = 'flee';
      p.timer = 6;
      p.fleeFrom.set(p.pos.x - Math.sin(p.heading), 0, p.pos.z - Math.cos(p.heading));
    }
  }
}
