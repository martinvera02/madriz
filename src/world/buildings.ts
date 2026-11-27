import * as THREE from 'three';
import type { BuildingData, WorldData } from './realData';
import { Terrain } from './terrain';
import { CollisionWorld } from './collision';
import { createBuildingMaterial } from './buildingMaterial';
import { FootprintIndex } from './spatial';

/** Estilo de fachada y colores que puede imponer un edificio emblemático. */
export interface FacadeOverride { style?: number; color?: number; roof?: number; skip?: boolean; /** Recorta la altura (cuando un remate se modela aparte). */ maxH?: number; }

export interface PlacedBuilding {
  data: BuildingData;
  ground: number; // altura media del terreno bajo el edificio
  top: number; // altura absoluta de la cubierta
  cx: number;
  cz: number;
}

// Paleta del Madrid histórico: ocres, almagras, crema, rosados, blanco roto, ladrillo
const PALETTE = [0xe2c79a, 0xd9a978, 0xc98a5e, 0xe8d8b8, 0xf0e4cc, 0xd8b08c, 0xc57b5a, 0xe6c2a8, 0xd6c3a2, 0xb9714f, 0xf2eadb, 0xcfa77e];
const BRICK = [0xa65a3f, 0xb8694a, 0x9a4f38];
const ROOF_TILE = [0x9b5a42, 0xa8644a, 0x8f5039];
const ROOF_FLAT = [0x8d8a84, 0x9a958c, 0x7f7c78];

const CHUNK = 400;

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

