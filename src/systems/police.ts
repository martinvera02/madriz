import * as THREE from 'three';
import { angleDiff, clamp } from '../config';
import type { WorldData } from '../world/realData';
import type { CollisionWorld } from '../world/collision';
import type { Ground } from '../world/roads';
import { Vehicle, VEHICLE_TYPES } from '../entities/vehicle';
import { Character, randomLook } from '../entities/character';
import { Helicopter } from '../entities/helicopter';

/*
 * Nivel de búsqueda y Policía Municipal.
 *  - Los delitos suben el "calor" (disparar, herir, matar, atacar a un agente, robar un coche de policía…);
 *    el calor se traduce en estrellas (1–5). Sin que te vea ningún agente, se va enfriando.
 *  - Con estrellas salen patrullas (más cuantas más estrellas) desde fuera de la vista. Te persiguen por la red
 *    de calles con A* (pueden ir en sentido contrario), con sirena y rotativos.
 *  - Si estás a pie o te paras cerca, los agentes bajan del coche, se acercan, te dan el alto y disparan si
 *    estás armado o tienes 2+ estrellas. Si arrancas, vuelven al coche y siguen la persecución.
 *  - 4 estrellas: furgones de la UIP con cuatro agentes con subfusil y chaleco, las patrullas embisten
 *    y montan controles (dos coches cruzados) en la calle por la que vas.
 *  - 5 estrellas: además, el helicóptero, con foco de noche y un tirador en la puerta.
 */

/** Estrellas a partir de las que salen furgones de la UIP, controles y helicóptero. */
export const UIP_STARS = 4, HELI_STARS = 5;

/** Cuántas unidades de calle quiere la policía con `stars` estrellas (sin contar controles). */
export function wantedUnits(stars: number) {
  return Math.min(6, stars + (stars >= 3 ? 1 : 0));
}

const HEAT_STARS = [35, 110, 240, 430, 680];

interface Officer {
  ch: Character; pos: THREE.Vector3; heading: number; health: number; alive: boolean;
  state: 'car' | 'foot' | 'return'; fireT: number; car: Unit; side: number; deadT: number;
  /** Subfusil (UIP): ráfagas cortas y más alcance. */
  smg: boolean; burst: number;
}
type UnitKind = 'patrol' | 'uip' | 'block';
interface Unit {
  v: Vehicle; path: number[]; pathT: number; stuck: number; reverse: number; jams: number; officers: Officer[]; parked: boolean;
  kind: UnitKind;
}

export class Police {
  heat = 0;
  stars = 0;
  /** Segundos desde que un agente te vio por última vez. */
  unseen = 99;
  readonly units: Unit[] = [];
  private adj = new Map<number, number[]>();
  private nodes: number[];
  private nodeGrid = new Map<string, number[]>();
  onShoot: ((from: THREE.Vector3, to: THREE.Vector3, heavy?: boolean) => void) | null = null;
  /** Helicóptero derribado: revienta en `pos`. */
  onHeliDown: ((pos: THREE.Vector3) => void) | null = null;
  heli: Helicopter | null = null;
  private heliFire = 2;
  private heliAway = 0;
  private blockT = 0;
  onSay: ((pos: THREE.Vector3, text: string) => void) | null = null;
  private sayT = 0;

  constructor(data: WorldData, private scene: THREE.Scene, private world: CollisionWorld, private ground: Ground,
    private hasLOS: (a: THREE.Vector3, b: THREE.Vector3) => boolean) {
    this.nodes = data.roadNodes;
    // grafo no dirigido de calzadas (la policía puede ir en contra en una urgencia)
    for (const r of data.roads) {
      // calzadas y, en una urgencia, también calles peatonales (Sol, Preciados, Arenal…)
      if ((!r.car && r.hw !== 'pedestrian') || r.br) continue;
      for (let i = 1; i < r.n.length; i++) {
        const a = r.n[i - 1], b = r.n[i];
        if (a === b) continue;
        this.link(a, b); this.link(b, a);
      }
    }
    for (const n of this.adj.keys()) {
      const k = this.cell(this.nodes[n * 2], this.nodes[n * 2 + 1]);
      let arr = this.nodeGrid.get(k);
      if (!arr) this.nodeGrid.set(k, (arr = []));
      arr.push(n);
    }
  }

