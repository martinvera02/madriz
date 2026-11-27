// Descarga los datos reales de una zona de Madrid y los convierte al formato del juego.
//
//   node tools/fetch-data.mjs            (zona por defecto: centro)
//   node tools/fetch-data.mjs centro
//   node tools/fetch-data.mjs centro --terrarium   (relieve global de menor resolución)
//
// Fuentes:
//   - Calles, edificios, parques, agua, árboles y farolas: OpenStreetMap (API 0.6), © colaboradores de OSM, ODbL.
//   - Relieve: MDT05 (LiDAR, 5 m) del Instituto Geográfico Nacional vía WCS (CC BY 4.0);
//     con --terrarium, teselas "terrarium" de elevation-tiles-prod (Mapzen/AWS Open Data).
// Salida: public/data/<zona>.json y public/data/<zona>-terrain.png

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

// Origen de coordenadas: Kilómetro Cero (Puerta del Sol). X = este, Z = sur (norte = -Z), 1 unidad = 1 m.
const ORIGIN = { lat: 40.41669, lon: -3.70358 };
// Cada zona es uno o varios rectángulos (lat/lon). Los datos se recortan a la unión; el relieve cubre el
// rectángulo que la envuelve.
const CENTRO = { s: 40.4020, n: 40.4305, w: -3.7265, e: -3.6795 };
// del límite norte del centro (Sagasta, Alberto Aguilera) a Plaza de Castilla, las Cuatro Torres y Chamartín
const NORTE = { s: 40.4305, n: 40.4855, w: -3.7130, e: -3.6700 };
const ZONES = {
  centro: [CENTRO],
  madrid: [CENTRO, NORTE],
};

const zoneName = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'madrid';
const ZB = ZONES[zoneName];
if (!ZB) throw new Error('Zona desconocida: ' + zoneName);
/** Rectángulo que envuelve la zona. */
const Z = { s: Math.min(...ZB.map((b) => b.s)), n: Math.max(...ZB.map((b) => b.n)), w: Math.min(...ZB.map((b) => b.w)), e: Math.max(...ZB.map((b) => b.e)) };

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, 'tools', 'cache');
const OUT = path.join(ROOT, 'public', 'data');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const M_LAT = 111132.954 - 559.822 * Math.cos(2 * ORIGIN.lat * Math.PI / 180);
const M_LON = 111412.84 * Math.cos(ORIGIN.lat * Math.PI / 180);
const toX = (lon) => (lon - ORIGIN.lon) * M_LON;
const toZ = (lat) => -(lat - ORIGIN.lat) * M_LAT;
const r1 = (v) => Math.round(v * 10) / 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, file, binary = false) {
  if (fs.existsSync(file)) return binary ? fs.readFileSync(file) : fs.readFileSync(file, 'utf8');
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'madriz-game-prototype/0.2 (data fetch script)' } });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
      return binary ? buf : buf.toString('utf8');
    }
    console.warn(`  ${res.status} en ${url}, reintento…`);
    await sleep(3000 * (attempt + 1));
  }
  throw new Error('No se pudo descargar ' + url);
}

// ---------------------------------------------------------------- OSM
const STEP = 0.006;
const nodes = new Map(); // id -> [lat, lon, tags?]
const ways = new Map(); // id -> { nds, tags }
const rels = new Map(); // id -> { members, tags }

function parseTags(body) {
  const tags = {};
  for (const m of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\/>/g)) tags[m[1]] = decode(m[2]);
  return tags;
}
function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseOsm(xml) {
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"[^>]*?(\/>|>([\s\S]*?)<\/node>)/g)) {
    const id = m[1];
    if (nodes.has(id)) continue;
    const tags = m[5] ? parseTags(m[5]) : null;
    nodes.set(id, [Number(m[2]), Number(m[3]), tags]);
  }
  for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    if (ways.has(m[1])) continue;
    const nds = [...m[2].matchAll(/<nd ref="(\d+)"\/>/g)].map((x) => x[1]);
    ways.set(m[1], { nds, tags: parseTags(m[2]) });
  }
  for (const m of xml.matchAll(/<relation id="(\d+)"[^>]*>([\s\S]*?)<\/relation>/g)) {
    if (rels.has(m[1])) continue;
    const members = [...m[2].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"\/>/g)].map((x) => ({ type: x[1], ref: x[2], role: x[3] }));
    rels.set(m[1], { members, tags: parseTags(m[2]) });
  }
}

