import type { Placement, Project, ValidationReport, Violation } from '../domain/types';
import { allowedRotations, instanceId } from '../domain/types';
import { area, bounds, intersection, translate, type Polygon } from './kernel';
import { EPS, polygonDistance, shapeOf, type Shape } from './contours';

export function fabricErrors(project: Project): string[] {
  const f = project.fabric,
    errors: string[] = [];
  if (!(f.width > 0)) errors.push('Bitte eine Stoffbreite größer als 0 eingeben.');
  if (f.reserve * 2 >= f.width)
    errors.push('Nach Abzug der Randreserven bleibt keine Stoffbreite übrig.');
  if (f.mode === 'fixed' && f.length <= 0) errors.push('Die Stofflänge muss größer als 0 sein.');
  return errors;
}
export interface Located {
  placement: Placement;
  shape: Shape;
  polygons: Polygon[];
}
export function pairIssue(a: Located, b: Located, gap: number): string | null {
  const ba = bounds(a.polygons),
    bb = bounds(b.polygons),
    uncertainty = (a.shape.curved ? a.shape.error : 0) + (b.shape.curved ? b.shape.error : 0);
  if (
    ba.maxX + gap + uncertainty < bb.minX ||
    bb.maxX + gap + uncertainty < ba.minX ||
    ba.maxY + gap + uncertainty < bb.minY ||
    bb.maxY + gap + uncertainty < ba.minY
  )
    return null;
  const overlap = Math.abs(
    intersection(a.polygons, b.polygons).reduce((sum, p) => sum + area(p), 0),
  );
  if (overlap > 1e-8) return 'overlap';
  if (gap > 0 || uncertainty) {
    const distance = polygonDistance(a.polygons, b.polygons);
    if (distance < gap - EPS) return 'gap';
    if (uncertainty && distance < gap + uncertainty - EPS) return 'uncertain';
  }
  return null;
}
function boundaryIssue(located: Located, project: Project): 'boundary' | 'uncertain' | null {
  const { reserve: r, width, length, mode } = project.fabric;
  const b = bounds(located.polygons);
  const clearance = Math.min(
    b.minX - r,
    b.minY,
    width - r - b.maxX,
    mode === 'fixed' ? length - b.maxY : Infinity,
  );
  if (clearance < -EPS) return 'boundary';
  return located.shape.curved && clearance < located.shape.error - EPS ? 'uncertain' : null;
}
function refine(loc: Located, project: Project): Located {
  const part = project.parts.find((p) => p.id === loc.placement.partId)!;
  const refined = shapeOf(part, project.fabric.seam, loc.placement.rotation, 0.00005);
  return {
    ...loc,
    shape: refined,
    polygons: translate(
      refined.cut,
      loc.placement.x + refined.origin.x - loc.shape.origin.x,
      loc.placement.y + refined.origin.y - loc.shape.origin.y,
    ),
  };
}

