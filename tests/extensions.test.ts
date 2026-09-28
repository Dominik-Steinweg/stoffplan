import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  COLORS,
  grainAngle,
  mapPart,
  mirrorPart,
  newPart,
  newProject,
  planningKey,
  setGrainAngle,
} from '../src/domain/model';
import { instanceId, type Placement } from '../src/domain/types';
import { bounds, initGeometry } from '../src/geometry/kernel';
import { contourPath, flatten, shapeOf } from '../src/geometry/contours';
import { toFreeContour } from '../src/geometry/primitives';
import { fabricErrors, validate } from '../src/geometry/validation';
import { parseProject, serializeProject } from '../src/persistence/projects';
import { layoutFingerprint, reviewVariants, VariantPool } from '../src/optimization/variants';
import { optimize } from '../src/optimization/nest';
import { snapDrawingPoint } from '../src/ui/Canvas';

beforeAll(async () => {
  await initGeometry(readFileSync('node_modules/clipper2-wasm/dist/es/clipper2z.wasm'));
});

describe('Parametrische Formen und Bezugslinie', () => {
  it('erhält Kreise und Ovale beim Skalieren, Spiegeln und Speichern', () => {
    const circle = newPart('circle'),
      oval = newPart('ellipse');
    expect(bounds([flatten(circle.contour)]).width).toBe(400);
    expect(bounds([flatten(circle.contour)]).height).toBe(400);
    expect(bounds([flatten(oval.contour)]).height).toBe(600);
    expect(contourPath(oval.contour)).toContain('A200,300');
    const scaled = mapPart(circle, (p) => ({ x: p.x * 2, y: p.y * 2 }));
    expect(scaled.contour.primitive).toMatchObject({ kind: 'circle', rx: 400, ry: 400 });
    const mirrored = mirrorPart(oval, 'horizontal');
    expect(mirrored.contour.primitive).toEqual(oval.contour.primitive);
    expect(mirrored.grain.start.y).toBe(480);
    const project = newProject();
    project.parts = [scaled, mirrored];
    expect(parseProject(serializeProject(project))).toEqual(project);
    expect(shapeOf(circle, 10).width).toBeCloseTo(420, 2);
    expect(shapeOf(oval, 10).height).toBeCloseTo(620, 2);
  });
  it('wandelt die Ellipse innerhalb der Konturgenauigkeit in Béziersegmente um', () => {
    const oval = newPart('ellipse', 1000, 600),
      contour = toFreeContour(oval.contour);
    expect(contour.primitive).toBeUndefined();
    expect(contour.nodes).toHaveLength(32);
    for (const p of flatten(contour, 0.0002)) {
      const radialError = Math.abs(Math.hypot((p.x - 500) / 500, (p.y - 300) / 300) - 1) * 500;
      expect(radialError).toBeLessThan(0.001);
    }
    expect(oval.contour.primitive?.kind).toBe('ellipse');
  });
  it.each([0, 45, 90])('setzt %s Grad ab der positiven Y-Achse ohne Konturänderung', (degrees) => {
    const original = newPart('rectangle');
    const part = setGrainAngle(original, degrees);
    expect(part.contour).toEqual(original.contour);
    expect(part.grain.start).toEqual(original.grain.start);
    expect(
      Math.hypot(part.grain.end.x - part.grain.start.x, part.grain.end.y - part.grain.start.y),
    ).toBeCloseTo(360, 8);
    expect(grainAngle(part)).toBeCloseTo(degrees, 8);
    expect(shapeOf(part, 0).grain.end.x).toBeCloseTo(shapeOf(part, 0).grain.start.x, 6);
    const manual = {
      ...part,
      grain: { ...part.grain, end: { x: part.grain.end.x + 31, y: part.grain.end.y + 29 } },
    };
    expect(grainAngle(manual)).not.toBeCloseTo(degrees, 4);
  });
  it('ordnet Kreise und Ovale gültig an und erkennt überlagerte Rundungen', async () => {
    const p = newProject();
    p.fabric.width = 800;
    p.fabric.seam = 5;
    p.fabric.reserve = 20;
    p.fabric.gap = 3;
    p.parts = [newPart('circle', 150), newPart('ellipse', 120, 210)];
    const result = await optimize(
      { project: p, runId: 'round', revision: 0, budgetMs: 300, seed: 4 },
      () => {},
    );
    expect(result.report.status).toBe('valid');
    expect(result.variants.length).toBeGreaterThan(0);
    const overlapped = result.placements.map((q) => ({ ...q, x: 30, y: 20 }));
    expect(validate(p, overlapped).violations.some((v) => v.code === 'overlap')).toBe(true);
  });
});