console.log(`Descargando OSM para "${zoneName}"…`);
const cells = [];
for (const B of ZB) for (let lat = B.s; lat < B.n - 1e-9; lat += STEP) for (let lon = B.w; lon < B.e - 1e-9; lon += STEP) cells.push([lon, lat, B]);
let k = 0;
for (const [lon, lat, B] of cells) {
  const bbox = [lon, lat, Math.min(lon + STEP, B.e), Math.min(lat + STEP, B.n)].map((v) => v.toFixed(5)).join(',');
  const file = path.join(CACHE, `osm_${bbox.replace(/,/g, '_')}.osm`);
  const cached = fs.existsSync(file);
  const xml = await get(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, file);
  parseOsm(xml);
  k++;
  process.stdout.write(`\r  ${k}/${cells.length} celdas`);
  if (!cached) await sleep(800);
}
console.log(`\n  ${nodes.size} nodos, ${ways.size} vías, ${rels.size} relaciones`);

// Relaciones multipolígono incompletas: completar las vías que falten
const missingWays = new Set();
for (const r of rels.values()) {
  if (r.tags.type !== 'multipolygon') continue;
  if (!(r.tags.building || r.tags['building:part'] || r.tags.leisure || r.tags.landuse || r.tags.natural || r.tags.water || r.tags.place || r.tags.highway)) continue;
  for (const m of r.members) if (m.type === 'way' && !ways.has(m.ref)) missingWays.add(m.ref);
}
if (missingWays.size) {
  console.log(`  Completando ${missingWays.size} vías de multipolígonos…`);
  const ids = [...missingWays];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const file = path.join(CACHE, `ways_${chunk[0]}_${chunk.length}.osm`);
    const xml = await get(`https://api.openstreetmap.org/api/0.6/ways?ways=${chunk.join(',')}`, file);
    parseOsm(xml);
    const ndIds = new Set();
    for (const id of chunk) for (const nd of ways.get(id)?.nds ?? []) if (!nodes.has(nd)) ndIds.add(nd);
    const nl = [...ndIds];
    for (let j = 0; j < nl.length; j += 300) {
      const c2 = nl.slice(j, j + 300);
      const f2 = path.join(CACHE, `nodes_${c2[0]}_${c2.length}.osm`);
      parseOsm(await get(`https://api.openstreetmap.org/api/0.6/nodes?nodes=${c2.join(',')}`, f2));
    }
  }
}

// ---------------------------------------------------------------- Conversión
const BX = { x0: toX(Z.w), x1: toX(Z.e), z0: toZ(Z.n), z1: toZ(Z.s) };
/** Rectángulos de la zona en metros. */
const BOXES = ZB.map((b) => ({ x0: toX(b.w), x1: toX(b.e), z0: toZ(b.n), z1: toZ(b.s) }));
const inBox = (x, z, pad = 0) => BOXES.some((B) => x >= B.x0 - pad && x <= B.x1 + pad && z >= B.z0 - pad && z <= B.z1 + pad);

