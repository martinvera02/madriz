import * as THREE from 'three';
import type { WorldData, AreaKind } from './realData';
import { pavingTextures, paintMaterialMap, TEX_SIZE } from './paving';

/**
 * Relieve real (modelo digital de elevaciones) muestreado cada 4 m.
 * `heightAt` es la función de altura que usan TODOS: terreno, calles, edificios, coches y peatones.
 * Las alturas son relativas a `base` (el punto más bajo de la zona, en el Manzanares), en metros.
 */
export class Terrain {
  readonly w: number;
  readonly h: number;
  readonly res: number;
  readonly x0: number;
  readonly z0: number;
  readonly baseAltitude: number;
  private readonly hm: Float32Array;

  constructor(data: WorldData, raw: Uint16Array) {
    const t = data.terrain;
    this.w = t.w; this.h = t.h; this.res = t.res; this.x0 = t.x0; this.z0 = t.z0;
    this.baseAltitude = t.base;
    this.hm = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) this.hm[i] = raw[i] * t.scale;
  }

  heightAt(x: number, z: number): number {
    const fx = (x - this.x0) / this.res, fz = (z - this.z0) / this.res;
    const i = Math.max(0, Math.min(this.w - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(this.h - 2, Math.floor(fz)));
    const ax = Math.max(0, Math.min(1, fx - i)), az = Math.max(0, Math.min(1, fz - j));
    const k = j * this.w + i;
    const a = this.hm[k], b = this.hm[k + 1], c = this.hm[k + this.w], d = this.hm[k + this.w + 1];
    return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
  }

  /** Altitud real sobre el nivel del mar (para el HUD). */
  altitude(x: number, z: number) { return this.heightAt(x, z) + this.baseAltitude; }
}

// ------------------------------------------------------------------ Malla y textura del suelo

const TILE = 1024; // metros por trozo de terreno
const PX_PER_M = 1; // resolución de la textura del suelo

const AREA_COLORS: Record<AreaKind, string> = {
  grass: '#6a9442', wood: '#557c38', pitch: '#4f8f4a', plaza: '#a49b8a', parking: '#4a4a4c', water: '#2c5a70', rail: '#8a7f70',
};
const AREA_ORDER: AreaKind[] = ['parking', 'rail', 'plaza', 'grass', 'wood', 'pitch', 'water'];

export interface GroundResult { group: THREE.Group; minimap: HTMLCanvasElement; }

