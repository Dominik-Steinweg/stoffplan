import type { PartDefinition, Point, Project } from './types';
import { uid } from './types';

export const COLORS = ['#80ad96', '#d0ad79', '#91a9bd', '#b19bba', '#b3b775', '#d29585'];
export type PartKind = 'rectangle' | 'triangle' | 'free' | 'circle' | 'ellipse';

// Only inputs affecting the feasibility of a layout invalidate saved variants.
export const planningKey = (project: Project) =>
  JSON.stringify([
    project.id,
    project.fabric,
    project.parts.map(({ id, quantity, contour, grain, direction }) => ({
      id,
      quantity,
      contour,
      grain,
      direction,
    })),
  ]);

export function grainAngle(part: PartDefinition): number {
  const { start, end } = part.grain;
  return ((Math.atan2(end.x - start.x, end.y - start.y) * 180) / Math.PI + 360) % 360;
}
export function setGrainAngle(part: PartDefinition, degrees: number): PartDefinition {
  const { start, end } = part.grain;
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 100;
  const a = (degrees * Math.PI) / 180;
  return {
    ...part,
    grain: { start, end: { x: start.x + length * Math.sin(a), y: start.y + length * Math.cos(a) } },
  };
}

export function newProject(): Project {
  return {
    schemaVersion: 2,
    id: uid(),
    name: 'Neues Projekt',
    unit: 'mm',
    fabric: { mode: 'auto', width: 0, length: 2000, seam: 0, reserve: 0, gap: 0 },
    parts: [],
    placements: [],
    variants: [],
    layoutSource: 'manual',
    updatedAt: new Date().toISOString(),
  };
}

export function newPart(kind: PartKind, width = 400, height = 600): PartDefinition {
  if (kind === 'circle') height = width;
  const nodes =
    kind === 'rectangle'
      ? [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height },
          { x: 0, y: height },
        ]
      : kind === 'triangle'
        ? [
            { x: 0, y: height },
            { x: width / 2, y: 0 },
            { x: width, y: height },
          ]
        : [
            { x: 0, y: 0 },
            { x: width, y: 0, out: { x: width, y: height * 0.4 } },
            { x: width * 0.65, y: height * 0.65, in: { x: width * 0.3, y: height * 0.35 } },
            { x: width, y: height },
            { x: 0, y: height },
          ];
  return {
    id: uid(),
    name: {
      rectangle: 'Rechteck',
      triangle: 'Dreieck',
      free: 'Freie Form',
      circle: 'Kreis',
      ellipse: 'Oval',
    }[kind],
    quantity: 1,
    contour:
      kind === 'circle' || kind === 'ellipse'
        ? {
            closed: true,
            nodes: [],
            primitive: {
              kind,
              center: { x: width / 2, y: height / 2 },
              rx: width / 2,
              ry: height / 2,
            },
          }
        : { closed: true, nodes },
    grain: {
      start: { x: width * 0.25, y: height * 0.2 },
      end: { x: width * 0.25, y: height * 0.8 },
    },
    direction: 'straight',
    mirrored: false,
    color: COLORS[0],
  };
}

export function mapPart(part: PartDefinition, transform: (p: Point) => Point): PartDefinition {
  const primitive = part.contour.primitive;
  const center = primitive && transform(primitive.center);
  const rx =
    primitive && center
      ? Math.abs(
          transform({ x: primitive.center.x + primitive.rx, y: primitive.center.y }).x - center.x,
        )
      : 0;
  const ry =
    primitive && center
      ? Math.abs(
          transform({ x: primitive.center.x, y: primitive.center.y + primitive.ry }).y - center.y,
        )
      : 0;
  const keepCircle = primitive?.kind === 'circle' && Math.abs(rx - ry) < 1e-8;
  return {
    ...part,
    contour: {
      ...part.contour,
      ...(primitive && center
        ? {
            primitive: {
              ...primitive,
              center,
              rx,
              ry: keepCircle ? rx : ry,
              kind: keepCircle ? ('circle' as const) : ('ellipse' as const),
            },
          }
        : {}),
      nodes: part.contour.nodes.map((n) => ({
        ...transform(n),
        ...(n.in ? { in: transform(n.in) } : {}),
        ...(n.out ? { out: transform(n.out) } : {}),
      })),
    },
    grain: { start: transform(part.grain.start), end: transform(part.grain.end) },
  };
}

export function mirrorPart(part: PartDefinition, axis: 'vertical' | 'horizontal'): PartDefinition {
  const primitive = part.contour.primitive;
  const coords = primitive
    ? [
        { x: primitive.center.x - primitive.rx, y: primitive.center.y - primitive.ry },
        { x: primitive.center.x + primitive.rx, y: primitive.center.y + primitive.ry },
      ]
    : part.contour.nodes.flatMap((n) => [n, ...(n.in ? [n.in] : []), ...(n.out ? [n.out] : [])]);
  const xs = coords.map((p) => p.x),
    ys = coords.map((p) => p.y);
  const sumX = Math.min(...xs) + Math.max(...xs),
    sumY = Math.min(...ys) + Math.max(...ys);
  const result = mapPart(part, (p) =>
    axis === 'vertical' ? { x: sumX - p.x, y: p.y } : { x: p.x, y: sumY - p.y },
  );
  return { ...result, id: uid(), name: `${part.name} · gespiegelt`, mirrored: !part.mirrored };
}

export function exampleProject(): Project {
  const project = newProject();
  return {
    ...project,
    name: 'Maßprobe · zwei Rechtecke',
    fabric: { ...project.fabric, width: 1000, seam: 10, reserve: 20, gap: 5 },
    parts: [{ ...newPart('rectangle'), name: 'Grundteil', quantity: 2 }],
  };
}

export function mixedExampleProject(): Project {
  const p = newProject();
  const curved = { ...newPart('free', 300, 450), name: 'Geschwungenes Seitenteil' };
  return {
    ...p,
    name: 'Werkstatt · Formen & Rundungen',
    fabric: { ...p.fabric, width: 1400, seam: 10, reserve: 15, gap: 5 },
    parts: [
      { ...newPart('rectangle', 350, 550), name: 'Vorderteil', quantity: 2 },
      { ...newPart('triangle', 280, 400), name: 'Keil', quantity: 2, color: COLORS[1] },
      { ...curved, color: COLORS[2] },
      { ...mirrorPart(curved, 'vertical'), color: COLORS[3] },
    ],
  };
}