function wayPts(nds) {
  const out = [];
  for (const id of nds) {
    const n = nodes.get(id);
    if (!n) return null;
    out.push(r1(toX(n[1])), r1(toZ(n[0])));
  }
  return out;
}
function anyInBox(pts, pad = 0) {
  for (let i = 0; i < pts.length; i += 2) if (inBox(pts[i], pts[i + 1], pad)) return true;
  return false;
}
function ringArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return a / 2;
}
function closeRing(pts) {
  // quitar el último punto si repite el primero
  const n = pts.length;
  if (n >= 4 && pts[0] === pts[n - 2] && pts[1] === pts[n - 1]) return pts.slice(0, n - 2);
  return pts;
}
/** Une segmentos de vías en anillos cerrados (para multipolígonos). */
function assembleRings(wayIds) {
  const segs = wayIds.map((id) => ways.get(id)?.nds).filter(Boolean).map((a) => [...a]);
  const rings = [];
  while (segs.length) {
    let ring = segs.shift();
    let changed = true;
    while (ring[0] !== ring[ring.length - 1] && changed) {
      changed = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = ring[ring.length - 1];
        if (s[0] === end) { ring = ring.concat(s.slice(1)); }
        else if (s[s.length - 1] === end) { ring = ring.concat(s.slice(0, -1).reverse()); }
        else continue;
        segs.splice(i, 1);
        changed = true;
        break;
      }
    }
    if (ring[0] === ring[ring.length - 1] && ring.length >= 4) rings.push(ring);
  }
  return rings;
}
function pointInRing(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length / 2 - 1; i < pts.length / 2; j = i++) {
    const xi = pts[i * 2], zi = pts[i * 2 + 1], xj = pts[j * 2], zj = pts[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function centroid(pts) {
  let x = 0, z = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) { x += pts[i * 2]; z += pts[i * 2 + 1]; }
  return [x / n, z / n];
}

const num = (v) => {
  if (v == null) return undefined;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

// ---- Polígonos (edificios y áreas), desde vías cerradas y multipolígonos
const polys = []; // { id, tags, outer: pts, holes: [pts] }
const usedAsMember = new Set();
for (const [id, r] of rels) {
  if (r.tags.type !== 'multipolygon') continue;
  const outers = assembleRings(r.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => m.ref));
  const inners = assembleRings(r.members.filter((m) => m.type === 'way' && m.role === 'inner').map((m) => m.ref));
  const innerPts = inners.map((ring) => wayPts(ring)).filter(Boolean).map(closeRing);
  for (const ring of outers) {
    const pts = wayPts(ring);
    if (!pts) continue;
    const outer = closeRing(pts);
    const holes = innerPts.filter((h) => pointInRing(h[0], h[1], outer));
    polys.push({ id: 'r' + id, tags: r.tags, outer, holes });
  }
  // Las vías miembro sin etiquetas propias no se dibujan aparte
  for (const m of r.members) if (m.type === 'way') usedAsMember.add(m.ref);
}
for (const [id, w] of ways) {
  if (w.nds.length < 4 || w.nds[0] !== w.nds[w.nds.length - 1]) continue;
  const t = w.tags;
  const isArea = t.building || t['building:part'] || t.leisure || t.landuse || t.natural || t.water || t.waterway === 'riverbank' ||
    t.amenity === 'parking' || t.place === 'square' || (t.highway && t.area === 'yes') || t['area:highway'] || t.man_made === 'bridge';
  if (!isArea) continue;
  if (usedAsMember.has(id) && Object.keys(t).length <= 1) continue;
  const pts = wayPts(w.nds);
  if (!pts) continue;
  polys.push({ id: 'w' + id, tags: t, outer: closeRing(pts), holes: [] });
}

// ---- Edificios (Catastro: el contorno lleva building=* y las alturas van en building:part)
const buildings = [];
const partPolys = polys.filter((p) => p.tags['building:part'] && p.tags['building:part'] !== 'no' && anyInBox(p.outer, 50));
const bldPolys = polys.filter((p) => p.tags.building && p.tags.building !== 'no' && !p.tags['building:part'] && anyInBox(p.outer, 50));

// Índice espacial simple de partes para saber qué edificios tienen partes
const partCentroids = partPolys.map((p) => centroid(p.outer));
const cellKey = (x, z) => `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
const partGrid = new Map();
partCentroids.forEach((c, i) => {
  const key = cellKey(c[0], c[1]);
  if (!partGrid.has(key)) partGrid.set(key, []);
  partGrid.get(key).push(i);
});
function partsInside(outer) {
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < outer.length; i += 2) {
    xmin = Math.min(xmin, outer[i]); xmax = Math.max(xmax, outer[i]);
    zmin = Math.min(zmin, outer[i + 1]); zmax = Math.max(zmax, outer[i + 1]);
  }
  const res = [];
  for (let cx = Math.floor(xmin / 50); cx <= Math.floor(xmax / 50); cx++) {
    for (let cz = Math.floor(zmin / 50); cz <= Math.floor(zmax / 50); cz++) {
      for (const i of partGrid.get(`${cx},${cz}`) ?? []) {
        const c = partCentroids[i];
        if (pointInRing(c[0], c[1], outer)) res.push(i);
      }
    }
  }
  return res;
}

function heightOf(t, fallbackLevels) {
  let h = num(t.height);
  const lv = num(t['building:levels']);
  const roofLv = num(t['roof:levels']) ?? 0;
  if (h === undefined) h = lv !== undefined ? lv * 3.3 + roofLv * 2.4 + (lv > 0 ? 1.0 : 0) : fallbackLevels * 3.3 + 1;
  let minH = num(t.min_height);
  const minLv = num(t['building:min_level']);
  if (minH === undefined && minLv !== undefined) minH = minLv * 3.3;
  return { h: Math.max(h, 0), minH: minH ?? 0, levels: lv, known: num(t.height) !== undefined || lv !== undefined };
}

const usedParts = new Set();
for (const b of bldPolys) {
  const parts = partsInside(b.outer);
  const t = b.tags;
  if (parts.length) {
    // Usamos las partes (alturas reales) y el contorno solo para nombre/identidad
    for (const i of parts) {
      if (usedParts.has(i)) continue;
      usedParts.add(i);
      const p = partPolys[i];
      const { h, minH, levels } = heightOf(p.tags, 4);
      if (h <= 0.5 && !levels) continue; // patios / sótanos
      buildings.push({ id: b.id, part: 1, h: r1(h), mh: r1(minH), pts: p.outer, holes: p.holes.length ? p.holes : undefined,
        name: t.name, kind: t.building, col: t['building:colour'] || p.tags['building:colour'] });
    }
  } else {
    const { h, minH, known } = heightOf(t, t.building === 'church' || t.building === 'cathedral' ? 6 : 5);
    buildings.push({ id: b.id, h: r1(h), mh: r1(minH), pts: b.outer, holes: b.holes.length ? b.holes : undefined,
      name: t.name, kind: t.building, col: t['building:colour'], est: known ? undefined : 1 });
  }
}
// Partes sueltas (sin contorno conocido dentro de la descarga)
partPolys.forEach((p, i) => {
  if (usedParts.has(i)) return;
  const { h, minH } = heightOf(p.tags, 4);
  if (h <= 0.5) return;
  buildings.push({ id: p.id, part: 1, h: r1(h), mh: r1(minH), pts: p.outer, holes: p.holes.length ? p.holes : undefined, col: p.tags['building:colour'] });
});
for (const b of buildings) for (const k of Object.keys(b)) if (b[k] === undefined) delete b[k];

// ---- Áreas
const areas = [];
function areaKind(t) {
  if (t.water || t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.leisure === 'swimming_pool') return 'water';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass' || t.landuse === 'recreation_ground' || t.landuse === 'village_green' ||
    t.landuse === 'flowerbed' || t.natural === 'grassland' || t.landuse === 'meadow') return 'grass';
  if (t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub') return 'wood';
  if (t.leisure === 'pitch' || t.leisure === 'playground' || t.leisure === 'sports_centre') return 'pitch';
  if (t.place === 'square' || (t.highway === 'pedestrian' && t.area === 'yes') || t['area:highway'] === 'pedestrian' || t['area:highway'] === 'footway') return 'plaza';
  if (t.amenity === 'parking') return 'parking';
  if (t.landuse === 'railway') return 'rail';
  return null;
}
for (const p of polys) {
  if (p.tags.building || p.tags['building:part']) continue;
  const kind = areaKind(p.tags);
  if (!kind || !anyInBox(p.outer, 100)) continue;
  if (Math.abs(ringArea(p.outer)) < 4) continue;
  areas.push({ kind, name: p.tags.name, pts: p.outer, holes: p.holes.length ? p.holes : undefined, layer: num(p.tags.layer) });
}
for (const a of areas) for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k];

// ---- Calles (grafo con nodos compartidos)
const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const WALK = new Set(['pedestrian', 'footway', 'path', 'steps', 'cycleway', 'track']);
const DEFAULT_W = {
  motorway: 22, trunk: 18, primary: 14, secondary: 11, tertiary: 9, unclassified: 7, residential: 7, living_street: 5.5,
  service: 4.5, pedestrian: 7, footway: 2.6, path: 2, steps: 3, cycleway: 2.2, track: 3,
  motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 6,
};
const roadNodeIndex = new Map();
const roadNodes = [];
const roads = [];
for (const [id, w] of ways) {
  const t = w.tags;
  const hw = t.highway;
  if (!hw || (!DRIVE.has(hw) && !WALK.has(hw)) || t.area === 'yes') continue;
  if (t.tunnel === 'yes' || t.tunnel === 'building_passage' || t.covered === 'yes' || num(t.layer) < 0) continue; // bajo tierra: fuera
  if (hw === 'service' && (t.service === 'parking_aisle' || t.access === 'private')) continue;
  const pts = wayPts(w.nds);
  if (!pts || !anyInBox(pts, 30)) continue;
  const idx = w.nds.map((nd, i) => {
    let k2 = roadNodeIndex.get(nd);
    if (k2 === undefined) { k2 = roadNodes.length / 2; roadNodeIndex.set(nd, k2); roadNodes.push(pts[i * 2], pts[i * 2 + 1]); }
    return k2;
  });
  const lanes = num(t.lanes);
  let width = num(t.width) ?? (lanes ? lanes * 3.2 + (DRIVE.has(hw) ? 1 : 0) : DEFAULT_W[hw]);
  if (t.oneway === 'yes' && !lanes && !num(t.width) && ['residential', 'tertiary', 'unclassified'].includes(hw)) width = Math.min(width, 6);
  let oneway = 0;
  if (t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || hw === 'motorway') oneway = 1;
  if (t.oneway === '-1') oneway = -1;
  roads.push({
    id: Number(id), name: t.name, hw, w: r1(width), lanes, ow: oneway || undefined,
    br: t.bridge && t.bridge !== 'no' ? 1 : undefined, layer: num(t.layer), car: DRIVE.has(hw) ? 1 : 0,
    n: idx,
  });
}
for (const r of roads) for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];

// ---- Pasos de peatones y semáforos sobre la red de calles (índices de roadNodes)
const crossings = [];
for (const [nd, k2] of roadNodeIndex) {
  const t = nodes.get(nd)?.[2];
  if (t && (t.highway === 'crossing' || t.crossing === 'zebra' || t.crossing === 'traffic_signals' || t.crossing === 'marked')) crossings.push(k2);
}

// ---- Nodos sueltos: árboles, farolas, semáforos, fuentes
const trees = [], lamps = [], signals = [];
// Mobiliario urbano: [tipo, x, z, …]  tipos: b banco, p papelera, o bolardo, s parada de bus, m boca de metro,
// f fuente de beber, c buzón, k bicimad, v máquina expendedora, t teléfono
const furniture = [];
const treeKind = []; // 0 frondoso, 1 conífera, 2 palmera (paralelo a trees)
for (const [, n] of nodes) {
  const t = n[2];
  if (!t) continue;
  const x = r1(toX(n[1])), z = r1(toZ(n[0]));
  if (!inBox(x, z)) continue;
  if (t.natural === 'tree') {
    trees.push(x, z);
    const g = t.genus ?? '';
    treeKind.push(t.leaf_type === 'needleleaved' || /Pinus|Cedrus|Cupressus|Taxus|Sequoia|Taxodium/.test(g) ? 1 : /Phoenix|Trachycarpus|Washingtonia/.test(g) ? 2 : 0);
  }
  else if (t.amenity === 'bench') furniture.push('b', x, z, r1(num(t.direction) ?? -1));
  else if (t.amenity === 'waste_basket') furniture.push('p', x, z, -1);
  else if (t.barrier === 'bollard') furniture.push('o', x, z, -1);
  else if (t.highway === 'bus_stop' && (t.shelter === 'yes' || t.bench === 'yes' || !t.shelter)) furniture.push('s', x, z, -1);
  else if (t.railway === 'subway_entrance') furniture.push('m', x, z, -1);
  else if (t.amenity === 'drinking_water') furniture.push('f', x, z, -1);
  else if (t.amenity === 'post_box') furniture.push('c', x, z, -1);
  else if (t.amenity === 'bicycle_rental') furniture.push('k', x, z, -1);
  else if (t.amenity === 'telephone') furniture.push('t', x, z, -1);
  else if (t.highway === 'street_lamp') lamps.push(x, z);
  else if (t.highway === 'traffic_signals') signals.push(x, z);
}

// ---- Setos (barrier=hedge) como polilíneas
const hedges = [];
for (const [, w] of ways) {
  if (w.tags.barrier !== 'hedge') continue;
  const pts = wayPts(w.nds);
  if (pts && anyInBox(pts)) hedges.push(pts);
}

// ---- Monumentos y puntos de interés con nombre (fuentes, estatuas, puertas…)
const pois = [];
const isPoi = (t) => t && t.name && (t.historic || t.amenity === 'fountain' || t.tourism === 'artwork' || t.man_made === 'tower' || t.tourism === 'attraction');
for (const [, n] of nodes) {
  const t = n[2];
  if (!isPoi(t)) continue;
  const x = r1(toX(n[1])), z = r1(toZ(n[0]));
  if (inBox(x, z)) pois.push({ name: t.name, kind: t.historic || t.amenity || t.tourism || t.man_made, x, z });
}
for (const [, w] of ways) {
  if (!isPoi(w.tags) || w.tags.building) continue;
  const pts = wayPts(w.nds);
  if (!pts) continue;
  const [x, z] = centroid(closeRing(pts));
  if (inBox(x, z)) pois.push({ name: w.tags.name, kind: w.tags.historic || w.tags.amenity || w.tags.tourism, x: r1(x), z: r1(z) });
}

// ---------------------------------------------------------------- Relieve
// Por defecto: MDT05 del IGN (LiDAR, paso de malla 5 m) vía su servicio WCS.
// Con --terrarium se usan las teselas globales de AWS (~30 m de origen), más suaves.
const USE_TERRARIUM = process.argv.includes('--terrarium');
let elevAt;
let SMOOTH = { passes: 3, r: 2 };
let RELIEF_ATTRIB = 'Relieve: Mapzen Terrain Tiles / AWS Open Data';

async function loadTerrarium() {
  const TZ = 15;
  const lon2tile = (lon) => ((lon + 180) / 360) * 2 ** TZ;
  const lat2tile = (lat) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** TZ;
  const tx0 = Math.floor(lon2tile(Z.w - 0.002)), tx1 = Math.floor(lon2tile(Z.e + 0.002));
  const ty0 = Math.floor(lat2tile(Z.n + 0.002)), ty1 = Math.floor(lat2tile(Z.s - 0.002));
  const tiles = new Map();
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
    const file = path.join(CACHE, `terr_${TZ}_${tx}_${ty}.png`);
    const buf = await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TZ}/${tx}/${ty}.png`, file, true);
    tiles.set(`${tx},${ty}`, PNG.sync.read(buf));
  }
  return (lat, lon) => {
    const fx = lon2tile(lon), fy = lat2tile(lat);
    const px = (fx - Math.floor(fx)) * 256 - 0.5, py = (fy - Math.floor(fy)) * 256 - 0.5;
    const sample = (ix, iy) => {
      let tx = Math.floor(fx), ty = Math.floor(fy);
      if (ix < 0) { tx--; ix += 256; } if (ix > 255) { tx++; ix -= 256; }
      if (iy < 0) { ty--; iy += 256; } if (iy > 255) { ty++; iy -= 256; }
      const img = tiles.get(`${tx},${ty}`);
      if (!img) return 650;
      const o = (iy * 256 + ix) * 4;
      return img.data[o] * 256 + img.data[o + 1] + img.data[o + 2] / 256 - 32768;
    };
    const x0 = Math.floor(px), y0 = Math.floor(py), ax = px - x0, ay = py - y0;
    const a = sample(x0, y0), b = sample(x0 + 1, y0), c = sample(x0, y0 + 1), d = sample(x0 + 1, y0 + 1);
    return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
  };
}

