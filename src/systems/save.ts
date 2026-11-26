/**
 * Partida guardada y opciones, en el almacenamiento local del navegador.
 * Todo va envuelto en try/catch: en modo incógnito o con el almacenamiento bloqueado,
 * el juego sigue funcionando y simplemente no guarda.
 */

export interface SaveData {
  v: 1;
  /** Fecha del guardado (ms desde 1970). */
  at: number;
  pos: [number, number, number];
  heading: number;
  health: number;
  money: number;
  weapon: number;
  ammo: number[];
  reserve: number[];
  /** Hora del día (0–24) y si llovía. */
  time: number;
  raining: boolean;
  /** Tiempo jugado en segundos. */
  played: number;
  /** Progreso de misiones y otros sistemas futuros (clave → estado). */
  progress: Record<string, unknown>;
  /** Armas compradas (las partidas antiguas no lo tienen: se dan todas). */
  owned?: boolean[];
}

export interface Settings {
  /** Volumen general 0–1. */
  volume: number;
  music: boolean;
  /** Preset de imagen (índice de RETRO_PRESETS). */
  image: number;
  /** Multiplicador de la sensibilidad del ratón (0,4–2,5). */
  sens: number;
  invertY: boolean;
}

const SAVE_KEY = 'madriz.save.v1';
const SETTINGS_KEY = 'madriz.settings.v1';

export const DEFAULT_SETTINGS: Settings = { volume: 0.85, music: true, image: 0, sens: 1, invertY: false };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Partida guardada, o null si no hay (o no es válida). */
export function loadGame(): SaveData | null {
  const d = read<SaveData>(SAVE_KEY);
  if (!d || d.v !== 1 || !Array.isArray(d.pos) || d.pos.length !== 3 || d.pos.some((n) => !Number.isFinite(n))) return null;
  return d;
}

export function saveGame(d: SaveData) { return write(SAVE_KEY, d); }

export function deleteGame() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* sin almacenamiento */ }
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
}

export function saveSettings(s: Settings) { return write(SETTINGS_KEY, s); }

/** «hace 3 min», «hoy a las 21:40», «12 nov, 18:05». */
export function describeSaveTime(at: number, now = Date.now()) {
  const min = Math.round((now - at) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const d = new Date(at), today = new Date(now);
  const hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `hoy a las ${hm}`;
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}, ${hm}`;
}

/** «1 h 05 min» de juego. */
export function describePlayed(sec: number) {
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
