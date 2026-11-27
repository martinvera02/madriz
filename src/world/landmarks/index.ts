/**
 * Edificios emblemáticos con interior real: se entra andando por su puerta, sin pantallas de carga.
 * Cada uno sustituye al bloque de OSM por un modelo propio con fachada, plantas, salas, escaleras y
 * mobiliario, sobre su planta real.
 *
 * common.ts   tipos (Landmark, Npc, Offer), geometría de plantas, rótulos, gente y materiales
 * <edificio>.ts  un constructor por edificio
 * index.ts    registro (qué edificio de OSM se sustituye por cuál) y recorte del terreno
 */

import * as THREE from 'three';
import type { WorldData, BuildingData } from '../realData';
import type { Ground } from '../roads';
import type { CollisionWorld } from '../collision';
import { type Landmark, inPoly } from './common';
import { sanMiguel } from './sanMiguel';
import { sanGines } from './sanGines';
import { atocha } from './atocha';
import { circulo } from './circulo';
export type { Landmark, Offer, Npc } from './common';

interface Def {
  /** Nombre del edificio (o identificador OSM) de las partes que se sustituyen. */
  match(b: BuildingData): boolean;
  build(parts: BuildingData[], ground: Ground, collision: CollisionWorld, terrainH: (x: number, z: number) => number): Landmark;
}

const nameIs = (n: string) => (b: BuildingData) => (b as { name?: string }).name === n;
const DEFS: Def[] = [
  { match: nameIs('Mercado de San Miguel'), build: (p, g, c, t) => sanMiguel(p[0], g, c, t) },
  // el edificio del pasadizo de San Ginés que da a la calle del Arenal (la chocolatería)
  { match: (b) => b.id === 'w334382546', build: (p, g, c, t) => sanGines(p[0], g, c, t) },
  // la nave histórica: el polígono de 26 m es la nave entera; el resto de partes (pabellones, marquesina…) se rehacen
  { match: nameIs('Atocha (Histórica)'), build: (p, g, c, t) => atocha(p.reduce((a, b) => (b.h === 26 ? b : a)), g, c, t) },
  { match: nameIs('Círculo de Bellas Artes'), build: (p, g, c, t) => circulo(p, g, c, t) },
];

/** Edificios de OSM que se sustituyen por un modelo con interior, agrupados por definición. */
export function landmarkBuildings(data: WorldData): Map<BuildingData, Def> {
  const out = new Map<BuildingData, Def>();
  for (const b of data.buildings) for (const d of DEFS) if (d.match(b)) { out.set(b, d); break; }
  return out;
}

export function buildLandmarks(data: WorldData, ground: Ground, collision: CollisionWorld, chosen: Map<BuildingData, Def>): Landmark[] {
  const byDef = new Map<Def, BuildingData[]>();
  for (const [b, d] of chosen) { let a = byDef.get(d); if (!a) byDef.set(d, (a = [])); a.push(b); }
  const out: Landmark[] = [];
  for (const [d, parts] of byDef) {
    try { out.push(d.build(parts, ground, collision, (x, z) => ground.terrain.heightAt(x, z))); }
    catch (e) { console.error('No se ha podido levantar un edificio con interior', e); }
  }
  void data;
  return out;
}

/**
 * Terreno bajo los edificios con interior: los vértices que caen dentro se bajan por debajo del suelo del edificio
 * (así no asoma el terreno en las salas aunque la calle tenga cuesta) y los triángulos que quedan enteros dentro
 * se quitan (sótanos y huecos de escalera).
 */
export function cutTerrain(group: THREE.Object3D, polys: { pts: number[]; floor: number; floorAt?: (x: number, z: number) => number }[]) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry as THREE.BufferGeometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const idx = g.index;
    if (!idx) return;
    m.updateMatrixWorld();
    const inv = m.matrixWorld.clone().invert();
    const v = new THREE.Vector3();
    const inside = new Uint8Array(pos.count);
    let any = false;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      for (const p of polys) {
        if (!inPoly(p.pts, v.x, v.z)) continue;
        inside[i] = 1; any = true;
        const fl = p.floorAt ? p.floorAt(v.x, v.z) : p.floor;
        if (v.y > fl - 0.6) { v.y = fl - 0.6; v.applyMatrix4(inv); pos.setXYZ(i, v.x, v.y, v.z); }
        break;
      }
    }
    if (!any) return;
    pos.needsUpdate = true;
    const keep: number[] = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      if (inside[a] && inside[b] && inside[c]) continue;
      keep.push(a, b, c);
    }
    g.setIndex(keep);
    g.computeBoundingSphere();
  });
}