/** MDT05 (IGN) en ETRS89 geográficas, pedido por trozos al WCS INSPIRE y leído como GeoTIFF Int16 (metros). */
async function loadIgnMdt05() {
  const { fromArrayBuffer } = await import('geotiff');
  const PADDEG = 0.002, DLAT = 0.01, DLON = 0.012;
  const tiles = [];
  const s0 = Z.s - PADDEG, n0 = Z.n + PADDEG, w0 = Z.w - PADDEG, e0 = Z.e + PADDEG;
  for (let lat = s0; lat < n0 - 1e-9; lat += DLAT) {
    for (let lon = w0; lon < e0 - 1e-9; lon += DLON) {
      // pequeño solape para que la interpolación no tenga costuras
      const S = lat - 0.0002, N = Math.min(lat + DLAT, n0) + 0.0002, W = lon - 0.0002, E = Math.min(lon + DLON, e0) + 0.0002;
      const key = [S, N, W, E].map((v) => v.toFixed(5)).join('_');
      const file = path.join(CACHE, `mdt05_${key}.tif`);
      const url = 'https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&CoverageId=Elevacion4258_5' +
        `&SUBSET=Lat(${S.toFixed(5)},${N.toFixed(5)})&SUBSET=Long(${W.toFixed(5)},${E.toFixed(5)})&FORMAT=image/tiff`;
      const cached = fs.existsSync(file);
      const buf = await get(url, file, true);
      if (buf.subarray(0, 2).toString() !== 'II' && buf.subarray(0, 2).toString() !== 'MM') {
        fs.unlinkSync(file);
        throw new Error('El WCS del IGN no devolvió un GeoTIFF: ' + buf.subarray(0, 200).toString());
      }
      const tif = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
      const img = await tif.getImage();
      const [bw, bs, be, bn] = img.getBoundingBox();
      const data = (await img.readRasters())[0];
      tiles.push({ w: bw, s: bs, e: be, n: bn, cols: img.getWidth(), rows: img.getHeight(), data });
      process.stdout.write(`\r  MDT05: ${tiles.length} trozos`);
      if (!cached) await sleep(300);
    }
  }
  console.log('');
  return (lat, lon) => {
    const t = tiles.find((q) => lat >= q.s && lat <= q.n && lon >= q.w && lon <= q.e);
    if (!t) return NaN;
    const px = ((lon - t.w) / (t.e - t.w)) * t.cols - 0.5;
    const py = ((t.n - lat) / (t.n - t.s)) * t.rows - 0.5;
    const cl = (v, m) => Math.max(0, Math.min(m - 1, v));
    const x0 = cl(Math.floor(px), t.cols), y0 = cl(Math.floor(py), t.rows);
    const x1 = cl(x0 + 1, t.cols), y1 = cl(y0 + 1, t.rows);
    const ax = Math.max(0, Math.min(1, px - x0)), ay = Math.max(0, Math.min(1, py - y0));
    const v = (x, y) => {
      const d = t.data[y * t.cols + x];
      return d < -1000 ? NaN : d;
    };
    return (v(x0, y0) * (1 - ax) + v(x1, y0) * ax) * (1 - ay) + (v(x0, y1) * (1 - ax) + v(x1, y1) * ax) * ay;
  };
}

