import * as THREE from 'three';
import type { WorldData } from './realData';

/*
 * Pavimentos de Madrid, generados proceduralmente en color:
 *   - Acera: baldosa hidráulica gris de 20 × 20 cm con 4 pastillas (la de toda la vida).
 *   - Plazas y calles peatonales anchas: losas de granito gris (berroqueño) a matajunta.
 *   - Casco histórico y calles de coexistencia: adoquín de granito en hileras.
 *   - Paseos de parques: albero / tierra; zonas verdes: césped.
 * Cada textura cubre un número entero de piezas para repetirse sin costuras.
 */

export const MAT_ID = { baldosa: 0, granito: 1, adoquin: 2, cesped: 3, tierra: 4, agua: 5 } as const;
/** Metros que cubre cada textura (para las UV en coordenadas de mundo). */
export const TEX_SIZE = { baldosa: 1.6, granito: 2.4, adoquin: 1.2, cesped: 2.2, tierra: 4 };

let seed = 1234;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function canvas(n: number) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return { c, g: c.getContext('2d')! };
}
/** Resolución contenida (estética retro): se dibuja con detalle y se reduce a 1/4, filtrado sin suavizar de cerca. */
function finish(src: HTMLCanvasElement) {
  const c = document.createElement('canvas');
  c.width = c.height = Math.max(64, src.width / 4);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function speckle(g: CanvasRenderingContext2D, n: number, count: number, cols: string[], size = 1.6) {
  for (let k = 0; k < count; k++) {
    g.fillStyle = cols[Math.floor(rnd() * cols.length)];
    g.fillRect(rnd() * n, rnd() * n, 0.6 + rnd() * size, 0.6 + rnd() * size);
  }
}

/** Baldosa de 4 pastillas, 20 × 20 cm: 8 × 8 piezas en 1,6 m. */
function baldosa() {
  const N = 1024, P = 8, S = N / P;
  const { c, g } = canvas(N);
  g.fillStyle = '#5c5b58'; // junta
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) {
    const x = i * S, y = j * S;
    const v = 150 + rnd() * 22, warm = rnd() * 6;
    g.fillStyle = `rgb(${v + 10 + warm},${v + 6 + warm * 0.6},${v - 2})`;
    g.fillRect(x + 2, y + 2, S - 4, S - 4);
    // canto ligeramente achaflanado
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x + 2, y + 2, S - 4, 3); g.fillRect(x + 2, y + 2, 3, S - 4);
    g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x + 2, y + S - 5, S - 4, 3); g.fillRect(x + S - 5, y + 2, 3, S - 4);
    // 4 pastillas (2 × 2) en relieve, con luz arriba-izquierda
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const cx = x + S * (0.29 + a * 0.42), cy = y + S * (0.29 + b * 0.42), r = S * 0.17;
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.arc(cx + 2.5, cy + 2.5, r, 0, Math.PI * 2); g.fill();
      const grd = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
      grd.addColorStop(0, `rgb(${v + 26},${v + 25},${v + 22})`);
      grd.addColorStop(1, `rgb(${v - 8},${v - 8},${v - 10})`);
      g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }
  }
  speckle(g, N, 26000, ['rgba(40,40,40,0.25)', 'rgba(230,230,225,0.25)', 'rgba(110,100,90,0.2)'], 2);
  // chicles, manchas y desgaste
  for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(35,33,30,${0.25 + rnd() * 0.3})`; g.beginPath(); g.arc(rnd() * N, rnd() * N, 2 + rnd() * 4, 0, Math.PI * 2); g.fill(); }
  for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(60,55,45,${0.05 + rnd() * 0.07})`; g.beginPath(); g.ellipse(rnd() * N, rnd() * N, 30 + rnd() * 90, 20 + rnd() * 60, rnd() * 3, 0, Math.PI * 2); g.fill(); }
  // alguna baldosa rota
  for (let k = 0; k < 3; k++) {
    const x = Math.floor(rnd() * P) * S, y = Math.floor(rnd() * P) * S;
    g.strokeStyle = 'rgba(30,30,30,0.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 4, y + rnd() * S); g.lineTo(x + S * 0.5, y + S * 0.5); g.lineTo(x + S - 4, y + rnd() * S); g.stroke();
  }
  return finish(c);
}

