import type { Placement, Point, Project } from '../domain/types';
import { EPS, shapeOf } from './contours';
import { area, bounds, intersection, offset, translate, type Polygon } from './kernel';
import { fabricErrors, pairIssue, type Located } from './validation';

export const MAGNET_RADIUS_PX = 12;
type Segment = { a: Point; b: Point };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Prepare once per drag. Only the moving instance is checked, so unrelated
 * existing errors do not prevent fixing a layout. Contacts use cutting contours,
 * including seam allowance, and never change a piece's rotation. */
export function createMagneticSnap(project: Project, placement: Placement) {
  const locate = (p: Placement): Located => {
    const part = project.parts.find((part) => part.id === p.partId);
    if (!part) throw new Error('Schnittteil fehlt.');
    const shape = shapeOf(part, project.fabric.seam, p.rotation);
    return { placement: p, shape, polygons: translate(shape.cut, p.x, p.y) };
  };
  const moving = locate(placement),
    shape = moving.shape;
  const neighbors = project.placements
    .filter((p) => p.instanceId !== placement.instanceId)
    .map((p) => {
      const located = locate(p);
      return { located, box: bounds(located.polygons) };
    });
  const f = project.fabric,
    clearance = shape.curved ? shape.error : 0;
  const limits = {
    left: f.reserve + clearance,
    right: f.width - f.reserve - shape.width - clearance,
    top: clearance,
    bottom: f.mode === 'fixed' ? f.length - shape.height - clearance : Infinity,
  };
  const usable =
    !fabricErrors(project).length && limits.left <= limits.right && limits.top <= limits.bottom;
  const canPlace = (point: Point) => {
    if (
      !usable ||
      point.x < limits.left - EPS ||
      point.x > limits.right + EPS ||
      point.y < limits.top - EPS ||
      point.y > limits.bottom + EPS
    )
      return false;
    const located = {
      ...moving,
      placement: { ...placement, ...point },
      polygons: translate(shape.cut, point.x, point.y),
    };
    return neighbors.every(({ located: neighbor }) => !pairIssue(located, neighbor, f.gap));
  };

  let coreRadius = -1;
  let core: Polygon[] = [];
  return (
    target: Point,
    fallback: Point,
    radius: number,
  ): { point: Point; snapped: boolean } | null => {
    if (!usable) return null;
    // A point inside the moving contour by more than the capture radius remains
    // covered under every candidate translation. If a neighbor occupies that
    // inner core, no local snap can resolve the overlap. Avoid enumerating a
    // large number of impossible curve contacts in this common drag case.
    if (coreRadius !== radius) {
      coreRadius = radius;
      core = offset(shape.cut, -radius - 0.01, true);
    }
    if (
      core.length &&
      neighbors.some(
        ({ located, box }) =>
          target.x + shape.width > box.minX &&
          target.x < box.maxX &&
          target.y + shape.height > box.minY &&
          target.y < box.maxY &&
          intersection(translate(core, target.x, target.y), located.polygons).some(
            (polygon) => area(polygon) > EPS,
          ),
      )
    )
      return canPlace(fallback) ? { point: fallback, snapped: false } : null;
    const candidates = new Map<string, Point>(),
      segments: Segment[] = [];
    const key = (p: Point) => Math.round(p.x * 1e6) + ',' + Math.round(p.y * 1e6);
    const add = (p: Point) => {
      if (distance(p, target) <= radius + EPS) candidates.set(key(p), p);
    };
    // Clip contact loci to fabric limits before projecting the pointer onto them.
    const addSegment = (a: Point, b: Point) => {
      const dx = b.x - a.x,
        dy = b.y - a.y;
      let low = 0,
        high = 1;
      for (const [start, delta, min, max] of [
        [a.x, dx, limits.left, limits.right],
        [a.y, dy, limits.top, limits.bottom],
      ]) {
        if (Math.abs(delta) < 1e-12) {
          if (start < min - EPS || start > max + EPS) return;
        } else {
          const t1 = (min - start) / delta,
            t2 = (max - start) / delta;
          low = Math.max(low, Math.min(t1, t2));
          high = Math.min(high, Math.max(t1, t2));
          if (low > high) return;
        }
      }
      const norm = dx * dx + dy * dy;
      const t = norm
        ? Math.max(low, Math.min(high, ((target.x - a.x) * dx + (target.y - a.y) * dy) / norm))
        : low;
      const nearest = { x: a.x + t * dx, y: a.y + t * dy };
      if (distance(nearest, target) > radius + EPS) return;
      const start = { x: a.x + low * dx, y: a.y + low * dy },
        end = { x: a.x + high * dx, y: a.y + high * dy };
      segments.push({ a: start, b: end });
      add(nearest);
      add(start);
      add(end);
    };
    const contacts = (vertex: Point, a: Point, b: Point, gap: number, reverse: boolean) => {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      if (!length) return;
      for (const sign of gap ? [-1, 1] : [0]) {
        const nx = (-dy / length) * gap * sign,
          ny = (dx / length) * gap * sign;
        const direction = reverse ? -1 : 1;
        addSegment(
          { x: (a.x - vertex.x) * direction + nx, y: (a.y - vertex.y) * direction + ny },
          { x: (b.x - vertex.x) * direction + nx, y: (b.y - vertex.y) * direction + ny },
        );
      }
    };
    for (const { located: neighbor, box } of neighbors) {
      // Conservative curve clearance matches the collision check's error envelope.
      const gap = f.gap + clearance + (neighbor.shape.curved ? neighbor.shape.error : 0);
      const reach = radius + gap;
      if (
        target.x + shape.width + reach < box.minX ||
        target.x - reach > box.maxX ||
        target.y + shape.height + reach < box.minY ||
        target.y - reach > box.maxY
      )
        continue;
      for (const movingPoly of shape.cut)
        for (const stationaryPoly of neighbor.polygons) {
          for (const vertex of movingPoly)
            for (let i = 0; i < stationaryPoly.length; i++) {
              const a = stationaryPoly[i],
                b = stationaryPoly[(i + 1) % stationaryPoly.length];
              contacts(vertex, a, b, gap, false);
              // Round corner contacts: shortest displacement onto the gap circle.
              if (gap) {
                const center = { x: a.x - vertex.x, y: a.y - vertex.y };
                const dx = target.x - center.x,
                  dy = target.y - center.y,
                  length = Math.hypot(dx, dy);
                if (length)
                  add({ x: center.x + (dx * gap) / length, y: center.y + (dy * gap) / length });
              }
            }
          for (const vertex of stationaryPoly)
            for (let i = 0; i < movingPoly.length; i++)
              contacts(vertex, movingPoly[i], movingPoly[(i + 1) % movingPoly.length], gap, true);
        }
    }
    const nearestValid = () =>
      [...candidates.values()]
        .sort((a, b) => distance(a, target) - distance(b, target))
        .find(canPlace);
    let point = nearestValid();
    const bestDistance = point ? distance(point, target) : Infinity;
    if (!point || [...candidates.values()].some((p) => distance(p, target) < bestDistance - EPS)) {
      // If one edge contact is blocked by another neighbor, try simultaneous
      // contacts at intersections of the nearby contact segments.
      candidates.clear();
      if (point) add(point);
      for (let i = 0; i < segments.length; i++)
        for (let j = i + 1; j < segments.length; j++) {
          const a = segments[i],
            b = segments[j];
          const ax = a.b.x - a.a.x,
            ay = a.b.y - a.a.y,
            bx = b.b.x - b.a.x,
            by = b.b.y - b.a.y;
          const determinant = ax * by - ay * bx;
          if (Math.abs(determinant) < 1e-12) continue;
          const dx = b.a.x - a.a.x,
            dy = b.a.y - a.a.y;
          const t = (dx * by - dy * bx) / determinant,
            u = (dx * ay - dy * ax) / determinant;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) add({ x: a.a.x + t * ax, y: a.a.y + t * ay });
        }
      point = nearestValid();
    }
    if (point) return { point, snapped: true };
    return canPlace(fallback) ? { point: fallback, snapped: false } : null;
  };
}
