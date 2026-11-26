import { RoadGraph, SPEED, type Edge } from './roadGraph';

/**
 * GPS: ruta más rápida por la red viaria real hasta el destino que marques en el mapa
 * (o hasta el objetivo de la misión). En coche respeta los sentidos únicos y pondera por el tipo
 * de vía (avenidas más rápidas que calles residenciales); a pie va por aceras, plazas y calles peatonales.
 */

/** Montículo binario mínimo de (nodo, prioridad). */
class Heap {
  private n: number[] = [];
  private p: number[] = [];
  get size() { return this.n.length; }
  push(node: number, pri: number) {
    const n = this.n, p = this.p;
    let i = n.length;
    n.push(node); p.push(pri);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= p[i]) break;
      [n[i], n[j]] = [n[j], n[i]]; [p[i], p[j]] = [p[j], p[i]];
      i = j;
    }
  }
  pop(): number {
    const n = this.n, p = this.p;
    const top = n[0];
    const ln = n.pop()!, lp = p.pop()!;
    if (n.length) {
      n[0] = ln; p[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < n.length && p[l] < p[m]) m = l;
        if (r < n.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [n[i], n[m]] = [n[m], n[i]]; [p[i], p[m]] = [p[m], p[i]];
        i = m;
      }
    }
    return top;
  }
}

const WALK_SPEED = 1.5;
/** Penalización de tiempo por cruce (semáforos, giros…), en segundos. */
const NODE_COST = 1.2;

export interface Route {
  /** Polilínea x,z en metros, desde ti hasta el destino. */
  pts: Float32Array;
  /** Longitud en metros. */
  length: number;
  /** Tiempo estimado en segundos. */
  eta: number;
  car: boolean;
}

export class Navigation {
  /** Destino marcado por el jugador. */
  waypoint: { x: number; z: number } | null = null;
  route: Route | null = null;
  private timer = 0;
  private lastTarget: { x: number; z: number } | null = null;
  private lastCar = false;
  /** Se ha llegado al destino marcado en este frame (para avisar). */
  arrived = false;

  constructor(private cars: RoadGraph, private walk: RoadGraph) {}

  setWaypoint(x: number, z: number) { this.waypoint = { x, z }; this.timer = 0; }
  clearWaypoint() { this.waypoint = null; this.route = null; }

  /** `target`: el objetivo de la misión si hay (tiene prioridad sobre el destino marcado). */
  update(dt: number, x: number, z: number, heading: number, inCar: boolean, target: { x: number; z: number } | null) {
    this.arrived = false;
    const dest = target ?? this.waypoint;
    if (!dest) { this.route = null; this.lastTarget = null; return; }
    if (!target && this.waypoint && Math.hypot(x - this.waypoint.x, z - this.waypoint.z) < (inCar ? 18 : 8)) {
      this.arrived = true;
      this.clearWaypoint();
      return;
    }
    const moved = !this.lastTarget || Math.hypot(dest.x - this.lastTarget.x, dest.z - this.lastTarget.z) > 15;
    this.timer -= dt;
    if (this.timer > 0 && !moved && inCar === this.lastCar) {
      // entre recálculos: el primer tramo sale siempre de tu posición
      if (this.route) { this.route.pts[0] = x; this.route.pts[1] = z; }
      return;
    }
    this.timer = inCar ? 0.8 : 1.5;
    this.lastTarget = { x: dest.x, z: dest.z };
    this.lastCar = inCar;
    this.route = this.find(x, z, heading, inCar, dest.x, dest.z);
  }

  private cost(e: Edge, car: boolean) {
    return car ? e.len / (SPEED[e.road.hw] ?? 8) + NODE_COST : e.len / WALK_SPEED;
  }

