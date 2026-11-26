import { drawIcon, drawPlayerArrow, drawRoute, EDGE_KINDS, type MapIcon } from './mapIcons';

export interface Blip { x: number; z: number; color: string; size?: number; }

const C = { night: '#202b3a', slate: '#536477', cement: '#858b91', coal: '#171a20', rust: '#b75b32', warm: '#d4c29a', bone: '#e9e6df' };
const FONT = "'Roboto Condensed', 'Arial Narrow', 'Liberation Sans Narrow', sans-serif";

/** HUD mínimo: brújula, reloj, zona, minimapa, velocímetro circular, etiquetas de interacción y avisos. */
export class Hud {
  private banner = document.getElementById('zone-banner')!;
  private clockEl = document.getElementById('clock')!;
  private weatherEl = document.getElementById('weather')!;
  private speedo = document.getElementById('speedo')!;
  private hint = document.getElementById('hint')!;
  private help = document.getElementById('help')!;
  private toastEl = document.getElementById('toast')!;
  private cross = document.getElementById('crosshair')!;
  private mm = document.getElementById('minimap') as HTMLCanvasElement;
  private mctx = this.mm.getContext('2d')!;
  private comp = document.getElementById('compass') as HTMLCanvasElement;
  private cctx = this.comp.getContext('2d')!;
  private gauge = document.getElementById('gauge') as HTMLCanvasElement;
  private gctx = this.gauge.getContext('2d')!;
  private dmgEl = document.getElementById('dmg-bar')!;
  private carEl = document.getElementById('car-name')!;
  private lastZone = '';
  private bannerTimer = 0;
  private toastTimer = 0;
  private car: { name: string; gear: number; rpm: number; health: number } | null = null;
  private tintedMap: HTMLCanvasElement;

  constructor(mapImage: HTMLCanvasElement) {
    // Minimapa con la paleta del juego: más oscuro, frío y con poco color
    const t = document.createElement('canvas');
    t.width = mapImage.width; t.height = mapImage.height;
    const g = t.getContext('2d')!;
    g.filter = 'saturate(0.45) brightness(0.62) contrast(1.15)';
    g.drawImage(mapImage, 0, 0);
    g.filter = 'none';
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#8ea3bd';
    g.fillRect(0, 0, t.width, t.height);
    t.dataset.scale = mapImage.dataset.scale;
    t.dataset.x0 = mapImage.dataset.x0;
    t.dataset.z0 = mapImage.dataset.z0;
    this.tintedMap = t;
  }

