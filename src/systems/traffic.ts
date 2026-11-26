import * as THREE from 'three';
import { angleDiff, clamp } from '../config';
import { CollisionWorld } from '../world/collision';
import { Ground } from '../world/roads';
import { Vehicle, VEHICLE_TYPES, DriveInput } from '../entities/vehicle';
import { RoadGraph, Edge, SPEED } from './roadGraph';
import type { TrafficLights } from './trafficLights';

/*
 * Tráfico sobre la red viaria real: los coches siguen las aristas del grafo de OSM,
 * respetan los sentidos únicos, circulan por la derecha y frenan ante obstáculos.
 */

interface AIState { edge: Edge; next: Edge | null; bias: number; target: { x: number; z: number }; cruise: number; stuck: number; honk: number; reverse: number; }

export class Traffic {
  readonly cars: Vehicle[] = [];
  private ai = new Map<Vehicle, AIState>();
  private rng = Math.random;

  lights: TrafficLights | null = null;
  /** Posiciones de peatones (las actualiza main.ts cada frame). */
  pedPositions: { x: number; z: number }[] = [];

  constructor(private graph: RoadGraph, private scene: THREE.Scene, private world: CollisionWorld, private ground: Ground, private max = 40) {}

  private pickType(e: Edge) {
    const r = this.rng();
    // Autobuses de la EMT solo por calles anchas de doble sentido o avenidas principales
    const big = e.road.w >= 10 && ['primary', 'secondary', 'trunk', 'tertiary'].includes(e.road.hw);
    if (big && r < 0.07) return VEHICLE_TYPES.autobus;
    if (r < 0.24) return VEHICLE_TYPES.taxi; // en el centro hay muchísimos taxis
    if (r < 0.31) return VEHICLE_TYPES.furgoneta;
    if (r < 0.36) return VEHICLE_TYPES.furgon;
    if (r < 0.38) return VEHICLE_TYPES.deportivo;
    if (r < 0.52) return VEHICLE_TYPES.suv;
    if (r < 0.66) return VEHICLE_TYPES.berlina;
    if (r < 0.84) return VEHICLE_TYPES.compacto;
    return VEHICLE_TYPES.utilitario;
  }

  private spawn(focus: THREE.Vector3, minR: number) {
    const e = this.graph.randomEdgeNear(focus.x, focus.z, minR, 320, this.rng, (ed) => ed.road.hw !== 'living_street' && ed.len > 6);
    if (!e) return;
    const type = this.pickType(e);
    if (type.width > e.road.w * 0.6 && e.road.ow) return; // no cabe
    const bias = this.rng() * 2 - 1;
    const off = this.graph.laneOffset(e, bias);
    const s = this.rng() * e.len;
    const p = this.graph.pointOn(e, s, off, { x: 0, z: 0 });
    if (this.cars.some((c) => (c.pos.x - p.x) ** 2 + (c.pos.z - p.z) ** 2 < 100)) return;
    if (this.world.pointBlocked(p.x, this.ground.heightAt(p.x, p.z) + 0.5, p.z)) return;
    const v = new Vehicle(type);
    v.place(p.x, p.z, Math.atan2(e.dx, e.dz), this.ground.heightAt(p.x, p.z));
    v.driver = 'ai';
    const cruise = (SPEED[e.road.hw] ?? 9) * (0.85 + this.rng() * 0.25);
    v.vel.set(e.dx * cruise * 0.5, e.dz * cruise * 0.5);
    this.ai.set(v, { edge: e, next: this.graph.next(e, this.rng), bias, target: { x: 0, z: 0 }, cruise, stuck: 0, honk: 0, reverse: 0 });
    this.cars.push(v);
    this.scene.add(v.mesh);
  }

  /** Saca un coche del control de la IA (p. ej. lo roba el jugador). */
  release(v: Vehicle) {
    this.ai.delete(v);
    const k = this.cars.indexOf(v);
    if (k >= 0) this.cars.splice(k, 1);
    v.driver = 'none';
  }

