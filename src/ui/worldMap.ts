import type { WorldData } from '../world/realData';
import { drawIcon, drawPlayerArrow, drawRoute, ICON_NAMES, type MapIcon } from './mapIcons';

/**
 * Mapa completo (tecla M): se mueve arrastrando o con WASD, zoom con la rueda, clic para marcar destino
 * (el GPS dibuja la ruta más rápida), clic derecho para quitarlo. Muestra nombres de calles según el zoom,
 * lugares de interés, tiendas, misiones y la leyenda.
 */

interface Label { text: string; x: number; z: number; angle: number; minZoom: number }

/** Lugares de interés que se rotulan en el mapa (nombre en OSM → rótulo). */
const LANDMARKS: [string, string][] = [
  ['Plaza Mayor', 'Plaza Mayor'], ['Palacio de Cibeles - Ayuntamiento de Madrid', 'Palacio de Cibeles'],
  ['Fuente de Cibeles', 'Cibeles'], ['Viaducto de Segovia', 'Viaducto'], ['Tio Pepe', 'Tío Pepe'],
  ['Real Jardín Botánico de Madrid', 'Jardín Botánico'], ['Monumento a Alfonso XII', 'Estanque del Retiro'],
  ['Fuente de Apolo', 'Fuente de Apolo'], ['Puerta de Felipe IV', 'Puerta de Felipe IV'], ['Cortylandia', 'Cortylandia'],
  ['Estatua de Carlos III', 'Puerta del Sol'], ['Plaza de Chueca', 'Plaza de Chueca'], ['Muralla Árabe', 'Muralla Árabe'],
  ['Jardines del Descubrimiento', 'Plaza de Colón'], ['Puerta de España', 'Retiro'],
];

export class WorldMap {
  open = false;
  private readonly cv = document.getElementById('worldmap') as HTMLCanvasElement;
  private readonly c = this.cv.getContext('2d')!;
  private readonly wrap = document.getElementById('worldmap-wrap')!;
  private readonly infoEl = document.getElementById('worldmap-info')!;
  private readonly tipEl = document.getElementById('worldmap-tip')!;
  private cx = 0;
  private cz = 0;
  /** Píxeles por metro. */
  private zoom = 0.6;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private mouse = { x: -1, y: -1 };
  private labels: Label[] = [];
  readonly landmarks: MapIcon[] = [];
  private t = 0;
  /** Lo que dibujó el último frame (para saber qué hay bajo el ratón). */
  private drawn: { icon: MapIcon; sx: number; sy: number }[] = [];

