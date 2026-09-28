export type Unit = 'mm' | 'inch';
export interface Point {
  x: number;
  y: number;
}
export interface PathNode extends Point {
  in?: Point;
  out?: Point;
}
export interface Contour {
  closed: boolean;
  nodes: PathNode[];
  primitive?: { kind: 'circle' | 'ellipse'; center: Point; rx: number; ry: number };
}
export interface PartDefinition {
  id: string;
  name: string;
  quantity: number;
  contour: Contour;
  grain: { start: Point; end: Point };
  direction: 'straight' | 'cross';
  mirrored: boolean;
  color: string;
}
export interface Placement {
  instanceId: string;
  partId: string;
  x: number;
  y: number;
  flipped: boolean;
}
export type LayoutStrategy = 'compact' | 'rows' | 'grouped';
export interface LayoutVariant {
  id: string;
  strategy: LayoutStrategy;
  placements: Placement[];
}
export interface CheckedVariant extends LayoutVariant {
  report: ValidationReport;
}
export interface Project {
  schemaVersion: 2;
  id: string;
  name: string;
  unit: Unit;
  fabric: {
    mode: 'auto' | 'fixed';
    width: number;
    length: number;
    seam: number;
    reserve: number;
    gap: number;
  };
  parts: PartDefinition[];
  placements: Placement[];
  variants: LayoutVariant[];
  layoutSource: 'manual' | 'optimized';
  updatedAt: string;
}
export interface Violation {
  code: string;
  message: string;
  instanceIds: string[];
  partId?: string;
}
export interface ValidationReport {
  status: 'valid' | 'incomplete' | 'invalid' | 'unchecked';
  violations: Violation[];
  missing: { partId: string; name: string; count: number }[];
  placed: number;
  required: number;
  requiredLength: number;
  remainingLength: number | null;
}
export interface OptimizationRequest {
  runId: string;
  revision: number;
  project: Project;
  budgetMs: number;
  seed: number;
}
export interface OptimizationResult {
  runId: string;
  revision: number;
  placements: Placement[];
  report: ValidationReport;
  iterations: number;
  elapsedMs: number;
  variants: CheckedVariant[];
}
export type WorkerResponse =
  | { type: 'progress' | 'done'; result: OptimizationResult }
  | { type: 'error'; runId: string; revision: number; message: string };
export const instanceId = (partId: string, index: number) => `${partId}:${index}`;
export const uid = () => crypto.randomUUID();