/** Losas de granito gris de 60 × 40 cm a matajunta: 4 × 6 piezas en 2,4 m. */
function granito() {
  const N = 1024, W = N / 4, H = N / 6;
  const { c, g } = canvas(N);
  g.fillStyle = '#6d6a64'; g.fillRect(0, 0, N, N);
  for (let r = 0; r < 6; r++) {
    const off = r % 2 ? W / 2 : 0;
    for (let k = -1; k < 5; k++) {
      const x = k * W + off, y = r * H;
      const v = 168 + rnd() * 20;
      g.fillStyle = `rgb(${v + 4},${v + 1},${v - 4})`;
      g.fillRect(x + 2, y + 2, W - 4, H - 4);
    }
  }
  // grano del granito: mica negra, feldespato blanco y algo rosado
  speckle(g, N, 90000, ['rgba(30,30,32,0.55)', 'rgba(250,250,245,0.45)', 'rgba(180,150,140,0.35)', 'rgba(90,90,95,0.4)'], 2.2);
  for (let k = 0; k < 8; k++) { g.fillStyle = `rgba(50,45,40,${0.04 + rnd() * 0.06})`; g.beginPath(); g.ellipse(rnd() * N, rnd() * N, 40 + rnd() * 120, 30 + rnd() * 80, rnd() * 3, 0, Math.PI * 2); g.fill(); }
  return finish(c);
}

/** Adoquín de granito de 10 × 20 cm en hileras a matajunta: 6 × 12 piezas en 1,2 m. */
function adoquin() {
  const N = 1024, cols = 6, rows = 12, W = N / cols, H = N / rows;
  const { c, g } = canvas(N);
  g.fillStyle = '#4a463f'; g.fillRect(0, 0, N, N); // junta de arena
  speckle(g, N, 20000, ['rgba(120,110,95,0.5)', 'rgba(40,38,34,0.5)'], 2);
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? W / 2 : 0;
    for (let k = -1; k <= cols; k++) {
      const x = k * W + off + (rnd() - 0.5) * 4, y = r * H + (rnd() - 0.5) * 3;
      const pink = rnd() < 0.3;
      const v = 120 + rnd() * 45;
      const base = pink ? `rgb(${v + 18},${v + 4},${v - 2})` : `rgb(${v},${v - 1},${v - 5})`;
      const w = W - 7 - rnd() * 4, h = H - 7 - rnd() * 3;
      // canto redondeado y pulido por el uso: más claro arriba
      g.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(g, x + 5, y + 5, w, h, 9); g.fill();
      const grd = g.createLinearGradient(x, y, x + w * 0.4, y + h);
      grd.addColorStop(0, `rgba(255,255,255,0.18)`);
      grd.addColorStop(1, `rgba(0,0,0,0.12)`);
      g.fillStyle = base; roundRect(g, x + 3, y + 3, w, h, 9); g.fill();
      g.fillStyle = grd; roundRect(g, x + 3, y + 3, w, h, 9); g.fill();
    }
  }
  speckle(g, N, 50000, ['rgba(25,25,25,0.35)', 'rgba(240,235,230,0.3)'], 1.8);
  return finish(c);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function cesped() {
  const N = 512;
  const { c, g } = canvas(N);
  g.fillStyle = '#6f9a45'; g.fillRect(0, 0, N, N);
  for (let k = 0; k < 26000; k++) {
    const hue = 80 + rnd() * 30, l = 22 + rnd() * 28;
    g.strokeStyle = `hsla(${hue},45%,${l}%,0.75)`;
    g.lineWidth = 1;
    const x = rnd() * N, y = rnd() * N, len = 3 + rnd() * 7, a = -Math.PI / 2 + (rnd() - 0.5) * 1.3;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }
  for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(150,140,70,${0.05 + rnd() * 0.08})`; g.beginPath(); g.arc(rnd() * N, rnd() * N, 10 + rnd() * 35, 0, Math.PI * 2); g.fill(); }
  // margaritas y tréboles
  for (let k = 0; k < 60; k++) { g.fillStyle = rnd() < 0.7 ? 'rgba(250,250,240,0.8)' : 'rgba(240,210,60,0.8)'; g.fillRect(rnd() * N, rnd() * N, 2, 2); }
  return finish(c);
}

function tierra() {
  const N = 512;
  const { c, g } = canvas(N);
  g.fillStyle = '#c4ad82'; g.fillRect(0, 0, N, N); // albero / arena de los paseos
  speckle(g, N, 30000, ['rgba(120,95,60,0.4)', 'rgba(235,220,190,0.45)', 'rgba(90,75,55,0.35)'], 2.5);
  for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(110,90,60,${0.06 + rnd() * 0.08})`; g.beginPath(); g.ellipse(rnd() * N, rnd() * N, 12 + rnd() * 40, 3 + rnd() * 8, rnd() * 3, 0, Math.PI * 2); g.fill(); }
  for (let k = 0; k < 200; k++) { g.fillStyle = 'rgba(150,140,125,0.8)'; g.beginPath(); g.arc(rnd() * N, rnd() * N, 1 + rnd() * 2.5, 0, Math.PI * 2); g.fill(); } // chinos
  return finish(c);
}

