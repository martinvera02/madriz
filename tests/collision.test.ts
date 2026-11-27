import { describe, it, expect } from 'vitest';
import { CollisionWorld } from '../src/world/collision';

describe('CollisionWorld', () => {
  it('saca un círculo de una caja y devuelve la normal del choque', () => {
    const w = new CollisionWorld();
    w.addBox(0, 0, 10, 10, 5);
    const p = { x: -0.2, z: 5 };
    const hit = w.resolveCircle(p, 0.5);
    expect(hit).not.toBeNull();
    expect(hit!.nx).toBeCloseTo(-1);
    expect(p.x).toBeCloseTo(-0.5);
  });

  it('deja pasar por encima de lo bajo (bordillos) y por debajo de lo elevado (voladizos)', () => {
    const w = new CollisionWorld();
    w.addBox(0, 0, 10, 10, 0.3);
    const p = { x: 5, z: 5 };
    expect(w.resolveCircle(p, 0.5, 0)).toBeNull();
    const w2 = new CollisionWorld();
    w2.addCircle(5, 5, 1, 8, 4); // pilar que empieza a 4 m
    expect(w2.resolveCircle({ x: 5, z: 5 }, 0.4, 0)).toBeNull();
    expect(w2.resolveCircle({ x: 5.2, z: 5 }, 0.4, 3)).not.toBeNull();
  });

  it('un muro (segmento) bloquea en su lado y no más allá de su extremo', () => {
    const w = new CollisionWorld();
    w.addSeg(0, 0, 10, 0, 3);
    const p = { x: 5, z: 0.2 };
    expect(w.resolveCircle(p, 0.5)).not.toBeNull();
    expect(Math.abs(p.z)).toBeGreaterThanOrEqual(0.49);
    expect(w.resolveCircle({ x: 12, z: 0 }, 0.5)).toBeNull();
  });

  it('los techos (quad) solo cuentan para la cámara', () => {
    const w = new CollisionWorld();
    w.add({ kind: 'quad', p: [0, 0, 10, 0, 10, 10, 0, 10], y0: 3, h: 3.3 });
    expect(w.resolveCircle({ x: 5, z: 5 }, 0.5, 0)).toBeNull();
    expect(w.pointBlocked(5, 3.1, 5)).toBe(true);
    expect(w.pointBlocked(5, 1.5, 5)).toBe(false);
    expect(w.pointBlocked(15, 3.1, 5)).toBe(false);
  });

  it('groundHeight se sube a las cajas bajas', () => {
    const w = new CollisionWorld();
    w.addBox(0, 0, 2, 2, 0.4);
    expect(w.groundHeight(1, 1, 0.2)).toBeCloseTo(0.4);
    expect(w.groundHeight(5, 5, 0.2)).toBe(0);
  });
});
