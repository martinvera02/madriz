/**
 * Iconos del minimapa y del mapa completo, dibujados con trazos (sin fuentes ni imágenes externas)
 * para que se vean igual en cualquier equipo.
 */

export type IconKind =
  | 'mission' | 'target' | 'waypoint' | 'armeria' | 'taller' | 'bar' | 'tienda'
  | 'car' | 'police' | 'npc' | 'landmark';

export interface MapIcon {
  x: number;
  z: number;
  kind: IconKind;
  /** Texto para el mapa completo (y la leyenda al pasar el ratón). */
  label?: string;
  /** Color propio (vecinos con rutina). */
  color?: string;
}

export const ICON_COLOR: Record<IconKind, string> = {
  mission: '#b75b32', target: '#d4c29a', waypoint: '#8fb2e8', armeria: '#5f8fd8', taller: '#6fbf73',
  bar: '#c9774a', tienda: '#7d93b0', car: '#d4c29a', police: '#2a6bff', npc: '#e9e6df', landmark: '#e9e6df',
};

/** Iconos que, fuera del minimapa, se quedan pegados al borde (lo importante). */
export const EDGE_KINDS = new Set<IconKind>(['mission', 'target', 'waypoint']);

export const ICON_NAMES: [IconKind, string][] = [
  ['mission', 'Encargo (misión)'], ['target', 'Objetivo de la misión'], ['waypoint', 'Tu destino'],
  ['armeria', 'Armería'], ['taller', 'Taller'], ['bar', 'Bar'], ['tienda', 'Tienda'],
  ['car', 'Tu último coche'], ['police', 'Policía'], ['landmark', 'Lugar de interés'],
];

const BONE = '#e9e6df', COAL = '#171a20';

function badge(c: CanvasRenderingContext2D, r: number, fill: string) {
  c.fillStyle = fill; c.strokeStyle = COAL; c.lineWidth = 1.5;
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); c.stroke();
}

/**
 * Dibuja un icono centrado en (x, y). `s` = escala (1 = tamaño del minimapa).
 * `t` = tiempo en segundos (parpadeos).
 */
export function drawIcon(c: CanvasRenderingContext2D, icon: MapIcon, x: number, y: number, s = 1, t = 0) {
  const col = icon.color ?? ICON_COLOR[icon.kind];
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.lineCap = 'round'; c.lineJoin = 'round';
  switch (icon.kind) {
    case 'mission': {
      badge(c, 8, col);
      c.fillStyle = BONE;
      c.fillRect(-1.3, -5, 2.6, 6.2);
      c.fillRect(-1.3, 2.6, 2.6, 2.4);
      break;
    }
    case 'target': {
      const p = 1 + 0.12 * Math.sin(t * 5);
      c.scale(p, p);
      c.fillStyle = col; c.strokeStyle = COAL; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, -8); c.lineTo(8, 0); c.lineTo(0, 8); c.lineTo(-8, 0); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = COAL; c.beginPath(); c.arc(0, 0, 2.4, 0, Math.PI * 2); c.fill();
      break;
    }
    case 'waypoint': {
      // chincheta
      c.fillStyle = col; c.strokeStyle = COAL; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, 9); c.bezierCurveTo(-3, 3, -7, 0, -7, -4); c.arc(0, -4, 7, Math.PI, 0); c.bezierCurveTo(7, 0, 3, 3, 0, 9);
      c.closePath(); c.fill(); c.stroke();
      c.fillStyle = COAL; c.beginPath(); c.arc(0, -4, 2.6, 0, Math.PI * 2); c.fill();
      break;
    }
    case 'armeria': {
      badge(c, 8, col);
      // punto de mira
      c.strokeStyle = BONE; c.lineWidth = 1.6;
      c.beginPath(); c.arc(0, 0, 4, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(0, -6.5); c.lineTo(0, -2); c.moveTo(0, 2); c.lineTo(0, 6.5); c.moveTo(-6.5, 0); c.lineTo(-2, 0); c.moveTo(2, 0); c.lineTo(6.5, 0); c.stroke();
      break;
    }
    case 'taller': {
      badge(c, 8, col);
      // llave inglesa
      c.rotate(-Math.PI / 4);
      c.strokeStyle = BONE; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(0, -1); c.lineTo(0, 5.5); c.stroke();
      c.lineWidth = 1.8;
      c.beginPath(); c.arc(0, -3.2, 2.8, Math.PI * 0.15, Math.PI * 0.85, true); c.stroke();
      break;
    }
    case 'bar': {
      badge(c, 5.5, col);
      // jarra
      c.fillStyle = BONE;
      c.fillRect(-2.4, -2.6, 3.6, 5);
      c.strokeStyle = BONE; c.lineWidth = 1.1;
      c.beginPath(); c.arc(1.6, -0.1, 1.5, -Math.PI / 2, Math.PI / 2); c.stroke();
      break;
    }
    case 'tienda': {
      badge(c, 5.5, col);
      // bolsa
      c.fillStyle = BONE; c.fillRect(-2.6, -1.2, 5.2, 4);
      c.strokeStyle = BONE; c.lineWidth = 1;
      c.beginPath(); c.arc(0, -1.2, 1.6, Math.PI, 0); c.stroke();
      break;
    }
    case 'car': {
      c.fillStyle = col; c.strokeStyle = COAL; c.lineWidth = 1.4;
      c.beginPath(); c.roundRect(-6, -3.6, 12, 7.2, 2.2); c.fill(); c.stroke();
      c.fillStyle = COAL; c.fillRect(-2.4, -2.6, 4.8, 5.2);
      break;
    }
    case 'police': {
      const on = Math.floor(t * 4) % 2 === 0;
      badge(c, 4.5, on ? '#2a6bff' : BONE);
      break;
    }
    case 'npc': {
      c.fillStyle = col; c.strokeStyle = COAL; c.lineWidth = 1;
      c.beginPath(); c.arc(0, 0, 2.8, 0, Math.PI * 2); c.fill(); c.stroke();
      break;
    }
    case 'landmark': {
      c.fillStyle = col; c.strokeStyle = COAL; c.lineWidth = 1.2;
      c.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 2.6 : 6;
        if (k) c.lineTo(Math.cos(a) * r, Math.sin(a) * r); else c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath(); c.fill(); c.stroke();
      break;
    }
  }
  c.restore();
}

/** Flecha del jugador. */
export function drawPlayerArrow(c: CanvasRenderingContext2D, x: number, y: number, rot: number, s = 1) {
  c.save();
  c.translate(x, y); c.rotate(rot); c.scale(s, s);
  c.fillStyle = BONE; c.strokeStyle = COAL; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(0, 3); c.lineTo(-5.5, 6); c.closePath();
  c.fill(); c.stroke();
  c.restore();
}

/** Trazado de la ruta (puntos x,z en metros) con un contorno oscuro para que se lea sobre cualquier fondo. */
export function drawRoute(c: CanvasRenderingContext2D, pts: Float32Array | number[], toScreen: (x: number, z: number) => [number, number], color: string, width: number) {
  if (pts.length < 4) return;
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const [sx, sy] = toScreen(pts[i], pts[i + 1]);
    if (i) c.lineTo(sx, sy); else c.moveTo(sx, sy);
  }
  c.strokeStyle = 'rgba(23,26,32,0.85)'; c.lineWidth = width + 3; c.stroke();
  c.strokeStyle = color; c.lineWidth = width; c.stroke();
  c.restore();
}