console.log('Descargando relieve…');
if (!USE_TERRARIUM) {
  try {
    elevAt = await loadIgnMdt05();
    SMOOTH = { passes: 2, r: 1 }; // el MDT05 viene en metros enteros: suavizado ligero para quitar escalones
    RELIEF_ATTRIB = 'Relieve: MDT05 © Instituto Geográfico Nacional (CC BY 4.0)';
    console.log('  Fuente: MDT05 LiDAR del IGN (5 m)');
  } catch (err) {
    console.warn(`  No se pudo usar el MDT05 del IGN (${err.message}). Uso las teselas globales.`);
  }
}
if (!elevAt) elevAt = await loadTerrarium();

const RES = 4; // metros por celda del heightmap
const PAD = 60;
const tw = Math.ceil((BX.x1 - BX.x0 + PAD * 2) / RES) + 1;
const th = Math.ceil((BX.z1 - BX.z0 + PAD * 2) / RES) + 1;
let heights = new Float32Array(tw * th);
let hmin = Infinity, hmax = -Infinity;
for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
  const x = BX.x0 - PAD + i * RES, z = BX.z0 - PAD + j * RES;
  const lat = ORIGIN.lat - z / M_LAT, lon = ORIGIN.lon + x / M_LON;
  heights[j * tw + i] = elevAt(lat, lon);
}
// Huecos sin dato (fuera de cobertura): rellenar con la media de los vecinos válidos
for (let it = 0; it < 50; it++) {
  let holes = 0;
  for (let k = 0; k < heights.length; k++) {
    if (!Number.isNaN(heights[k])) continue;
    holes++;
    const i = k % tw, j = Math.floor(k / tw);
    let s2 = 0, c2 = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= tw || jj >= th) continue;
      const v = heights[jj * tw + ii];
      if (!Number.isNaN(v)) { s2 += v; c2++; }
    }
    if (c2) heights[k] = s2 / c2;
  }
  if (!holes) break;
}
// Suavizado (escalones de cuantización y ruido del muestreo)
for (let pass = 0; pass < SMOOTH.passes; pass++) {
  const src = heights, dst = new Float32Array(src.length);
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    let s = 0, c = 0;
    for (let dj = -SMOOTH.r; dj <= SMOOTH.r; dj++) for (let di = -SMOOTH.r; di <= SMOOTH.r; di++) {
      const ii = Math.min(tw - 1, Math.max(0, i + di)), jj = Math.min(th - 1, Math.max(0, j + dj));
      s += src[jj * tw + ii]; c++;
    }
    dst[j * tw + i] = s / c;
  }
  heights = dst;
}
for (const v of heights) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
const base = Math.floor(hmin);
const q = new Uint16Array(tw * th);
for (let i = 0; i < q.length; i++) q[i] = Math.round((heights[i] - base) * 100); // centímetros
// Relieve como PNG RGB sin pérdidas: R = byte alto, G = byte bajo (centímetros sobre la base)
const png = new PNG({ width: tw, height: th, colorType: 2, inputHasAlpha: false });
for (let i = 0; i < q.length; i++) {
  png.data[i * 4] = q[i] >> 8;
  png.data[i * 4 + 1] = q[i] & 255;
  png.data[i * 4 + 2] = 0;
  png.data[i * 4 + 3] = 255;
}
fs.writeFileSync(path.join(OUT, `${zoneName}-terrain.png`), PNG.sync.write(png, { colorType: 2 }));
const kmZero = elevAt(ORIGIN.lat, ORIGIN.lon);
console.log(`  Relieve ${tw}x${th} celdas, ${hmin.toFixed(1)}–${hmax.toFixed(1)} m (Sol: ${kmZero.toFixed(1)} m)`);

