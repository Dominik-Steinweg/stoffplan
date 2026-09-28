import type { Contour, PathNode } from '../domain/types';

/** 32 cubic arcs keep radial error below 0.002 mm even at the maximum radius. */
export function toFreeContour(contour: Contour): Contour {
  if (!contour.primitive) return structuredClone(contour);
  const { center: c, rx, ry } = contour.primitive;
  const count = 32,
    step = (2 * Math.PI) / count,
    k = (4 / 3) * Math.tan(step / 4);
  const nodes: PathNode[] = Array.from({ length: count }, (_, i) => {
    const a = i * step,
      x = c.x + rx * Math.cos(a),
      y = c.y + ry * Math.sin(a);
    const dx = -rx * Math.sin(a) * k,
      dy = ry * Math.cos(a) * k;
    return { x, y, in: { x: x - dx, y: y - dy }, out: { x: x + dx, y: y + dy } };
  });
  return { closed: true, nodes };
}
