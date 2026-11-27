import { describe, it, expect } from 'vitest';
import { F32 } from '../src/world/f32';

describe('F32', () => {
  it('crece y conserva el orden', () => {
    const f = new F32(2);
    for (let i = 0; i < 1000; i++) f.push3(i, i + 0.5, -i);
    f.push2(7, 8); f.push(1, 2, 3, 4);
    const a = f.toArray();
    expect(a.length).toBe(3006);
    expect([a[0], a[1], a[2], a[2997], a[3000], a[3005]]).toEqual([0, 0.5, -0, 999, 7, 4]);
    expect(a).toBeInstanceOf(Float32Array);
  });
});
