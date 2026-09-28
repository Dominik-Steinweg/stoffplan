import type { Contour, PartDefinition, Point } from '../domain/types';
import { area, bounds, offset, positive, translate, type Polygon } from './kernel';

export const EPS = 0.000002;
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const length2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = length2
    ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length2))
    : 0;
  return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
}
function cubic(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tolerance: number,
  points: Point[],
  depth = 0,
) {
  if (Math.max(pointSegmentDistance(b, a, d), pointSegmentDistance(c, a, d)) <= tolerance) {
    points.push(d);
    return;
  }
  if (depth >= 22 || points.length > 12000)
    throw new Error('Die Kurve ist zu komplex. Bitte die Kontrollpunkte vereinfachen.');
  const ab = mid(a, b),
    bc = mid(b, c),
    cd = mid(c, d),
    abc = mid(ab, bc),
    bcd = mid(bc, cd),
    center = mid(abc, bcd);
  cubic(a, ab, abc, center, tolerance, points, depth + 1);
  cubic(center, bcd, cd, d, tolerance, points, depth + 1);
}
export function flatten(contour: Contour, tolerance = 0.002): Polygon {
  if (contour.primitive) {
    const { center, rx, ry } = contour.primitive;
    const radius = Math.max(rx, ry);
    // The second derivative bound limits every chord's deviation to tolerance.
    const count = Math.max(
      12,
      Math.ceil((Math.PI * 2) / Math.sqrt((8 * tolerance) / radius) / 4) * 4,
    );
    if (count > 12000)
      throw new Error('Die Rundung ist für diese Genauigkeit zu groß. Bitte die Maße verkleinern.');
    return Array.from({ length: count }, (_, i) => {
      const a = (i * Math.PI * 2) / count;
      return { x: center.x + rx * Math.cos(a), y: center.y + ry * Math.sin(a) };
    });
  }
  if (!contour.nodes.length) return [];
  const points: Point[] = [{ x: contour.nodes[0].x, y: contour.nodes[0].y }];
  const count = contour.closed ? contour.nodes.length : contour.nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const a = contour.nodes[i],
      b = contour.nodes[(i + 1) % contour.nodes.length];
    if (a.out || b.in) cubic(a, a.out || a, b.in || b, b, tolerance, points);
    else points.push({ x: b.x, y: b.y });
  }
  if (contour.closed) points.pop();
  return points;
}
export function contourPath(contour: Contour): string {
  if (contour.primitive) {
    const { center: c, rx, ry } = contour.primitive;
    return `M${c.x + rx},${c.y}A${rx},${ry} 0 1 1 ${c.x - rx},${c.y}A${rx},${ry} 0 1 1 ${c.x + rx},${c.y}Z`;
  }
  if (!contour.nodes.length) return '';
  let d = `M${contour.nodes[0].x},${contour.nodes[0].y}`;
  for (let i = 0; i < contour.nodes.length - (contour.closed ? 0 : 1); i++) {
    const a = contour.nodes[i],
      b = contour.nodes[(i + 1) % contour.nodes.length];
    d +=
      a.out || b.in
        ? `C${(a.out || a).x},${(a.out || a).y} ${(b.in || b).x},${(b.in || b).y} ${b.x},${b.y}`
        : `L${b.x},${b.y}`;
  }
  return d + (contour.closed ? 'Z' : '');
}
export function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  if (
    Math.max(a.x, b.x) + EPS < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) + EPS < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) + EPS < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) + EPS < Math.min(a.y, b.y)
  )
    return false;
  const x1 = cross(a, b, c),
    x2 = cross(a, b, d),
    x3 = cross(c, d, a),
    x4 = cross(c, d, b);
  if (
    ((x1 > EPS && x2 < -EPS) || (x1 < -EPS && x2 > EPS)) &&
    ((x3 > EPS && x4 < -EPS) || (x3 < -EPS && x4 > EPS))
  )
    return true;
  return (
    Math.min(
      pointSegmentDistance(a, c, d),
      pointSegmentDistance(b, c, d),
      pointSegmentDistance(c, a, b),
      pointSegmentDistance(d, a, b),
    ) < EPS
  );
}
export function contourError(contour: Contour, polygon = flatten(contour)): string | null {
  if (contour.primitive) {
    const { rx, ry } = contour.primitive;
    return rx > 0 && ry > 0 ? null : 'Die Rundung benötigt positive Maße.';
  }
  if (!contour.closed) return 'Der Umriss ist noch offen.';
  if (polygon.length < 3) return 'Mindestens drei Punkte sind erforderlich.';
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < EPS)
      return 'Zwei aufeinanderfolgende Punkte liegen aufeinander.';
    for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue;
      if (segmentsTouch(a, b, polygon[j], polygon[(j + 1) % polygon.length]))
        return 'Der Umriss überschneidet oder berührt sich selbst.';
    }
  }
  if (Math.abs(area(polygon)) < 0.000001) return 'Die Form hat keine ausreichende Fläche.';
  return null;
}

