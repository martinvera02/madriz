/**
 * Acumulador de números en un Float32Array que crece solo. Sustituye a `number[]` al construir geometrías
 * grandes: un número en un array normal ocupa ~8 bytes más el margen de crecimiento (16–24 en total), aquí 4.
 * Con 36.000 edificios la diferencia son gigas de memoria temporal durante la carga.
 */
export class F32 {
  private a: Float32Array;
  length = 0;
  constructor(capacity = 1024) { this.a = new Float32Array(capacity); }
  private grow(need: number) {
    let cap = this.a.length;
    while (cap < need) cap = Math.ceil(cap * 1.6);
    const b = new Float32Array(cap);
    b.set(this.a.subarray(0, this.length));
    this.a = b;
  }
  push(...v: number[]) {
    const n = this.length + v.length;
    if (n > this.a.length) this.grow(n);
    for (let i = 0; i < v.length; i++) this.a[this.length + i] = v[i];
    this.length = n;
    return n;
  }
  /** Versiones sin argumentos variables (más rápidas en los bucles calientes). */
  push2(a: number, b: number) { if (this.length + 2 > this.a.length) this.grow(this.length + 2); this.a[this.length++] = a; this.a[this.length++] = b; }
  push3(a: number, b: number, c: number) { if (this.length + 3 > this.a.length) this.grow(this.length + 3); this.a[this.length++] = a; this.a[this.length++] = b; this.a[this.length++] = c; }
  /** Copia ajustada al tamaño final (el búfer de trabajo se puede soltar después). */
  toArray() { return this.a.slice(0, this.length); }
}
