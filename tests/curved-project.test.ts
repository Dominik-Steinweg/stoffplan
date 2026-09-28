import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProject } from '../src/persistence/projects';
import { initGeometry } from '../src/geometry/kernel';
import { shapeOf } from '../src/geometry/contours';
import { validate } from '../src/geometry/validation';
import { optimize } from '../src/optimization/nest';
import { newPart, newProject } from '../src/domain/model';
import type { OptimizationResult } from '../src/domain/types';

beforeAll(async () => {
  await initGeometry(readFileSync('node_modules/clipper2-wasm/dist/es/clipper2z.wasm'));
});

const fixture = () =>
  parseProject(readFileSync('tests/fixtures/curved-project.stoffplan.json', 'utf8'));

it('verdichtet das gemeldete Kurvenprojekt innerhalb des Suchbudgets', async () => {
  const project = fixture();
  const original = structuredClone(project);
  const preciseCurve = structuredClone(shapeOf(project.parts[1], project.fabric.seam).cut);
  const proposals: OptimizationResult[] = [];
  const result = await optimize(
    { project, runId: 'curves', revision: 0, budgetMs: 1000, seed: 20260928 },
    (proposal) => proposals.push(proposal),
  );

  expect(result.elapsedMs).toBeLessThan(2500);
  expect(result.iterations).toBeGreaterThan(0);
  expect(result.report.placed).toBe(3);
  expect(result.report.requiredLength).toBeCloseTo(588.497216, 5);
  expect(result.report.requiredLength).toBeLessThan(proposals[0].report.requiredLength);
  for (const proposal of proposals) {
    expect(validate(project, proposal.placements).status).toBe('valid');
    expect(proposal.report.placed).toBe(3);
  }
  expect(project).toEqual(original);
  expect(shapeOf(project.parts[1], project.fabric.seam).cut).toEqual(preciseCurve);
});

it.each([0, 5])(
  'prüft Kurven auch bei %s mm Abstand weiterhin mit den genauen Konturen',
  async (gap) => {
    const project = fixture();
    project.fabric.gap = gap;
    const result = await optimize(
      { project, runId: 'curve-gap', revision: 0, budgetMs: 500, seed: 20260928 },
      () => {},
    );
    expect(result.report.status).toBe('valid');
    expect(result.report.requiredLength).toBeLessThan(700);
    // Move a curved piece on top of the other one: approximation must not weaken validation.
    const curves = result.placements.filter((p) => p.partId === project.parts[1].id);
    const overlapping = result.placements.map((p) =>
      p.instanceId === curves[1].instanceId
        ? { ...p, x: curves[0].x, y: curves[0].y, rotation: curves[0].rotation }
        : p,
    );
    expect(validate(project, overlapping).violations.some((v) => v.code === 'overlap')).toBe(true);
  },
);

it('erhält genau passende Rechteck-Anordnungen mit positivem Teileabstand', async () => {
  const project = newProject();
  project.fabric = { mode: 'fixed', width: 205, length: 100, gap: 5, seam: 0, reserve: 0 };
  project.parts = [{ ...newPart('rectangle', 100, 100), quantity: 2 }];
  const result = await optimize(
    { project, runId: 'exact-gap', revision: 0, budgetMs: 200, seed: 1 },
    () => {},
  );
  expect(result.report.status).toBe('valid');
  expect(result.report.requiredLength).toBe(100);
});