  /** Ruta más rápida (A*) entre dos puntos cualesquiera del mapa. */
  find(x: number, z: number, heading: number, car: boolean, tx: number, tz: number): Route | null {
    const g = car ? this.cars : this.walk;
    const hx = Math.sin(heading), hz = Math.cos(heading);
    // arista de salida: cerca y, en coche, en el sentido en que vas
    let start: { e: Edge; d: number; t: number } | null = null, bs = Infinity;
    for (const c of g.edgesNear(x, z)) {
      const score = c.d + (car ? (1 - (c.e.dx * hx + c.e.dz * hz)) * 6 : 0);
      if (score < bs) { bs = score; start = c; }
    }
    // lejos de cualquier calzada (p. ej. en medio de Sol): la arista más cercana del mapa
    if (!start) {
      const n = g.nearestEdge(x, z);
      if (n) start = { e: n.e, t: n.t * n.e.len, d: n.d };
    }
    // llegada: aristas cercanas al destino (cualquiera de las dos puntas sirve)
    let ends = g.edgesNear(tx, tz).sort((a, b) => a.d - b.d).slice(0, 4);
    if (!ends.length) { const n = g.nearestEdge(tx, tz); if (n) ends = [{ e: n.e, t: n.t * n.e.len, d: n.d }]; }
    if (!start || !ends.length) return null;
    const goal = new Map<number, { e: Edge; t: number; back: boolean }>();
    for (const c of ends) {
      // desde e.from se recorre la arista hasta la proyección; desde e.to, si la calle es de doble sentido o a pie
      if (!goal.has(c.e.from)) goal.set(c.e.from, { e: c.e, t: c.t, back: false });
      if ((!car || !c.e.road.ow) && !goal.has(c.e.to)) goal.set(c.e.to, { e: c.e, t: c.t, back: true });
    }
    const maxV = car ? 22 : WALK_SPEED;
    const h = (n: number) => Math.hypot(g.x(n) - tx, g.z(n) - tz) / maxV;
    const gs = new Map<number, number>();
    const came = new Map<number, number>();
    const open = new Heap();
    const s0 = start.e.to;
    const c0 = (start.e.len - start.t) / (car ? SPEED[start.e.road.hw] ?? 8 : WALK_SPEED);
    gs.set(s0, c0);
    open.push(s0, c0 + h(s0));
    // si ya vas por la arista del destino, la ruta es directa
    let found = -1;
    if (goal.has(start.e.from) && ends.some((c) => c.e === start!.e)) found = -2;
    let it = 0;
    const closed = new Set<number>();
    while (found === -1 && open.size && it++ < 60000) {
      const n = open.pop();
      if (closed.has(n)) continue;
      closed.add(n);
      if (goal.has(n)) { found = n; break; }
      const gn = gs.get(n)!;
      for (const e of g.out.get(n) ?? []) {
        const ng = gn + this.cost(e, car);
        if (ng < (gs.get(e.to) ?? Infinity)) { gs.set(e.to, ng); came.set(e.to, n); open.push(e.to, ng + h(e.to)); }
      }
    }
    if (found === -1) return null;
    const pts: number[] = [x, z];
    let eta = 0;
    if (found >= 0) {
      const chain: number[] = [];
      for (let c: number | undefined = found; c !== undefined; c = came.get(c)) chain.push(c);
      chain.reverse();
      for (const n of chain) pts.push(g.x(n), g.z(n));
      eta = gs.get(found)!;
    }
    // último tramo: de la punta de la arista a la proyección del destino, y al destino
    const gl = found >= 0 ? goal.get(found)! : { e: start.e, t: ends[0].t, back: false };
    pts.push(g.x(gl.e.from) + gl.e.dx * gl.t, g.z(gl.e.from) + gl.e.dz * gl.t, tx, tz);
    let length = 0;
    for (let i = 2; i < pts.length; i += 2) length += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (found === -2) eta = length / (car ? 9 : WALK_SPEED);
    else eta += Math.hypot(tx - pts[pts.length - 4], tz - pts[pts.length - 3]) / (car ? 8 : WALK_SPEED);
    return { pts: new Float32Array(pts), length, eta, car };
  }
}

/** «850 m» / «1,4 km». */
export function fmtDist(m: number) { return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`; }
/** «1 min» / «12 min». */
export function fmtEta(s: number) { return `${Math.max(1, Math.round(s / 60))} min`; }