  private link(a: number, b: number) {
    let arr = this.adj.get(a);
    if (!arr) this.adj.set(a, (arr = []));
    if (!arr.includes(b)) arr.push(b);
  }
  private cell(x: number, z: number) { return `${Math.floor(x / 60)},${Math.floor(z / 60)}`; }
  private nx(n: number) { return this.nodes[n * 2]; }
  private nz(n: number) { return this.nodes[n * 2 + 1]; }

  private nearestNode(x: number, z: number): number | null {
    let best: number | null = null, bd = Infinity;
    const ci = Math.floor(x / 60), cj = Math.floor(z / 60);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      for (const n of this.nodeGrid.get(`${i},${j}`) ?? []) {
        const d = (this.nx(n) - x) ** 2 + (this.nz(n) - z) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
    }
    return best;
  }

  /** A* sobre los nodos de la red viaria (máx. ~4000 expansiones). */
  private path(from: number, to: number): number[] {
    const open = new Map<number, number>([[from, 0]]);
    const g = new Map<number, number>([[from, 0]]);
    const came = new Map<number, number>();
    const h = (n: number) => Math.hypot(this.nx(n) - this.nx(to), this.nz(n) - this.nz(to));
    let it = 0;
    while (open.size && it++ < 4000) {
      let cur = -1, bf = Infinity;
      for (const [n, f] of open) if (f < bf) { bf = f; cur = n; }
      if (cur === to) break;
      open.delete(cur);
      for (const nb of this.adj.get(cur) ?? []) {
        const ng = g.get(cur)! + Math.hypot(this.nx(nb) - this.nx(cur), this.nz(nb) - this.nz(cur));
        if (ng < (g.get(nb) ?? Infinity)) { g.set(nb, ng); came.set(nb, cur); open.set(nb, ng + h(nb)); }
      }
    }
    const out: number[] = [];
    let c: number | undefined = came.has(to) ? to : undefined;
    if (c === undefined) return [];
    while (c !== undefined && c !== from) { out.push(c); c = came.get(c); }
    return out.reverse();
  }

  /** Delito: sube el calor según la gravedad (más si lo ve un agente). */
  crime(kind: 'shot' | 'hurt' | 'kill' | 'melee' | 'copHurt' | 'copKill' | 'explosion' | 'stealCop' | 'stealCar', pos: THREE.Vector3) {
    const base = { shot: 18, hurt: 40, kill: 90, melee: 14, copHurt: 120, copKill: 220, explosion: 80, stealCop: 120, stealCar: 0 }[kind];
    const seenByCop = this.units.some((u) => u.officers.some((o) => o.alive && o.pos.distanceTo(pos) < 70) || u.v.pos.distanceTo(pos) < 70);
    this.heat = Math.min(900, this.heat + base * (seenByCop ? 1.5 : 1));
    if (seenByCop) this.unseen = 0;
  }

  /** Muerte o borrado de antecedentes: fin de la persecución. */
  clear() {
    this.heat = 0; this.stars = 0;
    for (const u of this.units) this.removeUnit(u);
    this.units.length = 0;
    if (this.heli) { this.scene.remove(this.heli.mesh); this.heli.dispose(); this.heli = null; }
  }

  /** Helicóptero: llega con 5 estrellas, se va al bajar de 4 (o si te pierde un buen rato). */
  private updateHeli(dt: number, player: THREE.Vector3, dead: boolean) {
    const gy = this.ground.heightAt(player.x, player.z);
    if (!this.heli && this.stars >= HELI_STARS && !dead) {
      this.heli = new Helicopter();
      this.heli.spawn(player, gy);
      this.scene.add(this.heli.mesh);
      this.heliAway = 0;
    }
    const h = this.heli;
    if (!h) return;
    const leaving = this.stars < UIP_STARS || dead;
    this.heliAway = leaving ? this.heliAway + dt : 0;
    // al irse, sube y se aleja; desaparece a los 15 s
    const target = leaving ? new THREE.Vector3(h.pos.x + 200, 0, h.pos.z + 200) : player;
    const ty = leaving ? h.pos.y - 40 : gy;
    const landed = h.update(dt, target, h.falling ? this.ground.heightAt(h.pos.x, h.pos.z) : ty, this.night, leaving ? 90 : 45);
    if (landed) { this.onHeliDown?.(h.pos.clone()); }
    if ((leaving && this.heliAway > 15) || (h.crashed && h.pos.distanceTo(player) > 120)) {
      this.scene.remove(h.mesh); h.dispose(); this.heli = null; return;
    }
    if (h.falling || leaving) return;
    // el tirador de la puerta: si te ve, nadie te pierde; dispara cada ~2 s
    const from = h.gunner(new THREE.Vector3());
    const aim = player.clone().setY(player.y + 1.1);
    if (h.pos.distanceTo(player) < 110 && this.hasLOS(from, aim)) {
      this.unseen = 0;
      this.heliFire -= dt;
      if (this.heliFire <= 0) { this.heliFire = 1.6 + Math.random() * 1.2; this.onShoot?.(from, aim, true); }
    }
  }