let cache: Record<'baldosa' | 'granito' | 'adoquin' | 'cesped' | 'tierra', THREE.Texture> | null = null;
export function pavingTextures() {
  if (!cache) cache = { baldosa: baldosa(), granito: granito(), adoquin: adoquin(), cesped: cesped(), tierra: tierra() };
  return cache;
}

/** Pinta el mapa de materiales (canal rojo = id × 40) de un trozo de suelo. */
export function paintMaterialMap(ctx: CanvasRenderingContext2D, data: WorldData, ox: number, oz: number, s: number) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const id = (k: number) => `rgb(${k * 40},0,0)`;
  ctx.fillStyle = id(MAT_ID.baldosa);
  ctx.fillRect(0, 0, W, H);
  const ring = (pts: number[]) => {
    for (let i = 0; i < pts.length; i += 2) {
      const px = (pts[i] - ox) * s, pz = (pts[i + 1] - oz) * s;
      if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
    }
    ctx.closePath();
  };
  const x1 = ox + W / s, z1 = oz + H / s;
  const visible = (pts: number[]) => {
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      xmin = Math.min(xmin, pts[i]); xmax = Math.max(xmax, pts[i]);
      zmin = Math.min(zmin, pts[i + 1]); zmax = Math.max(zmax, pts[i + 1]);
    }
    return xmin < x1 + 20 && xmax > ox - 20 && zmin < z1 + 20 && zmax > oz - 20;
  };
  const areaId: Record<string, number> = { plaza: MAT_ID.granito, grass: MAT_ID.cesped, wood: MAT_ID.cesped, pitch: MAT_ID.cesped, water: MAT_ID.agua, parking: MAT_ID.adoquin, rail: MAT_ID.tierra };
  for (const kind of ['parking', 'rail', 'plaza', 'grass', 'wood', 'pitch', 'water']) {
    ctx.fillStyle = id(areaId[kind]);
    for (const a of data.areas) {
      if (a.kind !== kind || (a.layer ?? 0) < 0 || !visible(a.pts)) continue;
      ctx.beginPath(); ring(a.pts); for (const h of a.holes ?? []) ring(h); ctx.fill('evenodd');
    }
  }
  // Calles peatonales y de coexistencia: adoquín; caminos de parque: tierra; aceras sueltas: baldosa
  const N = data.roadNodes;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const r of data.roads) {
    let k: number | null = null;
    if (r.hw === 'pedestrian' || r.hw === 'living_street') k = r.w >= 10 ? MAT_ID.granito : MAT_ID.adoquin;
    else if (r.hw === 'path' || r.hw === 'track') k = MAT_ID.tierra;
    else if (r.hw === 'footway' || r.hw === 'steps') k = MAT_ID.baldosa;
    if (k === null || r.br) continue;
    const pts: number[] = [];
    for (const n of r.n) pts.push(N[n * 2], N[n * 2 + 1]);
    if (!visible(pts)) continue;
    ctx.strokeStyle = id(k);
    ctx.lineWidth = Math.max(1, r.w * s);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const px = (pts[i] - ox) * s, pz = (pts[i + 1] - oz) * s;
      if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
    }
    ctx.stroke();
  }
}