export interface Shape {
  base: Polygon;
  cut: Polygon[];
  width: number;
  height: number;
  grain: { start: Point; end: Point };
  curved: boolean;
  error: number;
  origin: Point;
}
const cache = new Map<string, Shape>();
export function shapeOf(
  part: PartDefinition,
  seam: number,
  flipped = false,
  tolerance = 0.002,
): Shape {
  const key = JSON.stringify([part.contour, part.grain, part.direction, seam, flipped, tolerance]);
  const cached = cache.get(key);
  if (cached) return cached;
  const raw = flatten(part.contour, tolerance),
    error = contourError(part.contour, raw);
  if (error) throw new Error(error);
  const dx = part.grain.end.x - part.grain.start.x,
    dy = part.grain.end.y - part.grain.start.y;
  if (Math.hypot(dx, dy) < EPS) throw new Error('Die Bezugslinie muss eine Richtung haben.');
  const angle =
    (part.direction === 'straight' ? Math.PI / 2 : 0) -
    Math.atan2(dy, dx) +
    (flipped ? Math.PI : 0);
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const rotate = (p: Point): Point => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
  const base = positive(raw.map(rotate));
  // A single exterior is cut. Interior rings created by offsetting are filled, never used as cut-outs.
  const cut = offset([base], seam).filter((p) => area(p) > 0);
  if (!cut.length) throw new Error('Die Zuschneidekontur konnte nicht erzeugt werden.');
  const b = bounds(cut);
  const move = (p: Point) => ({ x: p.x - b.minX, y: p.y - b.minY });
  const curved = !!part.contour.primitive || part.contour.nodes.some((n) => n.in || n.out);
  const shape: Shape = {
    base: base.map(move),
    cut: translate(cut, -b.minX, -b.minY),
    width: b.width,
    height: b.height,
    grain: { start: move(rotate(part.grain.start)), end: move(rotate(part.grain.end)) },
    curved,
    error: curved ? tolerance * 4 + EPS : EPS,
    origin: { x: b.minX, y: b.minY },
  };
  if (cache.size > 500) cache.clear();
  cache.set(key, shape);
  return shape;
}

export function polygonDistance(a: Polygon[], b: Polygon[]): number {
  let distance = Infinity;
  for (const p of a)
    for (const q of b)
      for (let i = 0; i < p.length; i++)
        for (let j = 0; j < q.length; j++) {
          const aa = p[i],
            ab = p[(i + 1) % p.length],
            ba = q[j],
            bb = q[(j + 1) % q.length];
          if (segmentsTouch(aa, ab, ba, bb)) return 0;
          distance = Math.min(
            distance,
            pointSegmentDistance(aa, ba, bb),
            pointSegmentDistance(ab, ba, bb),
            pointSegmentDistance(ba, aa, ab),
            pointSegmentDistance(bb, aa, ab),
          );
        }
  return distance;
}