  /** Oscuridad 0–1 (para el foco del helicóptero), la pone main.ts. */
  night = 0;

  vehicles() { return this.units.map((u) => u.v); }
  targets() {
    const out: { pos: THREE.Vector3; radius: number; height: number; alive: boolean; hit: (d: number, dx: number, dz: number, m: boolean, f: THREE.Vector3) => void }[] = [];
    for (const u of this.units) for (const o of u.officers) {
      if (o.state === 'car') continue;
      out.push({
        pos: o.pos, radius: 0.3, height: 1.75, alive: o.alive,
        hit: (dmg, dx, dz) => {
          if (!o.alive) return;
          o.health -= dmg;
          o.ch.play('hit');
          this.crime(o.health <= 0 ? 'copKill' : 'copHurt', o.pos);
          if (o.health <= 0) { o.alive = false; o.ch.setAction('none'); o.ch.setProp('none'); o.pos.x += dx * 0.4; o.pos.z += dz * 0.4; }
        },
      });
    }
    const h = this.heli;
    if (h && !h.falling) {
      out.push({
        pos: h.pos.clone().setY(h.pos.y - 1.4), radius: 1.6, height: 2.8, alive: true,
        hit: (dmg) => {
          if (h.falling) return;
          h.health -= dmg;
          this.crime('copHurt', h.pos);
          if (h.health <= 0) { h.shootDown(); this.crime('copKill', h.pos); }
        },
      });
    }
    return out;
  }