function pointInRing(x: number, z: number, pts: number[]) {
  let inside = false;
  for (let i = 0, j = pts.length / 2 - 1; i < pts.length / 2; j = i++) {
    const xi = pts[i * 2], zi = pts[i * 2 + 1], xj = pts[j * 2], zj = pts[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const NAMED_COLORS: Record<string, number> = {
  cream: 0xeee3c8, light_brown: 0xc9a27a, light_grey: 0xc8c6c0, light_gray: 0xc8c6c0, 'red-brown': 0x9a4f38,
  light_red: 0xd98c7a, beige: 0xe0cfae, brown: 0x8e5a3c, grey: 0x9a9894, gray: 0x9a9894, white: 0xf0ece4,
};
function parseColor(c?: string): number | null {
  if (!c) return null;
  const k = c.trim().toLowerCase();
  if (NAMED_COLORS[k] !== undefined) return NAMED_COLORS[k];
  if (!/^#|^rgb|^[a-z]+$/.test(k)) return null;
  try {
    const col = new THREE.Color(0x123456);
    col.setStyle(k);
    return col.getHex() === 0x123456 ? null : col.getHex();
  } catch {
    return null;
  }
}

class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  info: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: THREE.Color, info: [number, number, number]) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    this.info.push(info[0], info[1], info[2]);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Construcciones que no son edificios: se modelan aparte (kioskos, marquesinas, bóvedas de acceso). */
export interface SpecialStructure { kind: 'kiosk' | 'canopy' | 'vault'; data: BuildingData; ground: number; }

/** Paño de fachada visible (no medianera) para el detalle en relieve cercano. */
export interface FacadeRun {
  ax: number; az: number; bx: number; bz: number; nx: number; nz: number;
  len: number; u0: number; ground: number; top: number; seed: number; style: number;
  /** Sin balcones ni alféizares en relieve (fachadas especiales). */
  noBalconies?: boolean;
}

function ringArea(pts: number[]) {
  let a = 0;
  for (let i = 0, n = pts.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return a / 2;
}

export function buildBuildings(
  data: WorldData,
  terrain: Terrain,
  collision: CollisionWorld,
  override: (b: BuildingData) => FacadeOverride | null,
  minimap: HTMLCanvasElement,
): { group: THREE.Group; placed: PlacedBuilding[]; specials: SpecialStructure[]; facades: FacadeRun[]; roofSpots: { x: number; z: number; y: number; tile: boolean; area: number; seed: number; pts: number[] }[] } {
  const group = new THREE.Group();
  const material = createBuildingMaterial();
  const chunks = new Map<string, GeoBuilder>();
  const trims = new Map<string, { pos: number[]; nor: number[]; col: number[] }>();
  const placed: PlacedBuilding[] = [];
  const specials: SpecialStructure[] = [];
  const facades: FacadeRun[] = [];
  const roofSpots: { x: number; z: number; y: number; tile: boolean; area: number; seed: number; pts: number[] }[] = [];
  const wallCol = new THREE.Color();
  const roofCol = new THREE.Color();
  const trimCol = new THREE.Color();
  const plinthCol = new THREE.Color(0x8c877e);

  // ---------- Pasada 1: alturas y huellas (para medianeras y construcciones exentas)
  const pre = data.buildings.map((b, idx) => {
    const n = b.pts.length / 2;
    if (n < 3) return null;
    let gmin = Infinity, gsum = 0, cx = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      const gy = terrain.heightAt(b.pts[i * 2], b.pts[i * 2 + 1]);
      gmin = Math.min(gmin, gy); gsum += gy;
      cx += b.pts[i * 2]; cz += b.pts[i * 2 + 1];
    }
    return { idx, gmin, ground: gsum / n, cx: cx / n, cz: cz / n, area: Math.abs(ringArea(b.pts)) };
  });
  const foot = new FootprintIndex();
  data.buildings.forEach((b, i) => { const p = pre[i]; if (p) foot.add(b.pts, p.ground + b.h, i); });

  // Zonas verdes: los edificios sin altura conocida dentro de un parque son pabellones de una planta
  const green = new FootprintIndex();
  data.areas.forEach((a, i) => { if (a.kind === 'grass' || a.kind === 'wood') green.add(a.pts, 1, i); });

  const isolated = (b: BuildingData, idx: number) => {
    for (let i = 0; i < b.pts.length; i += 2) {
      for (const [dx, dz] of [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
        if (foot.topAt(b.pts[i] + dx, b.pts[i + 1] + dz, idx) > -Infinity) return false;
      }
    }
    return true;
  };

  // Minimapa: plantas de los edificios
  const mctx = minimap.getContext('2d')!;
  const mx0 = Number(minimap.dataset.x0), mz0 = Number(minimap.dataset.z0), ms = Number(minimap.dataset.scale);
  mctx.fillStyle = '#5f5a55';

  // ---------- Pasada 2: geometría
  data.buildings.forEach((b, idx) => {
    const p0 = pre[idx];
    if (!p0) return;
    const n = b.pts.length / 2;
    const ov = override(b);
    if (ov?.skip) return;
    const kind = b.kind ?? '';

    // Construcciones singulares que no deben ser bloques de viviendas
    if (!ov) {
      let sk: SpecialStructure['kind'] | null = null;
      if (kind === 'kiosk') sk = 'kiosk';
      else if (kind === 'roof' || kind === 'carport' || kind === 'shelter') sk = 'canopy';
      else if (b.name === 'La Cúpula' || (kind === 'train_station' && b.est && p0.area < 500)) sk = 'vault';
      else if (b.est && !b.part && p0.area < 60 && isolated(b, idx)) sk = 'kiosk';
      if (sk) { specials.push({ kind: sk, data: b, ground: p0.ground }); return; }
    }

    const { gmin, ground, cx, cz } = p0;
    // altura 0 en OSM = desconocida (no «a ras de suelo»): cinco plantas, como el caserío de alrededor
    let effH = b.h > 0 ? b.h : 15;
    if (!ov && b.est && !b.part && green.topAt(cx, cz) > -Infinity) effH = Math.min(effH, 5.2);
    const top = ground + Math.max(Math.min(effH, ov?.maxH ?? Infinity), 2.5);
    const bottom = b.mh > 0.5 ? ground + b.mh : gmin - 0.6;
    if (top <= bottom + 0.3) return;

    // Colores y estilo
    const seed = hashStr(b.id);
    let style = 0;
    let wall = PALETTE[Math.floor(seed * PALETTE.length)];
    if (['church', 'cathedral', 'chapel', 'basilica'].includes(kind)) { style = 4; wall = 0xd8d0c0; }
    else if (b.h > 55) { style = 1; wall = 0x9fb1bd; }
    else if (seed > 0.9) { style = 3; wall = BRICK[Math.floor(seed * 100) % 3]; }
    const tagCol = parseColor(b.col);
    if (tagCol !== null) wall = tagCol;
    if (ov?.style !== undefined) style = ov.style;
    if (ov?.color !== undefined) wall = ov.color;
    const oldTown = b.h < 32;
    const tileRoof = oldTown && seed < 0.75;
    let roof = tileRoof ? ROOF_TILE[Math.floor(seed * 30) % 3] : ROOF_FLAT[Math.floor(seed * 30) % 3];
    if (ov?.roof !== undefined) roof = ov.roof;
    wallCol.setHex(wall).offsetHSL(0, 0, (seed - 0.5) * 0.04);
    roofCol.setHex(roof);
    trimCol.copy(wallCol).lerp(new THREE.Color(0xf1ece0), style === 3 ? 0.85 : 0.45);
    const info: [number, number, number] = [style, top - ground, seed * 10];
    const shaderSeed = Math.floor(seed * 100 + 0.5);
    const classic = !ov && (style === 0 || style === 3);

    const key = `${Math.floor(cx / CHUNK)},${Math.floor(cz / CHUNK)}`;
    let gb = chunks.get(key);
    if (!gb) chunks.set(key, (gb = new GeoBuilder()));
    let tr = trims.get(key);
    if (!tr) trims.set(key, (tr = { pos: [], nor: [], col: [] }));
    const T = tr;
    const quad = (pts: number[][], nx: number, ny: number, nz: number, c: THREE.Color) => {
      for (const k of [0, 1, 2, 0, 2, 3]) {
        T.pos.push(pts[k][0], pts[k][1], pts[k][2]);
        T.nor.push(nx, ny, nz);
        T.col.push(c.r, c.g, c.b);
      }
    };

    const rings = [b.pts, ...(b.holes ?? [])];
    rings.forEach((ring, ri) => {
      const m = ring.length / 2;
      const area = ringArea(ring);
      // Con área > 0, la normal (dz, -dx) apunta hacia fuera del anillo; en los patios queremos lo contrario
      const flip = (area > 0) === (ri === 0) ? 1 : -1;
      let u = 0;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const nx = ((bz - az) / len) * flip, nz = (-(bx - ax) / len) * flip;
        const forward = (bx - ax) * nz - (bz - az) * nx > 0;
        const [p0x, p0z, p1x, p1z, u0, u1] = forward ? [ax, az, bx, bz, u, u + len] : [bx, bz, ax, az, u + len, u];
        const vb = bottom - ground, vt = top - ground;
        gb!.vert(p0x, bottom, p0z, nx, 0, nz, u0, vb, wallCol, info);
        gb!.vert(p1x, bottom, p1z, nx, 0, nz, u1, vb, wallCol, info);
        gb!.vert(p1x, top, p1z, nx, 0, nz, u1, vt, wallCol, info);
        gb!.vert(p0x, bottom, p0z, nx, 0, nz, u0, vb, wallCol, info);
        gb!.vert(p1x, top, p1z, nx, 0, nz, u1, vt, wallCol, info);
        gb!.vert(p0x, top, p0z, nx, 0, nz, u0, vt, wallCol, info);
        collision.addSeg(ax, az, bx, bz, top, b.mh > 2.5 ? bottom : undefined);

        // ¿Fachada vista o medianera? (otro edificio pegado delante)
        if (ri === 0 && len > 2.5 && b.mh < 0.5) {
          const mx = (ax + bx) / 2 + nx * 0.7, mz = (az + bz) / 2 + nz * 0.7;
          const other = foot.topAt(mx, mz, idx);
          const visibleFrom = other > -Infinity ? other : -Infinity; // altura hasta la que está tapada
          const exposed = visibleFrom < top - 2;
          if (exposed && classic) {
            const P = (x: number, z: number, y: number, o: number) => [x + nx * o, y, z + nz * o];
            const ex = ((bx - ax) / len) * 0.3, ez = ((bz - az) / len) * 0.3; // prolongar en las esquinas
            const A = [ax - ex, az - ez], B = [bx + ex, bz + ez];
            const ord = (q: number[][]) => (forward ? q : [q[1], q[0], q[3], q[2]]);
            // Cornisa: frente, vuelo inferior y albardilla
            const y1 = top, y0 = top - 0.55, o = 0.38;
            quad(ord([P(A[0], A[1], y0, o), P(B[0], B[1], y0, o), P(B[0], B[1], y1, o), P(A[0], A[1], y1, o)]), nx, 0, nz, trimCol);
            quad(ord([P(B[0], B[1], y0, 0), P(A[0], A[1], y0, 0), P(A[0], A[1], y0, o), P(B[0], B[1], y0, o)]), 0, -1, 0, trimCol);
            quad(ord([P(A[0], A[1], y1, o), P(B[0], B[1], y1, o), P(B[0], B[1], y1 + 0.02, 0), P(A[0], A[1], y1 + 0.02, 0)]), 0, 1, 0, trimCol);
            // Moldura bajo la cornisa
            quad(ord([P(A[0], A[1], y0 - 0.3, 0.16), P(B[0], B[1], y0 - 0.3, 0.16), P(B[0], B[1], y0, 0.16), P(A[0], A[1], y0, 0.16)]), nx, 0, nz, trimCol);
            // Zócalo de granito
            if (visibleFrom < ground + 2) {
              const zt = ground + 0.9;
              quad(ord([P(ax, az, gmin - 0.4, 0.07), P(bx, bz, gmin - 0.4, 0.07), P(bx, bz, zt, 0.07), P(ax, az, zt, 0.07)]), nx, 0, nz, plinthCol);
              quad(ord([P(bx, bz, zt, 0), P(ax, az, zt, 0), P(ax, az, zt, 0.07), P(bx, bz, zt, 0.07)]), 0, 1, 0, plinthCol);
              // Imposta sobre los bajos comerciales
              if (top - ground > 8) {
                const iy = ground + 4.05;
                quad(ord([P(ax, az, iy, 0.14), P(bx, bz, iy, 0.14), P(bx, bz, iy + 0.22, 0.14), P(ax, az, iy + 0.22, 0.14)]), nx, 0, nz, trimCol);
                quad(ord([P(bx, bz, iy + 0.22, 0), P(ax, az, iy + 0.22, 0), P(ax, az, iy + 0.22, 0.14), P(bx, bz, iy + 0.22, 0.14)]), 0, 1, 0, trimCol);
              }
            }
            facades.push({ ax, az, bx, bz, nx, nz, len, u0: forward ? u : u, ground, top, seed: shaderSeed, style });
          } else if (exposed && (style === 5 || style === 3 || style === 0)) {
            // fachadas con bajos comerciales pero sin molduras propias: solo para rótulos y escaparates
            facades.push({ ax, az, bx, bz, nx, nz, len, u0: forward ? u : u, ground, top, seed: shaderSeed, style, noBalconies: true });
          }
        }
        u += len;
      }
    });

    // Cubierta (triangulada con patios)
    const contour = [] as THREE.Vector2[];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(b.pts[i * 2], b.pts[i * 2 + 1]));
    const holes = (b.holes ?? []).map((h) => {
      const arr: THREE.Vector2[] = [];
      for (let i = 0; i < h.length; i += 2) arr.push(new THREE.Vector2(h[i], h[i + 1]));
      return arr;
    });
    const all = contour.concat(...holes);
    let faces: number[][] = [];
    try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { faces = []; }
    for (const f of faces) {
      const [a, b2, c] = f.map((k) => all[k]);
      if (!a || !b2 || !c) continue;
      const crossY = (b2.y - a.y) * (c.x - a.x) - (b2.x - a.x) * (c.y - a.y);
      const tri = crossY > 0 ? [a, b2, c] : [a, c, b2];
      for (const p of tri) gb.vert(p.x, top, p.y, 0, 1, 0, p.x, p.y, roofCol, info);
    }
    if (!ov && p0.area > 40 && b.h < 60) roofSpots.push({ x: cx, z: cz, y: top, tile: tileRoof, area: p0.area, seed, pts: b.pts });

    placed.push({ data: b, ground, top, cx, cz });

    mctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = (b.pts[i * 2] - mx0) * ms, pz = (b.pts[i * 2 + 1] - mz0) * ms;
      if (i === 0) mctx.moveTo(px, pz); else mctx.lineTo(px, pz);
    }
    mctx.closePath();
    mctx.fill();
  });

  for (const gb of chunks.values()) {
    const mesh = new THREE.Mesh(gb.build(), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  for (const t of trims.values()) {
    if (!t.pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, trimMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, placed, specials, facades, roofSpots };
}

export { pointInRing };