export function validate(project: Project, placements = project.placements): ValidationReport {
  const violations: Violation[] = fabricErrors(project).map((message) => ({
    code: 'fabric',
    message,
    instanceIds: [],
  }));
  const required = project.parts.reduce((sum, p) => sum + p.quantity, 0);
  const expected = new Map(
    project.parts.flatMap((p) =>
      Array.from({ length: p.quantity }, (_, i) => [instanceId(p.id, i), p.id] as const),
    ),
  );
  const seen = new Set<string>(),
    located: Located[] = [];
  const invalidParts = new Set<string>();
  for (const part of project.parts) {
    try {
      const shapes = allowedRotations(part).map((rotation) =>
        shapeOf(part, project.fabric.seam, rotation),
      );
      if (
        shapes.every(
          (shape) =>
            shape.width - (shape.curved ? 2 * shape.error : 0) >
            project.fabric.width - 2 * project.fabric.reserve + EPS,
        )
      )
        violations.push({
          code: 'width',
          message: `„${part.name}“ ist einschließlich Nahtzugabe breiter als die nutzbare Stoffbahn.`,
          partId: part.id,
          instanceIds: placements.filter((p) => p.partId === part.id).map((p) => p.instanceId),
        });
    } catch (error) {
      invalidParts.add(part.id);
      violations.push({
        code: 'contour',
        message: `${part.name}: ${(error as Error).message}`,
        partId: part.id,
        instanceIds: placements.filter((p) => p.partId === part.id).map((p) => p.instanceId),
      });
    }
  }
  for (const placement of placements) {
    if (seen.has(placement.instanceId) || expected.get(placement.instanceId) !== placement.partId) {
      violations.push({
        code: 'instance',
        message: 'Ein Exemplar ist doppelt oder gehört nicht zur Teileliste.',
        instanceIds: [placement.instanceId],
      });
      continue;
    }
    seen.add(placement.instanceId);
    if (invalidParts.has(placement.partId)) continue;
    const part = project.parts.find((p) => p.id === placement.partId)!;
    if (!allowedRotations(part).includes(placement.rotation)) {
      violations.push({
        code: 'rotation',
        message: 'Unzulässige Drehung für diese Stoffrichtung.',
        instanceIds: [placement.instanceId],
      });
      continue;
    }
    const shape = shapeOf(part, project.fabric.seam, placement.rotation);
    const item = { placement, shape, polygons: translate(shape.cut, placement.x, placement.y) };
    let boundary = boundaryIssue(item, project);
    if (boundary && shape.curved) {
      try {
        boundary = boundaryIssue(refine(item, project), project);
      } catch {
        boundary = 'uncertain';
      }
    }
    if (boundary)
      violations.push({
        code: boundary,
        message:
          boundary === 'boundary'
            ? `${part.name}: Stoffgrenze oder Randreserve verletzt.`
            : `${part.name}: Kurvenkontakt mit der Stoffgrenze ist nicht sicher prüfbar. Etwas Abstand lassen.`,
        instanceIds: [placement.instanceId],
      });
    located.push(item);
  }
  for (let i = 0; i < located.length; i++)
    for (let j = i + 1; j < located.length; j++) {
      let a = located[i],
        b = located[j];
      let issue = pairIssue(a, b, project.fabric.gap);
      if (issue && (a.shape.curved || b.shape.curved)) {
        // Refine at contacts. Placement origins stay tied to the same reference geometry.
        try {
          a = refine(a, project);
          b = refine(b, project);
          issue = pairIssue(a, b, project.fabric.gap);
        } catch {
          issue = 'uncertain';
        }
      }
      if (issue)
        violations.push({
          code: issue,
          message:
            issue === 'overlap'
              ? 'Zwei Zuschneidekonturen überlappen.'
              : issue === 'gap'
                ? 'Der Mindestabstand zwischen zwei Teilen ist unterschritten.'
                : 'Kurvenkontakt ist numerisch nicht sicher prüfbar. Teile etwas auseinanderziehen.',
          instanceIds: [a.placement.instanceId, b.placement.instanceId],
        });
    }
  const missing = project.parts
    .map((p) => ({
      partId: p.id,
      name: p.name,
      count:
        p.quantity -
        Array.from({ length: p.quantity }, (_, i) => instanceId(p.id, i)).filter((id) =>
          seen.has(id),
        ).length,
    }))
    .filter((p) => p.count > 0);
  const requiredLength = located.length
    ? Math.max(
        ...located.map((p) => bounds(p.polygons).maxY + (p.shape.curved ? p.shape.error : 0)),
      )
    : 0;
  return {
    status: violations.length ? 'invalid' : missing.length || !required ? 'incomplete' : 'valid',
    violations,
    missing,
    placed: seen.size,
    required,
    requiredLength,
    remainingLength:
      project.fabric.mode === 'fixed' ? Math.max(0, project.fabric.length - requiredLength) : null,
  };
}
