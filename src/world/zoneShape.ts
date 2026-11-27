/**
 * Forma del mapa: una zona puede ser la unión de varios rectángulos (el centro y el norte, de momento).
 * Fuera de la unión no hay datos, así que se cierra con muros invisibles.
 */

export interface Box { x0: number; x1: number; z0: number; z1: number }

/** ¿El punto está dentro de alguno de los rectángulos? */
export function inZone(boxes: Box[], x: number, z: number) {
  return boxes.some((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);
}

/**
 * Rectángulos del envoltorio que quedan fuera de la unión: se parte el envoltorio por todos los bordes de los
 * rectángulos y se devuelven las celdas cuyo centro no cae en ninguno (unidas por filas para que sean pocas).
 */
export function outsideCells(boxes: Box[], bounds: Box): Box[] {
  const xs = [...new Set([bounds.x0, bounds.x1, ...boxes.flatMap((b) => [b.x0, b.x1])])].sort((a, b) => a - b);
  const zs = [...new Set([bounds.z0, bounds.z1, ...boxes.flatMap((b) => [b.z0, b.z1])])].sort((a, b) => a - b);
  const out: Box[] = [];
  for (let j = 0; j + 1 < zs.length; j++) {
    let run: Box | null = null;
    for (let i = 0; i + 1 < xs.length; i++) {
      const c = { x0: xs[i], x1: xs[i + 1], z0: zs[j], z1: zs[j + 1] };
      const empty = !inZone(boxes, (c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2);
      if (empty && run) run.x1 = c.x1;
      else if (empty) run = c;
      else if (run) { out.push(run); run = null; }
    }
    if (run) out.push(run);
  }
  return out;
}