  constructor(private data: WorldData, private image: HTMLCanvasElement,
    private hooks: {
      setWaypoint(x: number, z: number): void;
      clearWaypoint(): void;
      waypoint(): { x: number; z: number } | null;
      placeName(x: number, z: number): string;
    }) {
    this.buildLabels();
    for (const [osm, label] of LANDMARKS) {
      const p = data.pois.find((q) => q.name === osm);
      if (p) this.landmarks.push({ x: p.x, z: p.z, kind: 'landmark', label });
    }
    this.legend();
    const cv = this.cv;
    cv.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false };
    });
    window.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (!this.drag || !this.open) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      this.cx = this.drag.cx - dx / this.zoom;
      this.cz = this.drag.cz - dy / this.zoom;
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.drag || !this.open) { this.drag = null; return; }
      const d = this.drag;
      this.drag = null;
      if (d.moved || e.button !== 0) return;
      const [x, z] = this.toWorld(e.clientX, e.clientY);
      const wp = this.hooks.waypoint();
      if (wp) {
        const [sx, sy] = this.toScreen(wp.x, wp.z);
        if (Math.hypot(sx - e.clientX, sy - 8 - e.clientY) < 16) { this.hooks.clearWaypoint(); return; }
      }
      this.hooks.setWaypoint(x, z);
    });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); this.hooks.clearWaypoint(); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY);
    }, { passive: false });
  }

  /** Un rótulo por calle importante: el tramo recto más largo, con su ángulo. */
  private buildLabels() {
    const N = this.data.roadNodes;
    const rank: Record<string, number> = { trunk: 0.3, primary: 0.35, secondary: 0.55, tertiary: 0.9, residential: 1.5, living_street: 1.8, pedestrian: 1.5, unclassified: 1.8 };
    const best = new Map<string, Label & { len: number }>();
    for (const r of this.data.roads) {
      if (!r.name || rank[r.hw] === undefined) continue;
      for (let i = 1; i < r.n.length; i++) {
        const ax = N[r.n[i - 1] * 2], az = N[r.n[i - 1] * 2 + 1], bx = N[r.n[i] * 2], bz = N[r.n[i] * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const cur = best.get(r.name);
        if (len < 25 || (cur && cur.len >= len)) continue;
        let angle = Math.atan2(bz - az, bx - ax);
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        best.set(r.name, { text: r.name, x: (ax + bx) / 2, z: (az + bz) / 2, angle, minZoom: Math.min(cur?.minZoom ?? 9, rank[r.hw]), len });
      }
    }
    this.labels = [...best.values()].sort((a, b) => a.minZoom - b.minZoom || b.len - a.len);
  }

  private legend() {
    const el = document.getElementById('worldmap-legend')!;
    el.innerHTML = '<b>LEYENDA</b>';
    for (const [kind, name] of ICON_NAMES) {
      const row = document.createElement('div');
      const cv = document.createElement('canvas');
      cv.width = 22; cv.height = 22;
      drawIcon(cv.getContext('2d')!, { x: 0, z: 0, kind }, 11, kind === 'waypoint' ? 13 : 11, 1);
      row.append(cv, document.createTextNode(name));
      el.append(row);
    }
  }

  private toScreen(x: number, z: number): [number, number] {
    return [(x - this.cx) * this.zoom + this.cv.width / 2, (z - this.cz) * this.zoom + this.cv.height / 2];
  }
  private toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.cv.width / 2) / this.zoom + this.cx, (sy - this.cv.height / 2) / this.zoom + this.cz];
  }
  private zoomAt(k: number, sx: number, sy: number) {
    const [wx, wz] = this.toWorld(sx, sy);
    this.zoom = Math.max(0.18, Math.min(4, this.zoom * k));
    // mantener bajo el ratón el mismo punto del mundo
    this.cx = wx - (sx - this.cv.width / 2) / this.zoom;
    this.cz = wz - (sy - this.cv.height / 2) / this.zoom;
  }

  show(on: boolean, px = 0, pz = 0) {
    this.open = on;
    this.wrap.classList.toggle('hidden', !on);
    if (on) { this.cx = px; this.cz = pz; this.drag = null; }
  }

  center(px: number, pz: number) { this.cx = px; this.cz = pz; }

  /** Teclado: WASD/flechas mueven, +/- (o Q/E) zoom. */
  move(dx: number, dz: number, zoom: number, dt: number) {
    const sp = 700 / this.zoom * dt;
    this.cx += dx * sp; this.cz += dz * sp;
    if (zoom) this.zoomAt(Math.pow(2.2, zoom * dt), this.cv.width / 2, this.cv.height / 2);
  }

  draw(dt: number, player: { x: number; z: number; heading: number }, icons: MapIcon[],
    route: { pts: Float32Array; color: string; text: string } | null) {
    this.t += dt;
    const cv = this.cv, c = this.c;
    if (cv.width !== window.innerWidth || cv.height !== window.innerHeight) { cv.width = window.innerWidth; cv.height = window.innerHeight; }
    const W = cv.width, H = cv.height;
    // límites: no salirse del mapa
    const b = this.data.bounds;
    this.cx = Math.max(b.x0, Math.min(b.x1, this.cx));
    this.cz = Math.max(b.z0, Math.min(b.z1, this.cz));
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#12151a'; c.fillRect(0, 0, W, H);
    const img = this.image, is = Number(img.dataset.scale), ix0 = Number(img.dataset.x0), iz0 = Number(img.dataset.z0);
    c.imageSmoothingEnabled = this.zoom < is;
    const [ox, oy] = this.toScreen(ix0, iz0);
    c.drawImage(img, ox, oy, img.width / is * this.zoom, img.height / is * this.zoom);
    // cuadrícula de 500 m (orientación y escala)
    c.strokeStyle = 'rgba(133,139,145,0.10)'; c.lineWidth = 1;
    for (let x = Math.ceil(b.x0 / 500) * 500; x <= b.x1; x += 500) { const [sx] = this.toScreen(x, 0); c.beginPath(); c.moveTo(sx, 0); c.lineTo(sx, H); c.stroke(); }
    for (let z = Math.ceil(b.z0 / 500) * 500; z <= b.z1; z += 500) { const [, sy] = this.toScreen(0, z); c.beginPath(); c.moveTo(0, sy); c.lineTo(W, sy); c.stroke(); }
    // nombres de calles (sin que se pisen)
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const taken: [number, number, number, number][] = [];
    const fs = Math.round(Math.max(10, Math.min(14, 9 + this.zoom * 3)));
    c.font = `600 ${fs}px 'Roboto Condensed', 'Arial Narrow', sans-serif`;
    for (const l of this.labels) {
      if (this.zoom < l.minZoom) continue;
      const [sx, sy] = this.toScreen(l.x, l.z);
      if (sx < -100 || sy < -30 || sx > W + 100 || sy > H + 30) continue;
      const w = c.measureText(l.text).width;
      const hw = (Math.abs(Math.cos(l.angle)) * w + Math.abs(Math.sin(l.angle)) * fs) / 2 + 4;
      const hh = (Math.abs(Math.sin(l.angle)) * w + Math.abs(Math.cos(l.angle)) * fs) / 2 + 4;
      if (taken.some(([x0, y0, x1, y1]) => sx + hw > x0 && sx - hw < x1 && sy + hh > y0 && sy - hh < y1)) continue;
      taken.push([sx - hw, sy - hh, sx + hw, sy + hh]);
      c.save(); c.translate(sx, sy); c.rotate(l.angle);
      c.lineWidth = 3; c.strokeStyle = 'rgba(18,21,26,0.85)'; c.strokeText(l.text, 0, 0);
      c.fillStyle = '#b9b4a8'; c.fillText(l.text, 0, 0);
      c.restore();
    }
    // ruta
    if (route) drawRoute(c, route.pts, (x, z) => this.toScreen(x, z), route.color, Math.max(3, Math.min(7, this.zoom * 5)));
    // iconos (los pequeños solo con zoom)
    this.drawn = [];
    const order: Record<string, number> = { npc: 0, bar: 1, tienda: 1, landmark: 2, police: 3, car: 4, armeria: 5, taller: 5, mission: 6, waypoint: 7, target: 8 };
    const all = [...this.landmarks, ...icons].sort((a, b) => (order[a.kind] ?? 0) - (order[b.kind] ?? 0));
    const sc = Math.max(1, Math.min(1.6, 0.9 + this.zoom * 0.4));
    const small: [number, number][] = [];
    for (const ic of all) {
      const minor = ic.kind === 'bar' || ic.kind === 'tienda';
      if (ic.kind === 'bar' && this.zoom < 1.4) continue;
      if (ic.kind === 'tienda' && this.zoom < 2.4) continue;
      if (ic.kind === 'npc' && this.zoom < 1.2) continue;
      const [sx, sy] = this.toScreen(ic.x, ic.z);
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      // bares y tiendas sin amontonarse
      if (minor) {
        if (small.some(([x, y]) => Math.abs(x - sx) < 24 && Math.abs(y - sy) < 24)) continue;
        small.push([sx, sy]);
      }
      drawIcon(c, ic, sx, sy, sc, this.t);
      this.drawn.push({ icon: ic, sx, sy });
      // rótulos de lo importante
      if (ic.label && (['mission', 'armeria', 'taller', 'target', 'waypoint'].includes(ic.kind) || (ic.kind === 'landmark' && this.zoom > 0.45))) {
        c.font = `700 12px 'Roboto Condensed', 'Arial Narrow', sans-serif`;
        c.textAlign = 'left';
        c.lineWidth = 3; c.strokeStyle = 'rgba(18,21,26,0.9)';
        c.strokeText(ic.label, sx + 12 * sc, sy);
        c.fillStyle = ic.kind === 'landmark' ? '#e9e6df' : ic.color ?? '#efe9dc';
        c.fillText(ic.label, sx + 12 * sc, sy);
        c.textAlign = 'center';
      }
    }
    // jugador
    const [px, py] = this.toScreen(player.x, player.z);
    c.fillStyle = 'rgba(233,230,223,0.15)';
    c.beginPath(); c.arc(px, py, 16, 0, Math.PI * 2); c.fill();
    drawPlayerArrow(c, px, py, Math.PI - player.heading, 1.4);
    // escala
    const meters = this.zoom > 1.5 ? 100 : this.zoom > 0.5 ? 250 : 500;
    const len = meters * this.zoom;
    c.fillStyle = '#e9e6df'; c.fillRect(24, H - 54, len, 3);
    c.fillRect(24, H - 60, 2, 9); c.fillRect(24 + len - 2, H - 60, 2, 9);
    c.font = `600 12px 'Roboto Condensed', sans-serif`; c.textAlign = 'left';
    c.fillText(`${meters} m`, 30 + len, H - 52);
    // información: destino y lo que hay bajo el ratón
    const wp = this.hooks.waypoint();
    this.infoEl.innerHTML = route
      ? `<b>${route.text}</b>`
      : wp ? '<b>Sin ruta hasta ese punto</b>' : 'Haz clic en el mapa para marcar un destino';
    let tip = '';
    const hit = this.drawn.slice().reverse().find((d) => Math.hypot(d.sx - this.mouse.x, d.sy - this.mouse.y) < 12 && d.icon.label);
    if (hit) tip = hit.icon.label!;
    else if (this.mouse.x >= 0 && !this.drag) {
      const [wx, wz] = this.toWorld(this.mouse.x, this.mouse.y);
      tip = this.hooks.placeName(wx, wz);
    }
    this.tipEl.textContent = tip;
    this.tipEl.style.transform = `translate(${this.mouse.x + 14}px, ${this.mouse.y + 12}px)`;
    this.tipEl.style.display = tip ? 'block' : 'none';
  }
}
