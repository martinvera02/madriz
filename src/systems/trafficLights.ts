import * as THREE from 'three';
import type { WorldData } from '../world/realData';
import { Ground } from '../world/roads';
import { CollisionWorld } from '../world/collision';
import { RoadGraph, Edge } from './roadGraph';
import type { CarwayIndex } from '../world/spatial';

/*
 * Semáforos reales (nodos highway=traffic_signals de OSM) agrupados en cruces.
 * Cada cruce alterna dos fases según la dirección de los accesos (eje A / eje B):
 * verde 16 s → ámbar 3 s → todo rojo 2 s → el otro eje. Los peatones cruzan con el eje contrario.
 */

const GREEN = 16, AMBER = 3, ALLRED = 2;
const CYCLE = (GREEN + AMBER + ALLRED) * 2;

interface Junction {
  x: number; z: number;
  axis: number; // ángulo (mod PI) del eje A
  offset: number;
  heads: { idx: number; phase: 0 | 1 }[];
}

export type Light = 'green' | 'amber' | 'red';

export class TrafficLights {
  readonly group = new THREE.Group();
  private junctions: Junction[] = [];
  /** Arista que llega a un cruce regulado → {cruce, fase, distancia de la línea de detención al final de la arista} */
  private control = new Map<number, { j: Junction; phase: 0 | 1; stopBack: number }>();
  private time = 0;
  private lamps: THREE.InstancedMesh;
  private lampColors: { idx: number; j: Junction; phase: 0 | 1 }[] = [];
  private col = new THREE.Color();

