import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initGeometry,
  bounds,
  intersection,
  area,
  translate,
  minkowskiObstacle,
} from '../src/geometry/kernel';
import { shapeOf } from '../src/geometry/contours';
import { validate } from '../src/geometry/validation';
import { exampleProject, newPart, newProject, mirrorPart, mapPart } from '../src/domain/model';
import { parseMeasure, formatMeasure } from '../src/domain/units';
import { instanceId } from '../src/domain/types';
import { optimize } from '../src/optimization/nest';
import { parseProject, serializeProject } from '../src/persistence/projects';

beforeAll(async () => {
  await initGeometry(readFileSync('node_modules/clipper2-wasm/dist/es/clipper2z.wasm'));
});
describe('Maße', () => {
  it.each([
    ['1 inch', 25.4],
    ['1 1/2 inch', 38.1],
    ['1,5 in', 38.1],
    ['25 mm', 25],
    ['1/64 inch', 0.396875],
    ['-1 1/2 in', -38.1],
  ])('%s', (raw, mm) => expect(parseMeasure(raw, 'mm')).toBeCloseTo(mm, 9));
  it('verwendet die Anzeigeeinheit nur ohne explizite Einheit', () => {
    expect(parseMeasure('2', 'inch')).toBe(50.8);
    expect(parseMeasure('2 mm', 'inch')).toBe(2);
  });
  it.each(['1/0 inch', '1..2', '1,000.5', 'Infinity', '1 cm', '', '1/'])('verwirft %s', (raw) =>
    expect(() => parseMeasure(raw, 'mm')).toThrow(),
  );
  it('rundet den Stoffbedarf auf', () =>
    expect(formatMeasure(25.400001, 'inch', true)).toBe('1,00001'));
});
describe('Konturen und Anordnung', () => {
  it('versetzt Rechteckkanten statt proportional zu skalieren', () => {
    const p = exampleProject();
    const s = shapeOf(p.parts[0], p.fabric.seam);
    expect(s.width).toBeCloseTo(420, 6);
    expect(s.height).toBeCloseTo(620, 6);
  });
  it('validiert 620 mm und verweigert 619 mm', () => {
    const p = exampleProject(),
      part = p.parts[0];
    p.placements = [0, 1].map((i) => ({
      instanceId: instanceId(part.id, i),
      partId: part.id,
      x: 20 + i * 425,
      y: 0,
      rotation: 0 as const,
    }));
    expect(validate(p).status).toBe('valid');
    expect(validate(p).requiredLength).toBe(620);
    p.fabric.mode = 'fixed';
    p.fabric.length = 620;
    expect(validate(p).status).toBe('valid');
    p.fabric.length = 650;
    expect(validate(p).status).toBe('valid');
    p.fabric.length = 619;
    expect(validate(p).status).toBe('invalid');
  });
  it('findet das 620-mm-Beispiel automatisch', async () => {
    const p = exampleProject();
    const result = await optimize(
      { project: p, runId: 'test', revision: 0, budgetMs: 2000, seed: 4 },
      () => {},
    );
    expect(result.report.status).toBe('valid');
    expect(result.report.requiredLength).toBe(620);
    p.fabric.mode = 'fixed';
    p.fabric.length = 619;
    const fixed = await optimize(
      { project: p, runId: 'test', revision: 0, budgetMs: 150, seed: 4 },
      () => {},
    );
    expect(fixed.report.status).not.toBe('valid');
    expect(fixed.report.missing[0].count).toBeGreaterThan(0);
  });
  it('erlaubt Berührung und exakt passende Breite, aber keine minimale Überlappung', () => {
    const p = newProject(),
      part = { ...newPart('rectangle', 100, 100), quantity: 2 };
    p.fabric.width = 200;
    p.parts = [part];
    p.placements = [0, 1].map((i) => ({
      instanceId: instanceId(part.id, i),
      partId: part.id,
      x: i * 100,
      y: 0,
      rotation: 0 as const,
    }));
    expect(validate(p).status).toBe('valid');
    p.placements[1].x -= 0.001;
    expect(validate(p).violations.some((v) => v.code === 'overlap')).toBe(true);
    p.placements[1].x = 100;
    p.fabric.width = 210;
    p.fabric.gap = 5;
    expect(validate(p).violations.some((v) => v.code === 'gap')).toBe(true);
    p.placements[1].x = 105;
    expect(validate(p).status).toBe('valid');
  });
  it('richtet schräge Bezugslinien und Cross-Grain richtig aus', () => {
    const p = newPart('rectangle', 100, 200);
    const rotated = mapPart(p, (v) => ({
      x: (v.x - v.y) / Math.sqrt(2),
      y: (v.x + v.y) / Math.sqrt(2),
    }));
    expect(shapeOf(rotated, 0).width).toBeCloseTo(100, 5);
    expect(shapeOf({ ...rotated, direction: 'cross' }, 0).width).toBeCloseTo(200, 5);
    const s = shapeOf(rotated, 0, 180);
    expect(Math.abs(s.grain.start.x - s.grain.end.x)).toBeLessThan(0.00001);
  });
  it('spiegelt Form und Bezugslinie unabhängig', () => {
    const p = newPart('free'),
      m = mirrorPart(p, 'vertical');
    expect(m.id).not.toBe(p.id);
    expect(m.grain.start.x).not.toBe(p.grain.start.x);
    m.contour.nodes[0].x = 999;
    expect(p.contour.nodes[0].x).toBe(0);
  });
  it('lehnt offene und selbstschneidende Umrisse ab', () => {
    const p = newPart('rectangle');
    p.contour.closed = false;
    expect(() => shapeOf(p, 0)).toThrow(/offen/);
    p.contour.closed = true;
    [p.contour.nodes[1], p.contour.nodes[2]] = [p.contour.nodes[2], p.contour.nodes[1]];
    expect(() => shapeOf(p, 0)).toThrow();
  });
  it('erzeugt begrenzte Nahtzugaben für spitze Ecken und Kurven', () => {
    const p = newPart('triangle', 10, 600);
    expect(bounds(shapeOf(p, 10).cut).height).toBeLessThan(640);
    const free = shapeOf(newPart('free'), 10);
    expect(free.cut[0].length).toBeGreaterThan(10);
  });
  it('nutzt Einbuchtungen trotz überlappender Begrenzungsrechtecke', async () => {
    const p = newProject();
    p.fabric.width = 100;
    const l = newPart('rectangle', 100, 100);
    l.contour.nodes = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 30, y: 30 },
      { x: 30, y: 100 },
      { x: 0, y: 100 },
    ];
    const small = newPart('rectangle', 70, 70);
    p.parts = [l, small];
    const result = await optimize(
      { project: p, runId: 'concave', revision: 0, budgetMs: 100, seed: 8 },
      () => {},
    );
    expect(result.report.status).toBe('valid');
    expect(result.report.requiredLength).toBe(100);
    const boxes = result.placements.map((q) => {
      const s = shapeOf(
        p.parts.find((part) => part.id === q.partId)!,
        0,
        q.rotation,
      );
      return bounds(translate(s.cut, q.x, q.y));
    });
    expect(
      Math.min(boxes[0].maxX, boxes[1].maxX) - Math.max(boxes[0].minX, boxes[1].minX),
    ).toBeGreaterThan(0);
  });
  it('schließt bei No-Fit-Polygonen auch vollständige Einschließung aus', () => {
    const a = shapeOf(newPart('rectangle', 100, 100), 0).cut[0],
      b = shapeOf(newPart('rectangle', 20, 20), 0).cut[0];
    const nfp = minkowskiObstacle(a, b);
    expect(Math.abs(nfp.reduce((sum, p) => sum + area(p), 0))).toBeCloseTo(14400, 4);
    expect(intersection([a], translate([b], 10, 10)).length).toBeGreaterThan(0);
  });
  it('bewertet unsichere Kurvenkontakte mit Stoffgrenzen nicht als gültig', () => {
    const p = newProject(),
      part = newPart('free', 100, 150);
    p.fabric.width = 200;
    p.parts = [part];
    p.placements = [
      { instanceId: instanceId(part.id, 0), partId: part.id, x: 0, y: 0, rotation: 0 as const },
    ];
    expect(validate(p).status).toBe('invalid');
    p.placements[0].x = 0.02;
    p.placements[0].y = 0.02;
    expect(validate(p).status).toBe('valid');
  });
  it('liefert für 50 Exemplare eine vollständige geprüfte Ausgangsanordnung', async () => {
    const p = newProject();
    p.fabric.width = 1000;
    p.fabric.seam = 5;
    p.fabric.reserve = 10;
    p.fabric.gap = 3;
    p.parts = Array.from({ length: 5 }, (_, i) => ({
      ...newPart(i === 4 ? 'free' : i % 2 ? 'triangle' : 'rectangle', 100 + i * 20, 150 + i * 25),
      quantity: 10,
    }));
    let cancelled = false;
    const result = await optimize(
      { project: p, runId: 'fifty', revision: 0, budgetMs: 500, seed: 8 },
      (r) => {
        if (r.report.status === 'valid') cancelled = true;
      },
      () => cancelled,
    );
    expect(result.report.status).toBe('valid');
    expect(result.placements).toHaveLength(50);
    expect(new Set(result.placements.map((p) => p.instanceId)).size).toBe(50);
  });
  it('erkennt zu breite Teile und doppelte Exemplare', () => {
    const p = exampleProject();
    p.fabric.width = 450;
    expect(validate(p).violations.some((v) => v.code === 'width')).toBe(true);
    p.fabric.width = 1000;
    const id = p.parts[0].id;
    const placement = {
      partId: id,
      instanceId: instanceId(id, 0),
      x: 20,
      y: 20,
      rotation: 0 as const,
    };
    p.placements = [placement, { ...placement, x: 500 }];
    expect(validate(p).violations.some((v) => v.code === 'instance')).toBe(true);
    expect(validate(p).missing[0].count).toBe(1);
  });
});
describe('Projektdateien', () => {
  it('erhält Kurven, inch und manuelle Platzierungen', () => {
    const p = newProject();
    p.unit = 'inch';
    p.parts = [newPart('free')];
    p.placements = [
      {
        instanceId: instanceId(p.parts[0].id, 0),
        partId: p.parts[0].id,
        x: 38.1,
        y: 22.05,
        rotation: 180 as const,
      },
    ];
    expect(parseProject(serializeProject(p))).toEqual(p);
  });
  it('weist beschädigte Dateien und unbekannte Versionen zurück', () => {
    expect(() => parseProject('{}')).toThrow();
    expect(() => parseProject('broken')).toThrow();
    expect(() => parseProject(JSON.stringify({ ...newProject(), schemaVersion: 99 }))).toThrow(
      /Version/,
    );
  });
});