describe('Nullpunkt und seitliche Reserve', () => {
  it('fängt den Nullpunkt mit Bildschirmtoleranz und verwendet ansonsten das Raster', () => {
    expect(snapDrawingPoint({ x: 30, y: 20 }, true, 25, 5)).toEqual({ x: 0, y: 0 });
    expect(snapDrawingPoint({ x: 30, y: 20 }, true, 25, 1)).toEqual({ x: 25, y: 25 });
    expect(snapDrawingPoint({ x: 3, y: 2 }, false, 25, 1)).toEqual({ x: 3, y: 2 });
  });
  it('erlaubt Berührung oben und unten, verbietet seitliche Reserveverletzungen', () => {
    const p = newProject(),
      part = newPart('rectangle', 100, 30);
    p.parts = [part];
    p.fabric = { ...p.fabric, width: 140, length: 30, reserve: 20, mode: 'fixed' };
    p.placements = [
      { partId: part.id, instanceId: instanceId(part.id, 0), x: 20, y: 0, rotation: 0 as const },
    ];
    expect(fabricErrors(p)).toEqual([]);
    expect(validate(p).status).toBe('valid');
    expect(validate(p).requiredLength).toBe(30);
    for (const [x, y] of [
      [19.99, 0],
      [20.01, 0],
      [20, -0.01],
      [20, 0.01],
    ]) {
      expect(
        validate(p, [{ ...p.placements[0], x, y }]).violations.some((v) => v.code === 'boundary'),
      ).toBe(true);
    }
  });
});

function variantFixture() {
  const project = newProject(),
    part = newPart('rectangle', 10, 50);
  part.quantity = 2;
  project.parts = [part];
  project.fabric.width = 100;
  const positions = (x = 0, y = 50): Placement[] => [
    { partId: part.id, instanceId: instanceId(part.id, 0), x: 0, y: 0, rotation: 0 as const },
    { partId: part.id, instanceId: instanceId(part.id, 1), x, y, rotation: 0 as const },
  ];
  return { project, positions };
}

