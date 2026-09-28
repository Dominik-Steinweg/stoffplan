import type {
  OptimizationRequest,
  OptimizationResult,
  PartDefinition,
  Placement,
  Point,
  LayoutStrategy,
} from '../domain/types';
import { instanceId } from '../domain/types';
import { minkowskiObstacle, offset, translate, union, type Polygon } from '../geometry/kernel';
import { EPS, shapeOf, type Shape } from '../geometry/contours';
import { fabricErrors, pairIssue, validate, type Located } from '../geometry/validation';
import { searchContour } from './search-contour';
import { VariantPool } from './variants';

interface Item {
  part: PartDefinition;
  id: string;
}
interface Prepared {
  shape: Shape;
  search: Polygon[];
  key: string;
  clearance: number;
  allowance: number;
}
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function randomGenerator(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clippedCandidates(
  polys: Polygon[],
  left: number,
  top: number,
  right: number,
  bottom: number,
): Point[] {
  const points: Point[] = [
    { x: left, y: top },
    { x: right, y: top },
  ];
  for (const poly of polys)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length];
      points.push(a);
      for (const x of [left, right])
        if (Math.abs(b.x - a.x) > EPS) {
          const t = (x - a.x) / (b.x - a.x);
          if (t >= 0 && t <= 1) points.push({ x, y: a.y + t * (b.y - a.y) });
        }
      for (const y of [top, bottom])
        if (Math.abs(b.y - a.y) > EPS) {
          const t = (y - a.y) / (b.y - a.y);
          if (t >= 0 && t <= 1) points.push({ y, x: a.x + t * (b.x - a.x) });
        }
    }
  const seen = new Set<string>();
  return points
    .filter((p) => {
      if (p.x < left - EPS || p.x > right + EPS || p.y < top - EPS || p.y > bottom + EPS)
        return false;
      const key = `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export async function optimize(
  request: OptimizationRequest,
  emit: (result: OptimizationResult) => void,
  stopped: () => boolean = () => false,
): Promise<OptimizationResult> {
  const { project } = request,
    started = performance.now(),
    random = randomGenerator(request.seed);
  const f = project.fabric;
  const expired = () => stopped() || performance.now() - started >= request.budgetMs;
  let iterations = 0;
  const pool = new VariantPool(project);
  const packResult = (placements: Placement[]): OptimizationResult => ({
    runId: request.runId,
    revision: request.revision,
    placements,
    report: validate(project, placements),
    iterations,
    elapsedMs: performance.now() - started,
    variants: pool.variants,
  });
  let best = packResult([]);
  if (fabricErrors(project).length) {
    emit(best);
    return best;
  }
  const prepared = new Map<string, Prepared>(),
    nfps = new Map<string, Polygon[]>();
  const prepare = (part: PartDefinition, flipped: boolean): Prepared => {
    const key = `${part.id}:${flipped}`;
    const old = prepared.get(key);
    if (old) return old;
    const shape = shapeOf(part, f.seam, flipped);
    const clearance = shape.curved ? 0.012 : 0;
    const { polygons: search, allowance } = searchContour(shape.cut);
    const value = { shape, search, key, clearance, allowance };
    prepared.set(key, value);
    return value;
  };
  const items: Item[] = [];
  for (const part of project.parts) {
    try {
      if (prepare(part, false).shape.width <= f.width - 2 * f.reserve + EPS)
        for (let i = 0; i < part.quantity; i++) items.push({ part, id: instanceId(part.id, i) });
    } catch {
      /* Invalid contours remain in the report and missing list. */
    }
  }
  const upperLength = items.reduce(
    (sum, item) => sum + prepare(item.part, false).shape.height + f.gap + 0.03,
    0,
  );
  const maxLength = f.mode === 'fixed' ? f.length : upperLength;
  const isBetter = (result: OptimizationResult) => {
    const errors = result.report.violations.filter(
      (v) => v.code !== 'width' && v.code !== 'contour',
    );
    if (errors.length) return false;
    return (
      result.report.placed > best.report.placed ||
      (result.report.placed === best.report.placed &&
        result.report.requiredLength < best.report.requiredLength - EPS)
    );
  };
  const consider = (placements: Placement[], strategy: LayoutStrategy = 'compact') => {
    const result = packResult(placements);
    const changed = pool.add(placements, strategy, result.report);
    const better = isBetter(result);
    if (better) {
      best = result;
    }
    if (better || changed) emit({ ...best, variants: pool.variants });
  };
  for (const variant of project.variants) {
    pool.add(
      variant.placements,
      variant.strategy,
      validate(project, variant.placements),
      variant.id,
    );
  }
  const current = validate(project);
  if (current.status === 'valid') pool.add(project.placements, 'compact', current);
  if (pool.variants.length) {
    best = packResult(pool.variants[0].placements);
    emit(best);
  }
  const stacked: Placement[] = [];
  let y = 0;
  for (const item of items) {
    const p = prepare(item.part, false);
    const margin = p.clearance;
    if (p.shape.width + 2 * margin > f.width - 2 * f.reserve + EPS) continue;
    if (y + p.shape.height + margin <= maxLength + EPS) {
      stacked.push({
        instanceId: item.id,
        partId: item.part.id,
        x: f.reserve + margin,
        y: y + margin,
        flipped: false,
      });
      y += p.shape.height + f.gap + margin * 2;
    }
  }
  consider(stacked);
  await pause();
  // Cheap shelf layouts deliberately leave straight cutting lanes between rows.
  const rows = (order: Item[], strategy: LayoutStrategy) => {
    if (strategy === 'grouped')
      order = [...order].sort((a, b) => a.part.id.localeCompare(b.part.id));
    const placements: Placement[] = [];
    let x = f.reserve,
      top = 0,
      rowHeight = 0,
      previous = '';
    for (const item of order) {
      const p = prepare(item.part, false),
        margin = p.clearance;
      const width = p.shape.width + 2 * margin,
        height = p.shape.height + 2 * margin;
      if (width > f.width - 2 * f.reserve + EPS) continue;
      if (
        x > f.reserve &&
        (x + width > f.width - f.reserve + EPS ||
          (strategy === 'grouped' && previous !== item.part.id))
      ) {
        top += rowHeight + f.gap;
        x = f.reserve;
        rowHeight = 0;
      }
      if (top + height > maxLength + EPS) continue;
      placements.push({
        instanceId: item.id,
        partId: item.part.id,
        x: x + margin,
        y: top + margin,
        flipped: false,
      });
      x += width + f.gap;
      rowHeight = Math.max(rowHeight, height);
      previous = item.part.id;
    }
    consider(placements, strategy);
  };
  rows(
    [...items].sort(
      (a, b) => prepare(b.part, false).shape.height - prepare(a.part, false).shape.height,
    ),
    'rows',
  );
  rows(items, 'grouped');
  await pause();
  const obstacle = (a: Prepared, b: Prepared): Polygon[] => {
    const key = `${a.key}/${b.key}`;
    const old = nfps.get(key);
    if (old) return old;
    // Inflate the combined obstacle once, instead of both inputs before the
    // Minkowski sum. Otherwise the round offset multiplies the edge-pair count.
    const raw = union(
      a.search.flatMap((pa) => b.search.flatMap((pb) => minkowskiObstacle(pa, pb))),
    );
    const polys = offset(raw, f.gap + a.clearance + b.clearance + a.allowance + b.allowance, true);
    nfps.set(key, polys);
    return polys;
  };
  while (!expired() && items.length) {
    const order = [...items];
    if (iterations === 0)
      order.sort((a, b) => {
        const aa = prepare(a.part, false).shape,
          bb = prepare(b.part, false).shape;
        return bb.width * bb.height - aa.width * aa.height;
      });
    else if (iterations === 1)
      order.sort(
        (a, b) => prepare(b.part, false).shape.height - prepare(a.part, false).shape.height,
      );
    else
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    const placed: (Located & { prepared: Prepared })[] = [];
    for (const item of order) {
      if (expired()) break;
      let choice: (Located & { prepared: Prepared }) | undefined;
      let score = Infinity;
      for (const flipped of iterations > 1 && random() < 0.5 ? [true, false] : [false, true]) {
        if (expired()) break;
        const p = prepare(item.part, flipped),
          s = p.shape,
          r = f.reserve + p.clearance;
        if (s.width > f.width - 2 * r + EPS) continue;
        const obstacles: Polygon[] = [];
        for (const a of placed) {
          if (expired()) break;
          obstacles.push(...translate(obstacle(a.prepared, p), a.placement.x, a.placement.y));
        }
        if (expired()) break;
        const merged = obstacles.length ? union(obstacles) : [];
        const candidates = clippedCandidates(
          merged,
          r,
          p.clearance,
          f.width - r - s.width,
          maxLength - p.clearance - s.height,
        );
        for (const point of candidates) {
          if (expired()) break;
          const placement = {
            instanceId: item.id,
            partId: item.part.id,
            x: point.x,
            y: point.y,
            flipped,
          };
          const located = {
            placement,
            shape: s,
            polygons: translate(s.cut, point.x, point.y),
            prepared: p,
          };
          if (placed.some((a) => expired() || pairIssue(a, located, f.gap))) continue;
          const length = Math.max(
            point.y + s.height,
            ...placed.map((a) => a.placement.y + a.shape.height),
            0,
          );
          const cost = length * (f.width + 1) + point.y + point.x / (f.width + 1);
          if (cost < score) {
            score = cost;
            choice = located;
          }
          break;
        }
      }
      if (choice) placed.push(choice);
      await pause();
    }
    iterations++;
    consider(placed.map((p) => p.placement));
    if (iterations > 1 && iterations % 3 === 0 && !expired())
      rows(order, iterations % 2 ? 'rows' : 'grouped');
    // Repeated identical instances have no useful ordering permutations.
    if (
      items.every((item) => item.part.id === items[0]?.part.id) &&
      iterations >= 2 &&
      best.report.status === 'valid'
    )
      break;
    await pause();
  }
  best = { ...best, variants: pool.variants, iterations, elapsedMs: performance.now() - started };
  emit(best);
  return best;
}
