import factory from 'clipper2-wasm/dist/es/clipper2z.js';
import wasmUrl from 'clipper2-wasm/dist/es/clipper2z.wasm?url';
import type { MainModule, PathsD } from 'clipper2-wasm/dist/clipper2z';
import type { Point } from '../domain/types';

export type Polygon = Point[];
let clipper: MainModule;
let loading: Promise<void> | undefined;
export function initGeometry(binary?: Uint8Array): Promise<void> {
  return (loading ??= factory({
    locateFile: () => wasmUrl,
    ...(binary ? { wasmBinary: new Uint8Array(binary).buffer } : {}),
  }).then((m) => {
    clipper = m;
  }));
}
export function geometryReady() {
  return !!clipper;
}
const PRECISION = 6;
function input(polys: Polygon[]): PathsD {
  if (!clipper) throw new Error('Geometrie wird noch geladen.');
  const paths = new clipper.PathsD();
  for (const poly of polys) {
    const path = clipper.MakePathD(poly.flatMap((p) => [p.x, p.y]));
    paths.push_back(path);
    path.delete();
  }
  return paths;
}
function output(paths: PathsD): Polygon[] {
  const result: Polygon[] = [];
  try {
    for (let i = 0; i < paths.size(); i++) {
      const path = paths.get(i);
      try {
        const poly: Polygon = [];
        for (let j = 0; j < path.size(); j++) {
          const p = path.get(j);
          poly.push({ x: p.x, y: p.y });
          p.delete();
        }
        result.push(poly);
      } finally {
        path.delete();
      }
    }
    return result;
  } finally {
    paths.delete();
  }
}
export function offset(
  polys: Polygon[],
  delta: number,
  round = false,
  arcTolerance = 0.001,
): Polygon[] {
  if (!delta) return polys.map((p) => p.map((v) => ({ ...v })));
  const paths = input(polys);
  try {
    return output(
      clipper.InflatePathsD(
        paths,
        delta,
        round ? clipper.JoinType.Round : clipper.JoinType.Miter,
        clipper.EndType.Polygon,
        2,
        PRECISION,
        arcTolerance,
      ),
    );
  } finally {
    paths.delete();
  }
}
export function union(polys: Polygon[]): Polygon[] {
  const paths = input(polys);
  try {
    return output(clipper.UnionSelfD(paths, clipper.FillRule.NonZero, PRECISION));
  } finally {
    paths.delete();
  }
}
export function simplify(polys: Polygon[], tolerance: number): Polygon[] {
  const paths = input(polys);
  try {
    return output(clipper.SimplifyPathsD(paths, tolerance, true));
  } finally {
    paths.delete();
  }
}
export function intersection(a: Polygon[], b: Polygon[]): Polygon[] {
  const aa = input(a),
    bb = input(b);
  try {
    return output(clipper.IntersectD(aa, bb, clipper.FillRule.NonZero, PRECISION));
  } finally {
    aa.delete();
    bb.delete();
  }
}
export function difference(a: Polygon[], b: Polygon[]): Polygon[] {
  const aa = input(a),
    bb = input(b);
  try {
    return output(clipper.DifferenceD(aa, bb, clipper.FillRule.NonZero, PRECISION));
  } finally {
    aa.delete();
    bb.delete();
  }
}
export function minkowskiObstacle(a: Polygon, b: Polygon): Polygon[] {
  const reflected = positive(b.map((p) => ({ x: -p.x, y: -p.y })));
  const aa = clipper.MakePathD(a.flatMap((p) => [p.x, p.y])),
    bb = clipper.MakePathD(reflected.flatMap((p) => [p.x, p.y]));
  try {
    const swept = output(clipper.MinkowskiSumD(bb, aa, true, PRECISION));
    // Clipper sums the boundaries. These filled translations also cover containment,
    // while preserving genuine holes in the configuration-space obstacle.
    return union([
      ...swept,
      ...translate([a], reflected[0].x, reflected[0].y),
      ...translate([reflected], a[0].x, a[0].y),
    ]);
  } finally {
    aa.delete();
    bb.delete();
  }
}
export function area(p: Polygon): number {
  return (
    p.reduce((a, v, i) => {
      const w = p[(i + 1) % p.length];
      return a + v.x * w.y - w.x * v.y;
    }, 0) / 2
  );
}
export function positive(p: Polygon): Polygon {
  return area(p) < 0 ? [...p].reverse() : p;
}
export function bounds(polys: Polygon[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const poly of polys)
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
export const translate = (polys: Polygon[], x: number, y: number) =>
  polys.map((poly) => poly.map((p) => ({ x: p.x + x, y: p.y + y })));
export const polygonPath = (polys: Polygon[]) =>
  polys.map((p) => (p.length ? `M${p.map((v) => `${v.x},${v.y}`).join('L')}Z` : '')).join(' ');