  constructor(data: WorldData, graph: RoadGraph, ground: Ground, collision: CollisionWorld, carway: CarwayIndex) {
    const roadIdx = new Map(data.roads.map((r, i) => [r, i] as const));
    // 1) Agrupar semáforos cercanos en cruces
    const S = data.signals;
    const used = new Array(S.length / 2).fill(false);
    const clusters: { x: number; z: number; n: number }[] = [];
    for (let i = 0; i < S.length / 2; i++) {
      if (used[i]) continue;
      let sx = 0, sz = 0, n = 0;
      for (let j = i; j < S.length / 2; j++) {
        if (used[j]) continue;
        if (Math.hypot(S[j * 2] - S[i * 2], S[j * 2 + 1] - S[i * 2 + 1]) < 32) { used[j] = true; sx += S[j * 2]; sz += S[j * 2 + 1]; n++; }
      }
      clusters.push({ x: sx / n, z: sz / n, n });
    }

    // 2) Aristas que entran en cada cruce
    let rng = 12345;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (const c of clusters) {
      const approaches: { e: Edge; ang: number }[] = [];
      for (const e of graph.edges) {
        const tx = graph.x(e.to), tz = graph.z(e.to), fx = graph.x(e.from), fz = graph.z(e.from);
        const dTo = Math.hypot(tx - c.x, tz - c.z), dFrom = Math.hypot(fx - c.x, fz - c.z);
        if (dTo < 26 && dFrom > dTo + 2 && dFrom > 14) approaches.push({ e, ang: Math.atan2(e.dx, e.dz) });
      }
      if (approaches.length < 2) continue;
      const axis = ((approaches[0].ang % Math.PI) + Math.PI) % Math.PI;
      const j: Junction = { x: c.x, z: c.z, axis, offset: rand() * CYCLE, heads: [] };
      this.junctions.push(j);
      for (const a of approaches) {
        let d = Math.abs((((a.ang % Math.PI) + Math.PI) % Math.PI) - axis);
        d = Math.min(d, Math.PI - d);
        const phase: 0 | 1 = d < Math.PI / 4 ? 0 : 1;
        // Línea de detención: antes del borde de la calzada que se cruza (en avenidas anchas puede estar a 15 m del centro)
        const ri = roadIdx.get(a.e.road) ?? -1;
        const tmp = { x: 0, z: 0 };
        let sEdge = a.e.len;
        for (let s = a.e.len; s > Math.max(0, a.e.len - 30); s -= 0.5) {
          graph.pointOn(a.e, s, 0, tmp);
          if (!carway.on(tmp.x, tmp.z, 0.3, ri)) { sEdge = s; break; }
          sEdge = s;
        }
        this.control.set(a.e.id, { j, phase, stopBack: Math.max(4, a.e.len - sEdge + 2.5) });
      }
    }

    // 3) Postes con semáforo a la derecha de cada acceso (uno por calle y sentido)
    const poles: THREE.Matrix4[] = [], heads: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const seen = new Set<string>();
    for (const [eid, ctl] of this.control) {
      const e = graph.edges[eid];
      const key = `${e.road.id}:${e.from < e.to ? 1 : 0}:${this.junctions.indexOf(ctl.j)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // El poste va en la acera, a la derecha y a la altura de la línea de detención; nunca en una calzada
      const s0 = Math.max(0, e.len - ctl.stopBack + 1.5);
      let p: { x: number; z: number } | null = null;
      search: for (const ds of [0, -1.5, -3, 1, -5]) {
        for (let off = e.road.w / 2 + 0.6; off <= e.road.w / 2 + 3.2; off += 0.4) {
          const t = graph.pointOn(e, Math.max(0, Math.min(e.len, s0 + ds)), off, { x: 0, z: 0 });
          const ty = ground.terrain.heightAt(t.x, t.z);
          if (!carway.on(t.x, t.z, 0.35) && !collision.pointBlocked(t.x, ty + 1, t.z)) { p = t; break search; }
        }
      }
      if (!p) continue;
      const y = ground.heightAt(p.x, p.z, ground.terrain.heightAt(p.x, p.z) + 0.5);
      q.setFromAxisAngle(up, Math.atan2(-e.dx, -e.dz)); // mirando a los coches que llegan
      m.compose(new THREE.Vector3(p.x, y, p.z), q, one);
      poles.push(m.clone());
      heads.push(m.clone());
      collision.addCircle(p.x, p.z, 0.12, y + 3.2);
      const hi = heads.length - 1;
      this.lampColors.push({ idx: hi, j: ctl.j, phase: ctl.phase });
    }
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6).translate(0, 1.7, 0);
    const headGeo = new THREE.BoxGeometry(0.32, 0.95, 0.25).translate(0, 2.9, 0.12);
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2e31, roughness: 0.5, metalness: 0.5 });
    const ip = new THREE.InstancedMesh(poleGeo, ironMat, Math.max(1, poles.length));
    const ih = new THREE.InstancedMesh(headGeo, ironMat, Math.max(1, heads.length));
    poles.forEach((mm, i) => ip.setMatrixAt(i, mm));
    heads.forEach((mm, i) => ih.setMatrixAt(i, mm));
    ip.count = poles.length; ih.count = heads.length;
    ip.castShadow = true;
    // Una sola luz por cabeza: se coloca a la altura del color encendido
    const lampGeo = new THREE.CircleGeometry(0.11, 12).translate(0, 0, 0.255);
    this.lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, heads.length));
    this.lamps.count = heads.length;
    this.baseHeads = heads;
    for (const im of [ip, ih, this.lamps]) { im.computeBoundingSphere(); this.group.add(im); }
    this.update(0);
  }

  private baseHeads: THREE.Matrix4[];

  /** Estado de la fase de un cruce en el instante actual. */
  state(j: Junction, phase: 0 | 1): Light {
    const t = (this.time + j.offset) % CYCLE;
    const half = GREEN + AMBER + ALLRED;
    const local = phase === 0 ? t : (t + half) % CYCLE;
    if (local < GREEN) return 'green';
    if (local < GREEN + AMBER) return 'amber';
    return 'red';
  }

  /** ¿Debe detenerse un coche que va por la arista `e`? Devuelve la distancia (desde el inicio de la arista) a la línea de detención. */
  stopFor(e: Edge): number | null {
    const c = this.control.get(e.id);
    if (!c) return null;
    const st = this.state(c.j, c.phase);
    if (st === 'green') return null;
    return Math.max(0, e.len - c.stopBack);
  }

  /** ¿Pueden cruzar los peatones cerca de (x,z)? (cruzan cuando los coches del eje que atraviesan están en rojo) */
  pedestrianRed(x: number, z: number, dirX: number, dirZ: number): boolean {
    for (const j of this.junctions) {
      if ((j.x - x) ** 2 + (j.z - z) ** 2 > 40 * 40) continue;
      // el peatón cruza la calle del eje cuyo ángulo es perpendicular a su marcha
      const ang = ((Math.atan2(dirX, dirZ) % Math.PI) + Math.PI) % Math.PI;
      let d = Math.abs(ang - j.axis); d = Math.min(d, Math.PI - d);
      const crossingAxisPhase: 0 | 1 = d < Math.PI / 4 ? 1 : 0; // si camina paralelo al eje A, cruza las calles del eje B
      return this.state(j, crossingAxisPhase) !== 'red';
    }
    return false;
  }

  /**
   * Avisador acústico para invidentes del cruce más cercano (≤ 22 m): suena mientras los peatones tienen verde
   * en alguna de las calles, con cadencia rápida en los últimos segundos.
   */
  crossingBeep(x: number, z: number): { d: number; fast: boolean } | null {
    let best: Junction | null = null, bd = 22 * 22;
    for (const j of this.junctions) {
      const d = (j.x - x) ** 2 + (j.z - z) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    if (!best) return null;
    const t = (this.time + best.offset) % CYCLE;
    const half = GREEN + AMBER + ALLRED;
    const inHalf = t % half;
    // los peatones de un eje cruzan mientras el otro tiene verde (sin contar el ámbar)
    if (inHalf >= GREEN) return null;
    return { d: Math.sqrt(bd), fast: inHalf > GREEN - 4 };
  }

  update(dt: number) {
    this.time += dt;
    const m = new THREE.Matrix4();
    for (const l of this.lampColors) {
      const st = this.state(l.j, l.phase);
      const y = st === 'red' ? 3.2 : st === 'amber' ? 2.9 : 2.6;
      m.copy(this.baseHeads[l.idx]).multiply(new THREE.Matrix4().makeTranslation(0, y, 0));
      this.lamps.setMatrixAt(l.idx, m);
      this.lamps.setColorAt(l.idx, this.col.setHex(st === 'red' ? 0xff2a1a : st === 'amber' ? 0xffb21a : 0x3dff6a));
    }
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}