  update(dt: number, focus: THREE.Vector3, obstacles: Vehicle[], playerPos: THREE.Vector3 | null) {
    for (let k = this.cars.length - 1; k >= 0; k--) {
      const c = this.cars[k];
      if (c.pos.distanceTo(focus) > 420 || (this.ai.get(c)?.stuck ?? 0) > 1e8) {
        this.scene.remove(c.mesh);
        c.dispose();
        this.ai.delete(c);
        this.cars.splice(k, 1);
      }
    }
    let budget = 3;
    while (this.cars.length < this.max && budget-- > 0) this.spawn(focus, this.cars.length < this.max / 2 ? 40 : 170);

    const input: DriveInput = { throttle: 0, steer: 0, handbrake: false };
    for (const c of this.cars) {
      const s = this.ai.get(c)!;
      const g = this.graph;
      // Progreso a lo largo de la arista actual
      let e = s.edge;
      let along = (c.pos.x - g.x(e.from)) * e.dx + (c.pos.z - g.z(e.from)) * e.dz;
      if (along > e.len - 1.5 && s.next) {
        s.edge = s.next;
        s.next = g.next(s.edge, this.rng);
        e = s.edge;
        along = (c.pos.x - g.x(e.from)) * e.dx + (c.pos.z - g.z(e.from)) * e.dz;
        s.cruise = (SPEED[e.road.hw] ?? 9) * (0.85 + ((c.id * 7) % 10) / 40);
      }
      // Persecución pura: punto objetivo a "look" metros por delante sobre el carril (cruza a la siguiente arista)
      const lookA = 5 + c.speed * 0.55;
      const remain = e.len - along;
      if (remain > lookA || !s.next) g.pointOn(e, Math.min(e.len, Math.max(0, along) + lookA), g.laneOffset(e, s.bias), s.target);
      else {
        const nx = s.next;
        g.pointOn(nx, Math.min(nx.len, lookA - remain), g.laneOffset(nx, s.bias), s.target);
      }
      const desired = Math.atan2(s.target.x - c.pos.x, s.target.z - c.pos.z);
      const diff = angleDiff(desired, c.heading);
      input.steer = clamp(-diff * 2.0, -1, 1);

      // Velocidad: menos en curvas, al llegar a giros cerrados y en cruces
      let limit = s.cruise * (1 - Math.min(Math.abs(diff), 1.2) * 0.5);
      if (s.next) {
        const turn = Math.acos(clamp(e.dx * s.next.dx + e.dz * s.next.dz, -1, 1)); // 0 recto, PI media vuelta
        if (turn > 0.5) limit = Math.min(limit, Math.max(4.5, Math.sqrt(Math.max(0, remain)) * 2.6 + (Math.PI - turn) * 2));
      }
      // Semáforos: frenar antes de la línea de detención
      if (this.lights) {
        const stopAt = this.lights.stopFor(e);
        if (stopAt !== null) {
          const toStop = stopAt - along - c.type.length / 2;
          if (toStop > -1) limit = Math.min(limit, Math.max(0, toStop) * 0.7);
        }
      }

      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      const look = 7 + c.speed * 0.9;
      let blockedBy = 0;
      const check = (px: number, pz: number, rad: number, gap: number, tag = 1) => {
        const ox = px - c.pos.x, oz = pz - c.pos.z;
        const ahead = ox * fx + oz * fz;
        if (ahead < 0.5 || ahead > look) return;
        const side = Math.abs(ox * fz - oz * fx);
        if (side < rad) { const l = Math.max(0, (ahead - c.type.length / 2 - gap) * 0.8); if (l < limit) { limit = l; blockedBy = tag; } }
      };
      for (const o of obstacles) if (o !== c && o.pos.distanceToSquared(c.pos) < 900) check(o.pos.x, o.pos.z, (c.type.width + o.type.width) / 2 + 0.1, 3, o.driver === 'ai' ? 2 : 3);
      if (playerPos) check(playerPos.x, playerPos.z, 1.6, 2.5, 4);
      // Ceder el paso a los peatones que cruzan
      for (const p of this.pedPositions) if ((p.x - c.pos.x) ** 2 + (p.z - c.pos.z) ** 2 < 400) check(p.x, p.z, 1.6, 2.2, 5);
      (c as unknown as { dbg: unknown }).dbg = { limit: +limit.toFixed(1), blockedBy, light: this.lights?.stopFor(e) ?? null, along: +along.toFixed(1), len: +e.len.toFixed(1), hw: e.road.hw, stuck: +s.stuck.toFixed(1) };

      const vf = c.forwardSpeed();
      input.throttle = vf < limit - 0.8 ? 1 : vf > limit + 0.8 ? -1 : 0;
      // Maniobra para desatascarse: marcha atrás con el volante girado al contrario
      if (s.reverse > 0) {
        s.reverse -= dt;
        input.throttle = -1;
        input.steer = -input.steer;
      }
      // Intermitente antes de girar en el próximo cruce
      c.blink = 0;
      if (s.next && remain < 30) {
        const cross = e.dx * s.next.dz - e.dz * s.next.dx;
        const dot = e.dx * s.next.dx + e.dz * s.next.dz;
        if (dot < 0.8) c.blink = cross > 0 ? -1 : 1;
      }
      // Claxon si lleva un rato bloqueado por otro coche o por el jugador
      if (blockedBy >= 2 && blockedBy <= 4 && c.speed < 1 && !(this.lights?.stopFor(e) !== null && blockedBy === 2)) s.honk += dt; else s.honk = 0;
      c.horn = s.honk > 4 && (s.honk % 3) < 0.45;
      c.update(dt, input, this.world, this.ground);

      // Atascado contra algo: dar la vuelta
      if (limit > 2 && c.speed < 0.4 && s.reverse <= 0) s.stuck += dt; else if (c.speed > 1) s.stuck = 0;
      if (s.stuck > 2.5 && s.stuck < 2.5 + dt * 1.5) s.reverse = 1.4;
      if (s.stuck > 12 && c.pos.distanceTo(focus) > 70) { s.stuck = 1e9; continue; } // se retira (fuera de la vista)
      if (s.stuck > 7) {
        const back = (this.graph.out.get(s.edge.to) ?? []).find((o) => o.to === s.edge.from) ??
          (this.graph.out.get(s.edge.from) ?? [])[0];
        if (back) {
          s.edge = back;
          s.next = this.graph.next(back, this.rng);
        }
        s.stuck = 0;
      }
    }
  }