export function buildGround(data: WorldData, terrain: Terrain): GroundResult {
  const group = new THREE.Group();
  const { bounds } = data;
  const X0 = Math.floor(bounds.x0 / TILE) * TILE, Z0 = Math.floor(bounds.z0 / TILE) * TILE;
  const X1 = Math.ceil(bounds.x1 / TILE) * TILE, Z1 = Math.ceil(bounds.z1 / TILE) * TILE;

  // Minimapa: todo el mapa a 2 m/píxel
  const MM = 0.5;
  const minimap = document.createElement('canvas');
  minimap.width = Math.ceil((X1 - X0) * MM);
  minimap.height = Math.ceil((Z1 - Z0) * MM);
  const mctx = minimap.getContext('2d')!;
  paintGround(mctx, data, X0, Z0, MM, true);
  minimap.dataset.x0 = String(X0);
  minimap.dataset.z0 = String(Z0);
  minimap.dataset.scale = String(MM);

  const pav = pavingTextures();
  const mat = (tex: THREE.Texture, matTex: THREE.Texture) => {
    const mt = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 });
    // Pavimento real según el mapa de materiales (baldosa, granito, adoquín, césped, tierra) en coordenadas de mundo
    mt.onBeforeCompile = (sh) => {
      sh.uniforms.tMat = { value: matTex };
      sh.uniforms.tBaldosa = { value: pav.baldosa };
      sh.uniforms.tGranito = { value: pav.granito };
      sh.uniforms.tAdoquin = { value: pav.adoquin };
      sh.uniforms.tCesped = { value: pav.cesped };
      sh.uniforms.tTierra = { value: pav.tierra };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vGW;
          uniform sampler2D tMat, tBaldosa, tGranito, tAdoquin, tCesped, tTierra;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 base = diffuseColor.rgb;
          // bordes irregulares entre pavimentos en vez de escalones de píxel
          vec2 jit = (texture2D(tTierra, vGW.xz / 3.1).rg - 0.5) * (1.1 / ${TILE.toFixed(1)});
          float id = floor(texture2D(tMat, vMapUv + jit).r * 255.0 / 40.0 + 0.5);
          vec2 w = vGW.xz;
          vec3 col = base;
          if (id < 0.5) col = texture2D(tBaldosa, w / ${TEX_SIZE.baldosa.toFixed(2)}).rgb;
          else if (id < 1.5) col = texture2D(tGranito, w / ${TEX_SIZE.granito.toFixed(2)}).rgb;
          else if (id < 2.5) col = texture2D(tAdoquin, w / ${TEX_SIZE.adoquin.toFixed(2)}).rgb;
          else if (id < 3.5) col = texture2D(tCesped, w / ${TEX_SIZE.cesped.toFixed(2)}).rgb * mix(0.85, 1.15, texture2D(tTierra, w / 41.0).r);
          else if (id < 4.5) col = texture2D(tTierra, w / ${TEX_SIZE.tierra.toFixed(2)}).rgb;
          // suciedad a gran escala para romper la repetición
          float grime = texture2D(tTierra, w / 23.0).g * 0.5 + texture2D(tTierra, w / 71.0).b * 0.5;
          col *= mix(0.86, 1.06, grime);
          diffuseColor.rgb = (id > 4.5) ? base : col;`);
    };
    return mt;
  };
  for (let tz = Z0; tz < Z1; tz += TILE) {
    for (let tx = X0; tx < X1; tx += TILE) {
      const c = document.createElement('canvas');
      c.width = c.height = TILE * PX_PER_M;
      paintGround(c.getContext('2d')!, data, tx, tz, PX_PER_M, false);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const mc = document.createElement('canvas');
      mc.width = mc.height = TILE * PX_PER_M;
      paintMaterialMap(mc.getContext('2d')!, data, tx, tz, PX_PER_M);
      const matTex = new THREE.CanvasTexture(mc);
      matTex.magFilter = matTex.minFilter = THREE.NearestFilter;
      matTex.generateMipmaps = false;

      const seg = TILE / 4;
      const geo = new THREE.PlaneGeometry(TILE, TILE, seg, seg);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k) + tx + TILE / 2, z = pos.getZ(k) + tz + TILE / 2;
        pos.setXYZ(k, x, terrain.heightAt(x, z), z);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat(tex, matTex));
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // Terreno lejano (para que no se vea el borde del mundo)
  const far = new THREE.Mesh(
    new THREE.RingGeometry(2600, 12000, 8, 1),
    new THREE.MeshStandardMaterial({ color: 0xa8956c, roughness: 1 }),
  );
  far.rotation.x = -Math.PI / 2;
  far.position.set((bounds.x0 + bounds.x1) / 2, terrain.heightAt(0, 0) - 25, (bounds.z0 + bounds.z1) / 2);
  group.add(far);
  const skirt = new THREE.Mesh(
    new THREE.PlaneGeometry(X1 - X0 + 6000, Z1 - Z0 + 6000),
    new THREE.MeshStandardMaterial({ color: 0xa8956c, roughness: 1 }),
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.set((X0 + X1) / 2, -8, (Z0 + Z1) / 2);
  group.add(skirt);

  return { group, minimap };
}

/** Pinta suelo, zonas y calles en un canvas que cubre [ox, ox+W/s] × [oz, oz+H/s]. */
function paintGround(ctx: CanvasRenderingContext2D, data: WorldData, ox: number, oz: number, s: number, isMinimap: boolean) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const x1 = ox + W / s, z1 = oz + H / s;
  ctx.fillStyle = isMinimap ? '#9d968a' : '#8f897e'; // acera / pavimento urbano
  ctx.fillRect(0, 0, W, H);

  if (!isMinimap) {
    // Grano del pavimento
    let seed = (ox * 73856093) ^ (oz * 19349663);
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let k = 0; k < 9000; k++) {
      ctx.fillStyle = `rgba(${rnd() < 0.5 ? '90,85,75' : '230,225,215'},${0.05 + rnd() * 0.08})`;
      ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  }

  const visible = (pts: number[], pad = 30) => {
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] > ox - pad && pts[i] < x1 + pad && pts[i + 1] > oz - pad && pts[i + 1] < z1 + pad) return true;
    }
    // también si el polígono envuelve al trozo (p. ej. el Retiro)
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      xmin = Math.min(xmin, pts[i]); xmax = Math.max(xmax, pts[i]);
      zmin = Math.min(zmin, pts[i + 1]); zmax = Math.max(zmax, pts[i + 1]);
    }
    return xmin < x1 && xmax > ox && zmin < z1 && zmax > oz;
  };
  const ring = (pts: number[]) => {
    for (let i = 0; i < pts.length; i += 2) {
      const px = (pts[i] - ox) * s, pz = (pts[i + 1] - oz) * s;
      if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
    }
    ctx.closePath();
  };

  // Zonas
  for (const kind of AREA_ORDER) {
    ctx.fillStyle = AREA_COLORS[kind];
    for (const a of data.areas) {
      if (a.kind !== kind || (a.layer ?? 0) < 0 || !visible(a.pts)) continue;
      ctx.beginPath();
      ring(a.pts);
      for (const h of a.holes ?? []) ring(h);
      ctx.fill('evenodd');
      if (kind === 'plaza' && !isMinimap) {
        // Despiece de losas de granito
        ctx.save();
        ctx.clip('evenodd');
        ctx.strokeStyle = 'rgba(110,100,85,0.18)';
        ctx.lineWidth = 1;
        for (let gx = Math.floor(ox / 3) * 3; gx < x1; gx += 3) { ctx.beginPath(); ctx.moveTo((gx - ox) * s, 0); ctx.lineTo((gx - ox) * s, H); ctx.stroke(); }
        for (let gz = Math.floor(oz / 3) * 3; gz < z1; gz += 3) { ctx.beginPath(); ctx.moveTo(0, (gz - oz) * s); ctx.lineTo(W, (gz - oz) * s); ctx.stroke(); }
        ctx.restore();
      }
    }
  }

  // Calles: peatonales y caminos (en las de coches la cinta 3D va por encima)
  const N = data.roadNodes;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const order = ['path', 'track', 'cycleway', 'footway', 'steps', 'pedestrian', 'living_street', 'service', 'residential', 'unclassified',
    'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'trunk', 'trunk_link', 'motorway', 'motorway_link'];
  const color = (hw: string) => {
    if (hw === 'path' || hw === 'track') return isMinimap ? '#cdb88e' : '#b8a37c';
    if (hw === 'cycleway') return isMinimap ? '#b8a98f' : '#a3574b';
    if (hw === 'footway' || hw === 'steps') return isMinimap ? '#b6ae9f' : '#a19a8c';
    if (hw === 'pedestrian') return isMinimap ? '#c9bfa8' : '#a39a89';
    if (isMinimap) return hw === 'trunk' || hw === 'motorway' || hw === 'primary' ? '#f0d080' : '#ffffff';
    return '#3d3e41';
  };
  for (const hw of order) {
    ctx.strokeStyle = color(hw);
    for (const r of data.roads) {
      if (r.hw !== hw) continue;
      if (r.br && !isMinimap) continue; // los puentes van por encima: no se pintan en el suelo de debajo
      const pts: number[] = [];
      for (const n of r.n) pts.push(N[n * 2], N[n * 2 + 1]);
      if (!visible(pts, r.w)) continue;
      ctx.lineWidth = Math.max(isMinimap ? 1.5 : 1, r.w * s * (isMinimap && r.car ? 1.25 : 1));
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        const px = (pts[i] - ox) * s, pz = (pts[i + 1] - oz) * s;
        if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
      }
      ctx.stroke();
    }
  }
}

