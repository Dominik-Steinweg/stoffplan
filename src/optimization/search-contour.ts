import { simplify, type Polygon } from '../geometry/kernel';

// A Minkowski sum creates one quadrilateral per input-edge pair. Feeding the
// display/validation mesh into it makes curved pairs prohibitively expensive.
// These bounded meshes generate candidates only; acceptance uses the original
// precise cutting contours in pairIssue/validate.
const MAX_SEARCH_VERTICES = 64;

export function searchContour(cut: Polygon[]): { polygons: Polygon[]; allowance: number } {
  if (cut.every((polygon) => polygon.length <= MAX_SEARCH_VERTICES)) {
    return { polygons: cut, allowance: 0 };
  }
  let tolerance = 0.01;
  for (;;) {
    const polygons = simplify(cut, tolerance);
    if (polygons.every((polygon) => polygon.length <= MAX_SEARCH_VERTICES)) {
      return { polygons, allowance: tolerance * 2 };
    }
    tolerance *= 2;
  }
}
