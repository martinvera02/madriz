import { describe, it, expect, beforeEach } from 'vitest';
import { loadGame, saveGame, deleteGame, loadSettings, saveSettings, describePlayed, describeSaveTime, DEFAULT_SETTINGS, type SaveData } from '../src/systems/save';

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const sample = (): SaveData => ({
  v: 1, at: 0, pos: [1, 2, 3], heading: 0, health: 100, money: 40, weapon: 0, ammo: [0], reserve: [0],
  time: 12, raining: false, played: 0, progress: {},
});

describe('partida guardada', () => {
  beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = new MemStorage(); });

  it('guarda y carga la misma partida', () => {
    expect(loadGame()).toBeNull();
    expect(saveGame(sample())).toBe(true);
    expect(loadGame()).toEqual(sample());
    deleteGame();
    expect(loadGame()).toBeNull();
  });

  it('rechaza partidas corruptas o de otra versión', () => {
    localStorage.setItem('madriz.save.v1', JSON.stringify({ ...sample(), pos: [1, null, 3] }));
    expect(loadGame()).toBeNull();
    localStorage.setItem('madriz.save.v1', JSON.stringify({ ...sample(), v: 2 }));
    expect(loadGame()).toBeNull();
    localStorage.setItem('madriz.save.v1', '{no es json');
    expect(loadGame()).toBeNull();
  });

  it('las opciones guardadas se mezclan con las de serie', () => {
    localStorage.setItem('madriz.settings.v1', JSON.stringify({ volume: 0.2 }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, volume: 0.2 });
    saveSettings({ ...DEFAULT_SETTINGS, fps: true });
    expect(loadSettings().fps).toBe(true);
  });

  it('sin almacenamiento (incógnito) no rompe', () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(saveGame(sample())).toBe(false);
    expect(loadGame()).toBeNull();
  });
});

describe('textos', () => {
  it('tiempo jugado', () => {
    expect(describePlayed(125)).toBe('2 min');
    expect(describePlayed(3900)).toBe('1 h 05 min');
  });
  it('hora del guardado', () => {
    const now = Date.UTC(2026, 10, 27, 12);
    expect(describeSaveTime(now - 10_000, now)).toBe('hace un momento');
    expect(describeSaveTime(now - 5 * 60_000, now)).toBe('hace 5 min');
  });
});