  toggleHelp() { this.help.classList.toggle('hidden'); }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = 1.8;
  }

  setCrosshair(on: boolean, aim = false) { this.cross.classList.toggle('show', on || aim); this.cross.classList.toggle('aim', aim); }

  private weaponBox = document.getElementById('weapon-box')!;
  private weaponName = document.getElementById('weapon-name')!;
  private weaponAmmo = document.getElementById('weapon-ammo')!;
  private hitEl = document.getElementById('hitmark')!;
  private healthBar = document.getElementById('health-bar')!;
  private bubbleBox = document.getElementById('bubbles')!;
  private fadeEl = document.getElementById('fade')!;
  private deadEl = document.getElementById('dead')!;
  private bubbles: { el: HTMLDivElement; pos: { x: number; y: number; z: number }; life: number }[] = [];
  private tags = new Map<string, HTMLDivElement>();

  setWeapon(name: string, ammo: number | null, reserve: number, reloading: boolean, visible: boolean) {
    this.weaponBox.style.display = visible ? '' : 'none';
    this.weaponName.textContent = name;
    this.weaponAmmo.innerHTML = ammo === null ? '—' : reloading ? 'RECARGANDO' : `${ammo} <small>/ ${reserve}</small>`;
  }
  private wantedEl = document.getElementById('wanted')!;
  private moneyEl = document.getElementById('money')!;
  private lastStars = -1;
  setWanted(stars: number, seen: boolean) {
    if (stars !== this.lastStars) {
      this.lastStars = stars;
      this.wantedEl.innerHTML = stars > 0 ? '<b>' + '★'.repeat(stars) + '</b>' + '★'.repeat(5 - stars) : '';
    }
    this.wantedEl.classList.toggle('flash', seen && Math.floor(performance.now() / 300) % 2 === 0);
  }
  setMoney(eur: number) { this.moneyEl.textContent = eur.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  setHitmark(on: boolean) { this.hitEl.classList.toggle('show', on); }
  setHealth(h: number) {
    this.healthBar.style.width = `${Math.max(0, h)}%`;
    this.healthBar.style.background = h > 50 ? '#c9d6a4' : h > 25 ? '#d4a23a' : '#c23a2a';
  }
  fade(on: boolean) { this.fadeEl.classList.toggle('on', on); }
  showDead(on: boolean) { this.deadEl.classList.toggle('show', on); }

  /** Bocadillo de diálogo sobre una posición del mundo. */
  say(who: string, text: string, pos: { x: number; y: number; z: number }, loud = false, life = 4) {
    // un bocadillo por persona: si ya hay uno cerca, se sustituye
    for (const b of this.bubbles) if (Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z) < 1) b.life = 0;
    const el = document.createElement('div');
    el.className = 'bubble' + (loud ? ' loud' : '');
    el.innerHTML = `<b>${who}</b>${text}`;
    this.bubbleBox.appendChild(el);
    this.bubbles.push({ el, pos: { x: pos.x, y: pos.y, z: pos.z }, life });
  }

  /** Coloca bocadillos y nombres sobre las cabezas (proyección con la cámara). */
  placeOverlays(dt: number, project: (x: number, y: number, z: number) => { x: number; y: number; on: boolean }, tags: { key: string; text: string; x: number; y: number; z: number }[]) {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.life -= dt;
      const p = project(b.pos.x, b.pos.y + 2.1, b.pos.z);
      if (b.life <= 0) { b.el.remove(); this.bubbles.splice(i, 1); continue; }
      b.el.style.display = p.on ? '' : 'none';
      b.el.style.left = `${p.x}px`; b.el.style.top = `${p.y}px`;
      b.el.style.opacity = String(Math.min(1, b.life * 2));
    }
    const seen = new Set<string>();
    for (const t of tags) {
      seen.add(t.key);
      let el = this.tags.get(t.key);
      if (!el) { el = document.createElement('div'); el.className = 'tag'; this.bubbleBox.appendChild(el); this.tags.set(t.key, el); }
      el.innerHTML = t.text;
      const p = project(t.x, t.y + 2.0, t.z);
      el.style.display = p.on ? '' : 'none';
      el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
    }
    for (const [k, el] of this.tags) if (!seen.has(k)) { el.remove(); this.tags.delete(k); }
  }
  setWeather(text: string) { this.weatherEl.textContent = text; }

  setZone(name: string, sub: string) {
    if (name === this.lastZone) return;
    this.lastZone = name;
    this.banner.innerHTML = `${name}<small>${sub}</small>`;
    this.banner.classList.add('show');
    this.bannerTimer = 4;
  }

  /** Etiqueta de interacción: "[F] Robar el coche". */
  setHint(key: string | null, text?: string) {
    if (key && text) {
      this.hint.innerHTML = `<kbd>${key}</kbd> ${text}`;
      this.hint.classList.add('show');
    } else this.hint.classList.remove('show');
  }

  setAltitude(_m: number) { /* la altitud va en el rótulo de zona */ }

  setCar(info: { name: string; gear: number; rpm: number; health: number } | null) {
    this.car = info;
    if (!info) return;
    this.carEl.textContent = info.name;
    this.dmgEl.style.width = `${Math.round(info.health)}%`;
    this.dmgEl.style.background = info.health > 50 ? C.warm : info.health > 25 ? C.rust : '#c23a2a';
  }

  update(dt: number, clock: string, speedKmh: number | null) {
    if (this.bannerTimer > 0 && (this.bannerTimer -= dt) <= 0) this.banner.classList.remove('show');
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.classList.remove('show');
    this.clockEl.textContent = clock;
    if (speedKmh === null) this.speedo.classList.remove('show');
    else {
      this.speedo.classList.add('show');
      this.drawGauge(speedKmh);
    }
  }

  /** Velocímetro circular: arco de 240°, escala hasta 240 km/h, aguja y cuentarrevoluciones interior. */
  private drawGauge(kmh: number) {
    const c = this.gctx, W = this.gauge.width, R = W / 2;
    c.clearRect(0, 0, W, W);
    const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
    const ang = (v: number) => a0 + span * Math.min(1, v);
    c.lineCap = 'butt';
    // fondo
    c.fillStyle = 'rgba(23,26,32,0.55)';
    c.beginPath(); c.arc(R, R, R - 8, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(133,139,145,0.35)'; c.lineWidth = 6;
    c.beginPath(); c.arc(R, R, R - 16, a0, a0 + span); c.stroke();
    // arco de velocidad
    c.strokeStyle = C.rust; c.lineWidth = 6;
    c.beginPath(); c.arc(R, R, R - 16, a0, ang(kmh / 240)); c.stroke();
    // marcas cada 20 km/h
    c.strokeStyle = C.bone; c.lineWidth = 2;
    for (let v = 0; v <= 240; v += 20) {
      const a = ang(v / 240), big = v % 60 === 0;
      c.beginPath();
      c.moveTo(R + Math.cos(a) * (R - 24), R + Math.sin(a) * (R - 24));
      c.lineTo(R + Math.cos(a) * (R - (big ? 34 : 29)), R + Math.sin(a) * (R - (big ? 34 : 29)));
      c.stroke();
    }
    // revoluciones (arco interior)
    const rpm = this.car?.rpm ?? 0;
    c.strokeStyle = 'rgba(133,139,145,0.25)'; c.lineWidth = 3;
    c.beginPath(); c.arc(R, R, R - 42, a0, a0 + span); c.stroke();
    c.strokeStyle = rpm > 0.88 ? '#e0553a' : C.warm;
    c.beginPath(); c.arc(R, R, R - 42, a0, ang(rpm)); c.stroke();
    // aguja
    const a = ang(kmh / 240);
    c.strokeStyle = C.warm; c.lineWidth = 3;
    c.beginPath(); c.moveTo(R + Math.cos(a) * 18, R + Math.sin(a) * 18); c.lineTo(R + Math.cos(a) * (R - 20), R + Math.sin(a) * (R - 20)); c.stroke();
    c.fillStyle = C.coal; c.beginPath(); c.arc(R, R, 6, 0, Math.PI * 2); c.fill();
    // cifras
    c.fillStyle = C.bone; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `700 34px ${FONT}`;
    c.fillText(String(Math.round(kmh)), R, R + 30);
    c.font = `600 10px ${FONT}`;
    c.fillStyle = C.cement;
    c.fillText('KM/H', R, R + 50);
    const g = this.car ? (this.car.gear < 0 ? 'R' : String(this.car.gear)) : '';
    c.font = `700 14px ${FONT}`; c.fillStyle = C.warm;
    c.fillText(g, R, R - 22);
  }

  /** Brújula superior: puntos cardinales que se desplazan con la cámara y marcadores. */
  drawCompass(camYaw: number, px: number, pz: number, markers: Blip[]) {
    const c = this.cctx, W = this.comp.width, H = this.comp.height;
    c.clearRect(0, 0, W, H);
    // rumbo de la cámara: 0 = norte (−Z), 90 = este (+X)
    const heading = ((Math.atan2(Math.sin(camYaw), -Math.cos(camYaw)) * 180) / Math.PI + 360) % 360;
    const pxPerDeg = W / 150; // 150° visibles
    const g = c.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(23,26,32,0)'); g.addColorStop(0.15, 'rgba(23,26,32,0.55)');
    g.addColorStop(0.85, 'rgba(23,26,32,0.55)'); g.addColorStop(1, 'rgba(23,26,32,0)');
    c.fillStyle = g; c.fillRect(0, 8, W, 22);
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 15) {
      let rel = d - heading;
      rel = ((rel + 540) % 360) - 180;
      if (Math.abs(rel) > 75) continue;
      const x = W / 2 + rel * pxPerDeg;
      const fade = 1 - Math.abs(rel) / 80;
      c.globalAlpha = fade;
      if (names[d]) {
        c.fillStyle = d === 0 ? C.rust : C.bone;
        c.font = `700 ${d % 90 === 0 ? 15 : 12}px ${FONT}`;
        c.fillText(names[d], x, 19);
      } else {
        c.fillStyle = C.cement;
        c.fillRect(x - 0.5, 15, 1, 8);
      }
    }
    // marcadores (rombos amarillos)
    for (const m of markers) {
      const b = ((Math.atan2(m.x - px, -(m.z - pz)) * 180) / Math.PI + 360) % 360;
      let rel = ((b - heading + 540) % 360) - 180;
      rel = Math.max(-72, Math.min(72, rel));
      const x = W / 2 + rel * pxPerDeg;
      c.globalAlpha = 1;
      c.fillStyle = m.color;
      c.beginPath(); c.moveTo(x, 2); c.lineTo(x + 5, 7); c.lineTo(x, 12); c.lineTo(x - 5, 7); c.closePath(); c.fill();
      const dist = Math.hypot(m.x - px, m.z - pz);
      c.font = `600 10px ${FONT}`; c.fillStyle = C.bone;
      c.fillText(`${Math.round(dist)} m`, x, 36);
    }
    c.globalAlpha = 1;
    c.fillStyle = C.warm;
    c.beginPath(); c.moveTo(W / 2 - 5, 30); c.lineTo(W / 2 + 5, 30); c.lineTo(W / 2, 25); c.closePath(); c.fill();
  }

  /** Imagen del mapa (con la paleta del juego) para el mapa completo. */
  get mapImage() { return this.tintedMap; }
  private mmT = 0;

  /**
   * Minimapa que gira con la cámara (arriba = hacia donde miras). Se aleja con la velocidad, dibuja la ruta
   * del GPS y los iconos; lo importante (misión, destino) se queda en el borde si cae fuera.
   */
  drawMinimap(px: number, pz: number, camYaw: number, playerHeading: number, icons: MapIcon[],
    route: { pts: Float32Array; color: string } | null, viewM: number, info: string | null, dt = 0) {
    this.mmT += dt;
    const c = this.mctx, W = this.mm.width, R = W / 2;
    const map = this.tintedMap;
    const imgScale = Number(map.dataset.scale);
    const ix0 = Number(map.dataset.x0), iz0 = Number(map.dataset.z0);
    const s = W / viewM;
    c.save();
    c.imageSmoothingEnabled = false;
    c.fillStyle = C.coal; c.fillRect(0, 0, W, W);
    c.translate(R, R);
    c.rotate(camYaw - Math.PI);
    c.scale(s / imgScale, s / imgScale);
    c.drawImage(map, -(px - ix0) * imgScale, -(pz - iz0) * imgScale);
    c.setTransform(1, 0, 0, 1, 0, 0);
    // de mundo a pantalla (girado con la cámara)
    const rot = camYaw - Math.PI, cr = Math.cos(rot), sr = Math.sin(rot);
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = (x - px) * s, dz = (z - pz) * s;
      return [R + dx * cr - dz * sr, R + dx * sr + dz * cr];
    };
    if (route) {
      c.save();
      c.beginPath(); c.rect(0, 0, W, W); c.clip();
      drawRoute(c, route.pts, toScreen, route.color, 4);
      c.restore();
    }
    // primero lo menudo, encima lo importante
    const order: Record<string, number> = { npc: 0, bar: 1, tienda: 1, landmark: 1, police: 2, car: 3, armeria: 4, taller: 4, mission: 5, waypoint: 6, target: 7 };
    for (const ic of [...icons].sort((a, b) => (order[a.kind] ?? 0) - (order[b.kind] ?? 0))) {
      let [sx, sy] = toScreen(ic.x, ic.z);
      const out = sx < 8 || sy < 8 || sx > W - 8 || sy > W - 8;
      if (out) {
        if (!EDGE_KINDS.has(ic.kind)) continue;
        // pegado al borde, en la dirección correcta
        const dx = sx - R, dy = sy - R, k = (R - 10) / Math.max(Math.abs(dx), Math.abs(dy));
        sx = R + dx * k; sy = R + dy * k;
      }
      drawIcon(c, ic, sx, sy, ic.kind === 'npc' || ic.kind === 'bar' || ic.kind === 'tienda' ? 0.9 : 1, this.mmT);
    }
    drawPlayerArrow(c, R, R, -playerHeading + camYaw);
    // norte en el borde
    const na = camYaw - 1.5 * Math.PI;
    const k = (R - 10) / Math.max(Math.abs(Math.cos(na)), Math.abs(Math.sin(na)));
    const nx = R + Math.cos(na) * Math.min(k, R - 10), ny = R + Math.sin(na) * Math.min(k, R - 10);
    c.fillStyle = C.rust; c.fillRect(nx - 7, ny - 7, 14, 14);
    c.fillStyle = C.bone; c.font = `700 11px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', nx, ny + 1);
    // distancia y tiempo hasta el destino
    if (info) {
      c.font = `700 12px ${FONT}`;
      const w = c.measureText(info).width + 14;
      c.fillStyle = 'rgba(23,26,32,0.8)'; c.fillRect(R - w / 2, W - 22, w, 18);
      c.fillStyle = route?.color ?? C.warm; c.fillText(info, R, W - 12.5);
    }
    c.restore();
  }
}
