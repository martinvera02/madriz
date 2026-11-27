/**
 * Coberturas: pegarse a un muro, un coche o un pretil para que no te den.
 *
 * Se busca lo sólido más cercano alrededor del jugador (16 direcciones, hasta 1,5 m) a la altura de la
 * cintura. Si a la altura de la cabeza no hay nada, es una cobertura baja: agachado no te ven, y al apuntar
 * te asomas por encima. Si es alta (una pared), al apuntar te asomas por el lado.
 */

export interface Cover {
  /** Normal de la cobertura, hacia fuera (hacia donde está el jugador). */
  nx: number; nz: number;
  /** Punto de la superficie de la cobertura. */
  x: number; z: number;
  /** Baja (un coche, un murete): se dispara por encima. */
  low: boolean;
}

/** ¿Hay algo sólido en (x, y, z)? Muros, cajas y coches. */
export type Solid = (x: number, y: number, z: number) => boolean;

const DIRS = 16;
const REACH = 1.5;

/**
 * La cobertura más cercana a (x, z) con el suelo a `y`, o null si no hay nada a menos de REACH m.
 * La normal es la media de las direcciones que tocan a la distancia mínima (±12 cm): en un muro recto sale
 * perpendicular aunque solo se pruebe cada 22,5º.
 */
export function findCover(solid: Solid, x: number, y: number, z: number): Cover | null {
  const hits: { dx: number; dz: number; r: number }[] = [];
  for (let k = 0; k < DIRS; k++) {
    const a = (k / DIRS) * Math.PI * 2;
    const dx = Math.sin(a), dz = Math.cos(a);
    for (let r = 0.25; r <= REACH; r += 0.05) {
      if (!solid(x + dx * r, y + 0.8, z + dz * r)) continue;
      hits.push({ dx, dz, r });
      break;
    }
  }
  if (!hits.length) return null;
  const bd = Math.min(...hits.map((h) => h.r));
  let sx = 0, sz = 0;
  for (const h of hits) if (h.r <= bd + 0.12) { const w = 1 / h.r; sx += h.dx * w; sz += h.dz * w; }
  const l = Math.hypot(sx, sz) || 1;
  const dx = sx / l, dz = sz / l;
  // distancia a la superficie en esa dirección
  let r = 0.2;
  while (r < REACH + 0.2 && !solid(x + dx * r, y + 0.8, z + dz * r)) r += 0.03;
  const px = x + dx * r, pz = z + dz * r;
  // baja si a la altura de la cabeza agachada (1,45 m) ya no hay nada un poco más adentro
  const low = !solid(px + dx * 0.15, y + 1.45, pz + dz * 0.15);
  return { nx: -dx, nz: -dz, x: px, z: pz, low };
}

/**
 * ¿La cobertura te protege de un disparo que viene de `from`? Solo si el tirador está al otro lado
 * (más allá de la superficie) y no te estás asomando a apuntar.
 */
export function shielded(c: Cover, hidden: boolean, fromX: number, fromZ: number): boolean {
  if (!hidden) return false;
  const dx = fromX - c.x, dz = fromZ - c.z;
  const d = Math.hypot(dx, dz) || 1;
  return (dx * c.nx + dz * c.nz) / d < -0.2;
}

/** Desplazamiento lateral a lo largo de la cobertura (derecha según la normal) para un eje -1..1. */
export function alongCover(c: Cover, axis: number): [number, number] {
  // tangente: normal girada 90º
  return [-c.nz * axis, c.nx * axis];
}