// ---------------------------------------------------------------- Salida
const out = {
  zone: zoneName,
  origin: ORIGIN,
  bounds: { x0: r1(BX.x0), x1: r1(BX.x1), z0: r1(BX.z0), z1: r1(BX.z1) },
  boxes: BOXES.map((B) => ({ x0: r1(B.x0), x1: r1(B.x1), z0: r1(B.z0), z1: r1(B.z1) })),
  terrain: { file: `${zoneName}-terrain.png`, w: tw, h: th, res: RES, x0: r1(BX.x0 - PAD), z0: r1(BX.z0 - PAD), base, scale: 0.01 },
  roadNodes,
  roads,
  buildings,
  areas,
  trees,
  lamps,
  signals,
  crossings,
  furniture,
  treeKind,
  hedges,
  pois,
  attribution: `© colaboradores de OpenStreetMap (ODbL) · ${RELIEF_ATTRIB}`,
};
fs.writeFileSync(path.join(OUT, `${zoneName}.json`), JSON.stringify(out));
const size = fs.statSync(path.join(OUT, `${zoneName}.json`)).size;
console.log(`Listo: ${roads.length} calles, ${buildings.length} edificios, ${areas.length} áreas, ${trees.length / 2} árboles, ${lamps.length / 2} farolas → ${(size / 1e6).toFixed(1)} MB`);