  /** Nodos de la red a entre `d0` y `d1` m del punto (en celdas de 60 m). */
  private nodesAround(x: number, z: number, d0: number, d1: number) {
    const cand: number[] = [];
    const R = Math.ceil(d1 / 60);
    const ci = Math.floor(x / 60), cj = Math.floor(z / 60);
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) {
      for (const n of this.nodeGrid.get(`${i},${j}`) ?? []) {
        const d = Math.hypot(this.nx(n) - x, this.nz(n) - z);
        if (d > d0 && d < d1) cand.push(n);
      }
    }
    return cand;
  }

  private addOfficers(unit: Unit, n: number, smg: boolean, foot: boolean) {
    const v = unit.v;
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? 1 : -1;
      const look = randomLook();
      const ch = new Character(smg
        ? { ...look, top: 'jacket', shirt: 0x15181e, inner: 0x2a2e36, pants: 0x15181e, hairStyle: 'cap', capColor: 0x101216, stripe: false, female: Math.random() < 0.15 }
        : { ...look, top: 'jacket', shirt: 0x1d2a44, inner: 0xe9e6df, pants: 0x1d2a44, hairStyle: 'cap', capColor: 0x1d2a44, stripe: true, female: Math.random() < 0.3 });
      ch.root.visible = foot;
      this.scene.add(ch.root);
      const o: Officer = { ch, pos: v.pos.clone(), heading: 0, health: smg ? 170 : 100, alive: true, state: foot ? 'foot' : 'car', fireT: 1 + Math.random(), car: unit, side, deadT: 0, smg, burst: 0 };
      if (foot) {
        // detrás del coche (lado contrario al jugador lo decide placeBlock)
        ch.setProp(smg ? 'smg' : 'pistol');
      }
      unit.officers.push(o);
    }
  }

  private spawnUnit(player: THREE.Vector3, kind: UnitKind = 'patrol') {
    // un nodo entre 110 y 220 m, fuera de la vista inmediata
    const cand: number[] = [];
    const ci = Math.floor(player.x / 60), cj = Math.floor(player.z / 60);
    for (let i = ci - 4; i <= ci + 4; i++) for (let j = cj - 4; j <= cj + 4; j++) {
      for (const n of this.nodeGrid.get(`${i},${j}`) ?? []) {
        const d = Math.hypot(this.nx(n) - player.x, this.nz(n) - player.z);
        if (d > 110 && d < 220) cand.push(n);
      }
    }
    if (!cand.length) return;
    const n = cand[Math.floor(Math.random() * cand.length)];
    const nb = (this.adj.get(n) ?? [])[0];
    if (nb === undefined) return;
    const x = this.nx(n), z = this.nz(n);
    if (this.world.pointBlocked(x, this.ground.heightAt(x, z) + 0.8, z)) return;
    const v = new Vehicle(VEHICLE_TYPES[kind === 'uip' ? 'uip' : 'policia']);
    v.place(x, z, Math.atan2(this.nx(nb) - x, this.nz(nb) - z), this.ground.heightAt(x, z));
    v.driver = 'ai';
    v.siren = true;
    this.scene.add(v.mesh);
    const unit: Unit = { v, path: [], pathT: 0, stuck: 0, reverse: 0, jams: 0, officers: [], parked: false, kind };
    this.addOfficers(unit, kind === 'uip' ? 4 : 2, kind === 'uip', false);
    this.units.push(unit);
  }

  /**
   * Control policial: dos coches cruzados en una calle por delante del jugador (110–170 m en la dirección en
   * que va), con los agentes ya fuera, parapetados detrás.
   */
  private spawnBlock(player: THREE.Vector3, car: Vehicle) {
    const hx = Math.sin(car.heading), hz = Math.cos(car.heading);
    let best = -1, bs = -Infinity;
    for (const n of this.nodesAround(player.x, player.z, 110, 170)) {
      const dx = this.nx(n) - player.x, dz = this.nz(n) - player.z, d = Math.hypot(dx, dz);
      const dot = (dx * hx + dz * hz) / d;
      if (dot < 0.85 || (this.adj.get(n)?.length ?? 0) > 2) continue; // en mitad de una calle, no en un cruce
      if (dot > bs) { bs = dot; best = n; }
    }
    if (best < 0) return false;
    const nb = this.adj.get(best)![0];
    const x = this.nx(best), z = this.nz(best);
    const ra = Math.atan2(this.nx(nb) - x, this.nz(nb) - z);
    const px = Math.cos(ra), pz = -Math.sin(ra); // perpendicular a la calle
    const y = this.ground.heightAt(x, z);
    if (this.world.pointBlocked(x, y + 0.8, z)) return false;
    // lado del control que mira hacia el jugador: los agentes se ponen al otro
    const towards = Math.sign((player.x - x) * Math.sin(ra) + (player.z - z) * Math.cos(ra)) || 1;
    for (const s of [-1, 1]) {
      const v = new Vehicle(VEHICLE_TYPES.policia);
      v.place(x + px * s * 2.3, z + pz * s * 2.3, ra + Math.PI / 2 + (s > 0 ? 0.2 : -0.2), y);
      v.driver = 'ai';
      v.siren = true;
      this.scene.add(v.mesh);
      const unit: Unit = { v, path: [], pathT: 0, stuck: 0, reverse: 0, jams: 0, officers: [], parked: true, kind: 'block' };
      this.addOfficers(unit, 2, this.stars >= HELI_STARS, true);
      unit.officers.forEach((o, k) => {
        const off = (k ? 1.2 : -1.2);
        o.pos.set(v.pos.x + px * off - Math.sin(ra) * towards * 3, y, v.pos.z + pz * off - Math.cos(ra) * towards * 3);
        o.ch.root.position.copy(o.pos);
      });
      this.units.push(unit);
    }
    if (this.sayT <= 0) { this.onSay?.(new THREE.Vector3(x, y, z), '¡Control! ¡Para el coche!'); this.sayT = 6; }
    return true;
  }

  private removeUnit(u: Unit) {
    this.scene.remove(u.v.mesh);
    u.v.dispose();
    for (const o of u.officers) { this.scene.remove(o.ch.root); o.ch.dispose(); }
  }

  update(dt: number, player: THREE.Vector3, playerCar: Vehicle | null, armed: boolean, dead: boolean, others: Vehicle[]) {
    // calor → estrellas; se enfría si no te ve nadie
    this.unseen += dt;
    if (this.unseen > 14) this.heat = Math.max(0, this.heat - dt * (6 + this.stars * 2));
    let st = 0;
    for (const t of HEAT_STARS) if (this.heat >= t) st++;
    this.stars = st;
    this.sayT -= dt;

    // patrullas: 1 con 1 estrella, hasta 6; con 4+, la mitad son furgones de la UIP
    const want = dead ? 0 : wantedUnits(this.stars);
    const active = this.units.filter((u) => !u.v.burnt && u.kind !== 'block');
    if (active.length < want && Math.random() < dt * 0.8) {
      const uips = active.filter((u) => u.kind === 'uip').length;
      this.spawnUnit(player, this.stars >= UIP_STARS && uips < Math.ceil(want / 2) ? 'uip' : 'patrol');
    }
    // controles: con 4+ estrellas y huyendo en coche, uno cada ~25 s como mucho
    this.blockT -= dt;
    if (!dead && this.stars >= UIP_STARS && playerCar && playerCar.speed > 8 && this.blockT <= 0 && !this.units.some((u) => u.kind === 'block')) {
      this.blockT = this.spawnBlock(player, playerCar) ? 25 : 3;
    }
    this.updateHeli(dt, player, dead);

    for (let k = this.units.length - 1; k >= 0; k--) {
      const u = this.units[k];
      const v = u.v;
      const stolen = v.driver === 'player';
      if (stolen) {
        // te has llevado el coche patrulla: los agentes se quedan a pie
        for (const o of u.officers) if (o.state === 'car') { o.state = 'foot'; o.pos.copy(v.pos); o.ch.root.visible = true; o.ch.setProp('pistol'); }
        u.parked = true;
        v.siren = false;
      }
      const d = v.pos.distanceTo(player);
      const anyOut = u.officers.some((o) => o.state !== 'car');
      const blockGone = u.kind === 'block' && (d > 300 || this.stars < UIP_STARS - 1);
      if (!stolen && (blockGone || (this.stars === 0 && d > 160 && !anyOut) || d > 420 || (u.officers.every((o) => !o.alive) && d > 80))) {
        this.removeUnit(u); this.units.splice(k, 1); continue;
      }
      // ¿te ven?
      for (const o of u.officers) if (o.alive && (o.state === 'car' ? d : o.pos.distanceTo(player)) < 60 && this.stars > 0) this.unseen = 0;
      if (!stolen) v.siren = this.stars > 0 && !v.burnt;
      const inCar = u.officers.filter((o) => o.state === 'car' && o.alive);
      if (v.burnt) { u.officers.forEach((o) => { if (o.state === 'car') { o.state = 'foot'; o.ch.root.visible = true; o.pos.copy(v.pos); } }); }
      // ---- conducción: persecución
      if (inCar.length && !v.burnt && this.stars > 0) {
        const playerSlow = !playerCar || playerCar.speed < 3;
        if (d < (playerSlow ? 16 : 0) && !u.parked) {
          // se paran y bajan
          u.parked = true;
          for (const o of inCar) {
            o.state = 'foot';
            const s = Math.sin(v.heading), c = Math.cos(v.heading);
            o.pos.set(v.pos.x - c * o.side * 1.6, v.pos.y, v.pos.z + s * o.side * 1.6);
            o.ch.root.visible = true;
            o.ch.setProp(o.smg ? 'smg' : 'pistol');
          }
          if (this.sayT <= 0) { this.onSay?.(v.pos, ['¡Policía! ¡Alto!', '¡Quieto ahí! ¡Las manos!', '¡Al suelo, ya!'][Math.floor(Math.random() * 3)]); this.sayT = 6; }
        }
        if (!u.parked) this.drive(u, dt, player, playerCar);
      }
      if (!stolen && (u.parked || !inCar.length || this.stars === 0)) v.update(dt, { throttle: v.forwardSpeed() > 0.5 ? -1 : 0, steer: 0, handbrake: true }, this.world, this.ground);
      // ---- agentes a pie
      for (const o of u.officers) {
        if (o.state === 'car') continue;
        if (!o.alive) {
          o.deadT += dt;
          o.ch.setDown(Math.min(1, o.deadT * 3));
          o.ch.root.position.copy(o.pos);
          continue;
        }
        const dp = o.pos.distanceTo(player);
        // volver al coche si te vas en uno
        if (playerCar && playerCar.speed > 4 && dp > 22 && !v.burnt && !stolen && u.kind !== 'block') o.state = 'return';
        let speed = 0;
        let want = Math.atan2(player.x - o.pos.x, player.z - o.pos.z);
        if (u.kind === 'block' && this.stars > 0) {
          // en el control no persiguen: se quedan parapetados y disparan
          if (dp < 9) speed = 3;
        }
        if (o.state === 'return') {
          const dc = o.pos.distanceTo(v.pos);
          want = Math.atan2(v.pos.x - o.pos.x, v.pos.z - o.pos.z);
          speed = 5;
          o.ch.setAction('none');
          if (dc < 2.2) { o.state = 'car'; o.ch.root.visible = false; u.parked = false; }
        } else if (this.stars > 0 && !dead) {
          const los = this.hasLOS(o.pos.clone().setY(o.pos.y + 1.5), player.clone().setY(player.y + 1.2));
          if (u.kind !== 'block' && (dp > 13 || !los)) speed = dp > 30 ? 5.5 : 4;
          const range = o.smg ? 42 : 32;
          o.ch.setAction(dp < range && los ? (o.smg ? 'aimRifle' : 'aimPistol') : 'none');
          o.ch.aimPitch = 0;
          // disparan si vas armado, si tienes 2+ estrellas o si estás en un coche intentando huir
          if (los && dp < range && (armed || this.stars >= 2 || playerCar)) {
            o.fireT -= dt;
            if (o.fireT <= 0) {
              // subfusil: ráfagas de 3–4 disparos; pistola: tiro a tiro
              if (o.smg) {
                if (o.burst <= 0) o.burst = 3 + Math.floor(Math.random() * 2);
                o.burst--;
                o.fireT = o.burst > 0 ? 0.11 : 0.9 + Math.random() * 0.6;
              } else o.fireT = 0.75 + Math.random() * 0.7;
              o.ch.play('recoil');
              this.onShoot?.(o.ch.muzzle(new THREE.Vector3()), player.clone().setY(player.y + 1.1), o.smg);
            }
          }
        } else {
          o.ch.setAction('none');
          if (o.pos.distanceTo(v.pos) > 2.2) { want = Math.atan2(v.pos.x - o.pos.x, v.pos.z - o.pos.z); speed = 1.6; }
          else if (!stolen) { o.state = 'car'; o.ch.root.visible = false; u.parked = false; }
        }
        o.heading += angleDiff(want, o.heading) * Math.min(1, dt * 8);
        if (speed > 0) {
          o.pos.x += Math.sin(o.heading) * speed * dt;
          o.pos.z += Math.cos(o.heading) * speed * dt;
          this.world.resolveCircle(o.pos, 0.32, o.pos.y);
          o.pos.y = this.ground.heightAt(o.pos.x, o.pos.z, o.pos.y);
        }
        o.ch.root.position.copy(o.pos);
        o.ch.root.rotation.y = o.heading;
        o.ch.animate(dt, speed);
      }
      void others;
    }
  }

  /** Punto de la ruta a `look` metros por delante de la proyección del coche sobre ella. */
  private lookahead(u: Unit, look: number): [number, number, number] | null {
    const v = u.v;
    const pts: number[] = [v.pos.x, v.pos.z];
    for (const n of u.path.slice(0, 40)) pts.push(this.nx(n), this.nz(n));
    if (pts.length < 4) return null;
    // segmento más cercano al coche
    let bi = 0, bt = 0, bd = Infinity;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = clamp(((v.pos.x - ax) * dx + (v.pos.z - az) * dz) / L2, 0, 1);
      const d = (ax + dx * t - v.pos.x) ** 2 + (az + dz * t - v.pos.z) ** 2;
      if (d < bd - 0.01) { bd = d; bi = i; bt = t; }
    }
    // avanzar `look` metros por la polilínea
    let i = bi, t = bt, rest = look;
    while (i + 3 < pts.length) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const L = Math.hypot(bx - ax, bz - az);
      const left = L * (1 - t);
      if (left >= rest && L > 0) { const tt = t + rest / L; return [ax + (bx - ax) * tt, az + (bz - az) * tt, Math.sqrt(bd)]; }
      rest -= left; i += 2; t = 0;
    }
    return [pts[pts.length - 2], pts[pts.length - 1], Math.sqrt(bd)];
  }

  /** Recoloca una patrulla atascada en un nodo de su ruta (solo si no la ves). */
  private relocate(u: Unit, player: THREE.Vector3) {
    const v = u.v;
    for (let k = Math.min(u.path.length - 2, 12); k >= 0; k--) {
      const n = u.path[k], nb = u.path[k + 1];
      const x = this.nx(n), z = this.nz(n);
      if (Math.hypot(x - player.x, z - player.z) < 60) continue;
      if (this.world.pointBlocked(x, this.ground.heightAt(x, z) + 0.8, z)) continue;
      v.place(x, z, Math.atan2(this.nx(nb) - x, this.nz(nb) - z), this.ground.heightAt(x, z));
      u.path = u.path.slice(k + 1);
      return true;
    }
    return false;
  }

  /** Persecución por la red de calles: A* cada segundo y persecución pura sobre la polilínea. */
  private drive(u: Unit, dt: number, player: THREE.Vector3, playerCar: Vehicle | null) {
    const v = u.v;
    u.pathT -= dt;
    const d = v.pos.distanceTo(player);
    if (u.pathT <= 0) {
      u.pathT = 1;
      const a = this.nearestNode(v.pos.x + Math.sin(v.heading) * 6, v.pos.z + Math.cos(v.heading) * 6), b = this.nearestNode(player.x, player.z);
      u.path = a !== null && b !== null ? [a, ...this.path(a, b)] : [];
    }
    const vf = v.forwardSpeed();
    const look = 7 + Math.abs(vf) * 0.6;
    const la = d < 30 ? null : this.lookahead(u, look);
    let tx = player.x, tz = player.z;
    if (la) { tx = la[0]; tz = la[1]; }
    const ang = angleDiff(Math.atan2(tx - v.pos.x, tz - v.pos.z), v.heading);
    let throttle = 1, steer = clamp(-ang * 2.2, -1, 1);
    // en curvas cerradas, levantar el pie; frenar fuerte si el giro es de casi 90º
    if (Math.abs(ang) > 0.6 && vf > 11) throttle = -0.7;
    else if (Math.abs(ang) > 1.2 && vf > 5) throttle = -0.4;
    else if (Math.abs(ang) > 0.35) throttle = 0.6;
    if (playerCar && d < 12 && playerCar.speed < 2) throttle = -1;
    // con 4+ estrellas embisten: de cerca van a por el coche, sin frenar
    if (this.stars >= UIP_STARS && playerCar && playerCar.speed > 4 && d < 28) {
      const ra = angleDiff(Math.atan2(player.x - v.pos.x, player.z - v.pos.z), v.heading);
      steer = clamp(-ra * 2.6, -1, 1);
      throttle = 1;
    }
    if (!playerCar && d < 14) throttle = vf > 1 ? -1 : 0;
    // atascado: marcha atrás girando; tras varios intentos, recolocar fuera de vista
    if (u.reverse > 0) { u.reverse -= dt; throttle = -1; steer = -steer; }
    else if (Math.abs(vf) < 1 && throttle > 0) {
      u.stuck += dt;
      if (u.stuck > 1.6) {
        u.reverse = 1.4; u.stuck = 0; u.jams++;
        if (u.jams >= 3 && d > 60 && this.relocate(u, player)) u.jams = 0;
      }
    } else { u.stuck = 0; if (Math.abs(vf) > 6) u.jams = Math.max(0, u.jams - dt * 0.2); }
    // muy fuera de la ruta y lejos de ti: recolocar
    if (la && la[2] > 30 && d > 80 && this.relocate(u, player)) u.jams = 0;
    v.update(dt, { throttle, steer, handbrake: false }, this.world, this.ground);
  }
}