  /** Coches aparcados en cordón junto al bordillo (para robar sin sacar a nadie). */
  spawnParked(focus: THREE.Vector3, count: number, list: Vehicle[]) {
    for (let k = 0; k < count; k++) {
      const e = this.graph.randomEdgeNear(focus.x, focus.z, 15, 300, this.rng,
        (ed) => ed.len > 12 && ((ed.road.ow && ed.road.w >= 6) || ed.road.w >= 12) && ['residential', 'tertiary', 'secondary', 'unclassified'].includes(ed.road.hw));
      if (!e) continue;
      const q = this.rng();
      const v = new Vehicle(q < 0.05 ? VEHICLE_TYPES.deportivo : q < 0.3 ? VEHICLE_TYPES.utilitario : q < 0.55 ? VEHICLE_TYPES.compacto : q < 0.72 ? VEHICLE_TYPES.suv : q < 0.88 ? VEHICLE_TYPES.berlina : q < 0.95 ? VEHICLE_TYPES.furgoneta : VEHICLE_TYPES.furgon);
      const off = e.road.w / 2 - v.type.width / 2 - 0.25;
      const p = this.graph.pointOn(e, 4 + this.rng() * (e.len - 8), off, { x: 0, z: 0 });
      if (list.some((c) => (c.pos.x - p.x) ** 2 + (c.pos.z - p.z) ** 2 < 30)) continue;
      const y = this.ground.heightAt(p.x, p.z);
      if (this.world.pointBlocked(p.x, y + 0.5, p.z)) continue;
      v.place(p.x, p.z, Math.atan2(e.dx, e.dz) + (this.rng() - 0.5) * 0.04, y);
      list.push(v);
      this.scene.add(v.mesh);
    }
  }
}