describe('Varianten und Migration', () => {
  it('bewahrt gespeicherte Varianten-IDs beim erneuten Suchen mit übernommener Anordnung', async () => {
    const { project, positions } = variantFixture();
    project.placements = positions(10, 0);
    project.variants = [{ id: 'saved-layout', strategy: 'rows', placements: positions(10, 0) }];
    const result = await optimize(
      { project, runId: 'repeat', revision: 0, budgetMs: 100, seed: 4 },
      () => {},
    );
    const key = layoutFingerprint(project, project.placements);
    expect(result.variants.find((v) => layoutFingerprint(project, v.placements) === key)?.id).toBe(
      'saved-layout',
    );
  });
  it('berücksichtigt genau 20 Prozent und verschärft die Grenze bei einer kürzeren Lösung', () => {
    const { project, positions } = variantFixture(),
      pool = new VariantPool(project);
    pool.add(positions(), 'compact');
    pool.add(positions(0, 70), 'rows');
    pool.add(positions(0, 70.001), 'grouped');
    expect(pool.variants.map((v) => v.report.requiredLength)).toEqual([100, 120]);
    pool.add(positions(10, 0), 'compact');
    expect(pool.variants.map((v) => v.report.requiredLength)).toEqual([50]);
  });
  it('ignoriert Exemplartausch und symmetrische Drehungen, erhält geordnete Varianten im Zehnerlimit', () => {
    const { project, positions } = variantFixture(),
      pool = new VariantPool(project);
    const original = positions();
    const exchanged = original.map((p, i) => ({
      ...p,
      instanceId: original[1 - i].instanceId,
      rotation: 180 as const,
    }));
    expect(layoutFingerprint(project, original)).toBe(layoutFingerprint(project, exchanged));
    pool.add(original, 'compact');
    pool.add(exchanged, 'compact');
    expect(pool.variants).toHaveLength(1);
    pool.add(positions(0, 69), 'rows');
    pool.add(positions(0, 70), 'grouped');
    for (let i = 1; i < 18; i++) pool.add(positions(0, 50 + i), 'compact');
    expect(pool.variants).toHaveLength(10);
    expect(pool.variants.some((v) => v.strategy === 'rows')).toBe(true);
    expect(pool.variants.some((v) => v.strategy === 'grouped')).toBe(true);
    expect(pool.variants[0].report.requiredLength).toBe(100);
  });
  it('erzeugt kompakte und geordnete Alternativen innerhalb der Grenze', async () => {
    const p = newProject();
    p.fabric.width = 100;
    p.parts = [newPart('rectangle', 60, 100), { ...newPart('rectangle', 40, 80), quantity: 2 }];
    const result = await optimize(
      { project: p, runId: 'alternatives', revision: 0, budgetMs: 350, seed: 4 },
      () => {},
    );
    expect(result.report.status).toBe('valid');
    expect(result.variants.length).toBeGreaterThanOrEqual(2);
    expect(result.variants.some((v) => v.strategy === 'rows')).toBe(true);
    for (const v of result.variants) {
      expect(validate(p, v.placements).status).toBe('valid');
      expect(v.report.requiredLength).toBeLessThanOrEqual(result.report.requiredLength * 1.2);
    }
  });
  it('migriert alte Dateien ohne Platzierungsverschiebung und bewahrt freie Bezugslinien', () => {
    const legacy = JSON.parse(readFileSync('tests/fixtures/v1-massprobe.stoffplan.json', 'utf8'));
    const p = parseProject(JSON.stringify(legacy));
    expect(p.schemaVersion).toBe(3);
    expect(p.variants).toEqual([]);
    expect(p.placements).toEqual(
      legacy.placements.map(({ flipped, ...placement }: { flipped: boolean }) => ({
        ...placement,
        rotation: flipped ? 180 : 0,
      })),
    );
    expect(p.parts[0].grain).toEqual(legacy.parts[0].grain);
    expect(p.parts[0].color).toBe(COLORS[0]);
  });
  it('speichert Varianten und entfernt ungültige Alternativen ohne Änderung der Hauptanordnung', () => {
    const { project, positions } = variantFixture();
    project.variants = [
      { id: 'good', strategy: 'rows', placements: positions() },
      { id: 'bad', strategy: 'compact', placements: positions(0, 0) },
    ];
    expect(parseProject(serializeProject(project))).toEqual(project);
    const warnings: string[] = [];
    const restored = reviewVariants(project, (message) => warnings.push(message));
    expect(restored.variants.map((v) => v.id)).toEqual(['good']);
    expect(restored.placements).toEqual(project.placements);
    expect(warnings).toHaveLength(1);
  });
  it('erkennt nur planungsrelevante Änderungen', () => {
    const { project, positions } = variantFixture(),
      key = planningKey(project);
    const styled = structuredClone(project);
    styled.parts[0].color = '#ff0088';
    styled.parts[0].name = 'Neu';
    styled.unit = 'inch';
    styled.placements = positions();
    expect(planningKey(styled)).toBe(key);
    styled.parts[0] = setGrainAngle(styled.parts[0], 45);
    expect(planningKey(styled)).not.toBe(key);
  });
  it.each(['color', 'primitive', 'variants'])('weist beschädigte %s-Daten zurück', (field) => {
    const p = newProject();
    p.parts = [newPart('circle')];
    const data = JSON.parse(serializeProject(p));
    if (field === 'color') data.parts[0].color = 'red';
    if (field === 'primitive') data.parts[0].contour.primitive.rx = -1;
    if (field === 'variants') data.variants = [{ id: 'bad', strategy: 'unknown', placements: [] }];
    expect(() => parseProject(JSON.stringify(data))).toThrow();
  });
});
