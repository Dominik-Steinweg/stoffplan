import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initGeometry } from '../src/geometry/kernel';
import { shapeOf } from '../src/geometry/contours';
import { validate } from '../src/geometry/validation';
import { newPart, newProject, setGrainAngle } from '../src/domain/model';
import {
  allowedRotations,
  instanceId,
  type PartDefinition,
  type Rotation,
} from '../src/domain/types';
import { optimize } from '../src/optimization/nest';
import { layoutFingerprint } from '../src/optimization/variants';
import { parseProject, serializeProject } from '../src/persistence/projects';

beforeAll(async () =>
  initGeometry(readFileSync('node_modules/clipper2-wasm/dist/es/clipper2z.wasm')),
);

const placement = (part: PartDefinition, rotation: Rotation = 0, index = 0) => ({
  partId: part.id,
  instanceId: instanceId(part.id, index),
  x: 0,
  y: 0,
  rotation,
});

describe('Stoffrichtung egal', () => {
  it.each([0, 45, 90])(
    'richtet die Bezugslinie bei %s° in genau den erlaubten Richtungen aus',
    (angle) => {
      for (const direction of ['straight', 'cross', 'either'] as const) {
        const part = { ...setGrainAngle(newPart('triangle', 80, 120), angle), direction };
        expect(allowedRotations(part)).toEqual(
          direction === 'either' ? [0, 90, 180, 270] : [0, 180],
        );
        for (const rotation of allowedRotations(part)) {
          const shape = shapeOf(part, 0, rotation);
          const dx = shape.grain.end.x - shape.grain.start.x;
          const dy = shape.grain.end.y - shape.grain.start.y;
          const expected = (direction === 'cross' ? 0 : Math.PI / 2) + (rotation * Math.PI) / 180;
          expect(dx / Math.hypot(dx, dy)).toBeCloseTo(Math.cos(expected), 6);
          expect(dy / Math.hypot(dx, dy)).toBeCloseTo(Math.sin(expected), 6);
        }
        expect(() => shapeOf(part, 0, 45 as Rotation)).toThrow(/Drehung/);
        if (direction !== 'either') expect(() => shapeOf(part, 0, 90)).toThrow(/Drehung/);
      }
    },
  );

  it('platziert auch im Startvorschlag ein nur quer passendes Teil', async () => {
    const p = newProject();
    const part = { ...newPart('rectangle', 240, 80), direction: 'either' as const };
    p.parts = [part];
    p.fabric.width = 100;
    p.fabric.seam = 5;
    p.fabric.reserve = 5;
    p.fabric.mode = 'fixed';
    p.fabric.length = 250;
    expect(validate(p).violations).toEqual([]);
    const proposals: Rotation[][] = [];
    const result = await optimize(
      { project: p, runId: 'quarter-turn', revision: 0, budgetMs: 500, seed: 1 },
      (r) => {
        if (r.report.status === 'valid') proposals.push(r.placements.map((q) => q.rotation));
      },
    );
    expect(result.report.status).toBe('valid');
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].every((r) => r === 90 || r === 270)).toBe(true);
    expect(result.report.requiredLength).toBeCloseTo(250);
    for (const variant of result.variants)
      expect(validate(p, variant.placements).status).toBe('valid');
    p.parts[0] = { ...part, direction: 'straight' };
    expect(validate(p).violations.some((v) => v.code === 'width')).toBe(true);
  });

  it('prüft Kollisionen, Stoffgrenzen und unzulässige Drehungen', () => {
    const p = newProject();
    const part = { ...newPart('rectangle', 100, 40), direction: 'either' as const, quantity: 2 };
    p.parts = [part];
    p.fabric.width = 200;
    p.placements = [placement(part, 90), { ...placement(part, 270, 1), x: 40 }];
    expect(validate(p).status).toBe('valid');
    p.placements[1].x = 39;
    expect(validate(p).violations.some((v) => v.code === 'overlap')).toBe(true);
    p.placements[1].x = 180;
    expect(validate(p).violations.some((v) => v.code === 'boundary')).toBe(true);
    p.parts[0] = { ...part, direction: 'straight' };
    expect(validate(p).violations.filter((v) => v.code === 'rotation')).toHaveLength(2);
  });

  it('unterscheidet Vierteldrehungen und vereint geometrisch identische Varianten', () => {
    const p = newProject();
    const part = { ...newPart('rectangle', 100, 40), direction: 'either' as const };
    p.parts = [part];
    const key = (r: Rotation) => layoutFingerprint(p, [placement(p.parts[0], r)]);
    expect(key(0)).toBe(key(180));
    expect(key(90)).toBe(key(270));
    expect(key(0)).not.toBe(key(90));
    p.parts[0] = { ...newPart('rectangle', 50, 50), direction: 'either' };
    expect(key(0)).toBe(key(90));
  });
});

describe('Projektformat 3', () => {
  it.each([1, 2])(
    'migriert Version %s einschließlich umgedrehter Platzierungen',
    (schemaVersion) => {
      const p = newProject();
      const part = newPart('triangle', 100, 80);
      p.parts = [part];
      const oldPlacement = {
        partId: part.id,
        instanceId: instanceId(part.id, 0),
        x: 17,
        y: 23,
        flipped: true,
      };
      const legacy = {
        ...p,
        schemaVersion,
        placements: [oldPlacement],
        variants:
          schemaVersion === 2
            ? [{ id: 'old', strategy: 'rows', placements: [{ ...oldPlacement, flipped: false }] }]
            : [],
      };
      const imported = parseProject(JSON.stringify(legacy));
      expect(imported.schemaVersion).toBe(3);
      expect(imported.placements).toEqual([{ ...placement(part, 180), x: 17, y: 23 }]);
      expect(shapeOf(imported.parts[0], 0, imported.placements[0].rotation)).toEqual(
        shapeOf(part, 0, 180),
      );
      if (schemaVersion === 2)
        expect(imported.variants[0].placements[0]).toEqual({ ...placement(part), x: 17, y: 23 });
    },
  );

  it('bewahrt alle Drehungen und Varianten beim Speichern und Öffnen', () => {
    const p = newProject();
    const part = { ...newPart('triangle'), quantity: 4, direction: 'either' as const };
    p.parts = [part];
    p.placements = allowedRotations(part).map((r, i) => ({ ...placement(part, r, i), x: 500 * i }));
    p.variants = [{ id: 'new', strategy: 'compact', placements: structuredClone(p.placements) }];
    expect(parseProject(serializeProject(p))).toEqual(p);
    expect(serializeProject(p)).not.toContain('flipped');
    const invalid = JSON.parse(serializeProject(p));
    invalid.placements[0].rotation = 45;
    expect(() => parseProject(JSON.stringify(invalid))).toThrow(/Drehvariante/);
  });
});
