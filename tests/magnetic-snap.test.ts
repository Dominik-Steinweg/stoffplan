import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newPart, newProject } from '../src/domain/model';
import { instanceId, type PartDefinition, type Placement, type Point } from '../src/domain/types';
import { initGeometry, translate } from '../src/geometry/kernel';
import { shapeOf, polygonDistance } from '../src/geometry/contours';
import { createMagneticSnap } from '../src/geometry/magnetic-snap';
import { validate } from '../src/geometry/validation';

beforeAll(async () =>
  initGeometry(readFileSync('node_modules/clipper2-wasm/dist/es/clipper2z.wasm')),
);
const place = (part: PartDefinition, x: number, y: number, index = 0): Placement => ({
  partId: part.id,
  instanceId: instanceId(part.id, index),
  x,
  y,
  rotation: 0,
});
function fixture() {
  const p = newProject(),
    part = { ...newPart('rectangle', 60, 100), quantity: 2 };
  p.parts = [part];
  p.fabric.width = 600;
  p.placements = [place(part, 20, 20), place(part, 200, 20, 1)];
  return p;
}
function dock(p = fixture(), target: Point = { x: 136, y: 20 }, radius = 12, fallback = target) {
  const result = createMagneticSnap(p, p.placements[0])(target, fallback, radius);
  if (result) {
    const moved = p.placements.map((q, i) => (i ? q : { ...q, ...result.point }));
    expect(
      validate(p, moved).violations.filter((v) => v.instanceIds.includes(moved[0].instanceId)),
    ).toEqual([]);
  }
  return result;
}

describe('Magnetische Konturkontakte', () => {
  it('dockt bündig an eine Nachbarkante an und verändert den Nachbarn nicht', () => {
    const p = fixture(),
      original = structuredClone(p);
    expect(dock(p)).toEqual({ point: { x: 140, y: 20 }, snapped: true });
    expect(p).toEqual(original);
  });
  it('respektiert Nahtzugabe und positiven Teileabstand', () => {
    const p = fixture();
    p.fabric.seam = 10;
    p.fabric.gap = 5;
    expect(dock(p, { x: 118, y: 20 })).toEqual({ point: { x: 115, y: 20 }, snapped: true });
  });
  it('fängt von beiden Seiten der Kontaktkante, auch bei geringer Überlappung', () => {
    expect(dock(fixture(), { x: 143, y: 40 })).toEqual({ point: { x: 140, y: 40 }, snapped: true });
  });
  it('fängt außerhalb des Radius nicht und verwendet dann das Rasterziel', () => {
    expect(dock(fixture(), { x: 110, y: 20 }, 12, { x: 100, y: 25 })).toEqual({
      point: { x: 100, y: 25 },
      snapped: false,
    });
    expect(dock(fixture(), { x: 136, y: 20 }, 12, { x: 125, y: 25 })?.point.x).toBe(140);
    expect(dock(fixture(), { x: 136, y: 20 }, 2)?.snapped).toBe(false);
  });
  it('lehnt tiefe Überlappung und Stoffgrenzen ab', () => {
    const p = fixture();
    p.fabric.mode = 'fixed';
    p.fabric.length = 200;
    p.fabric.reserve = 10;
    for (const point of [
      { x: 205, y: 30 },
      { x: -20, y: 30 },
      { x: 570, y: 30 },
      { x: 20, y: 130 },
    ])
      expect(dock(p, point)).toBeNull();
  });
  it('kontrolliert auch weitere Nachbarn und findet gleichzeitige Kantenkontakte', () => {
    const p = fixture(),
      blocker = newPart('rectangle', 200, 40);
    p.parts.push(blocker);
    p.placements.push(place(blocker, 0, 130));
    const result = dock(p, { x: 143, y: 33 });
    expect(result?.snapped).toBe(true);
    expect(result?.point).toEqual({ x: 140, y: 30 });
  });
  it('dockt an schräge Konturen statt an ihre Begrenzungsrechtecke', () => {
    const p = newProject(),
      small = newPart('rectangle', 10, 10),
      triangle = newPart('triangle', 100, 100);
    p.parts = [small, triangle];
    p.fabric.width = 500;
    p.placements = [place(small, 20, 20), place(triangle, 100, 100)];
    const result = dock(p, { x: 110, y: 140 });
    expect(result?.snapped).toBe(true);
    // Triangle's left edge satisfies 2*x+y=400; the rectangle's lower right corner touches it.
    expect(2 * result!.point.x + result!.point.y + 30).toBeCloseTo(400, 5);
    expect(result!.point.x).toBeGreaterThan(100);
  });
  it('nutzt Einbuchtungen und nicht nur die äußere Bounding-Box', () => {
    const p = newProject(),
      small = newPart('rectangle', 20, 20),
      l = newPart('rectangle', 100, 100);
    l.contour.nodes = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 30, y: 30 },
      { x: 30, y: 100 },
      { x: 0, y: 100 },
    ];
    p.parts = [small, l];
    p.fabric.width = 500;
    p.placements = [place(small, 20, 20), place(l, 100, 100)];
    expect(dock(p, { x: 133, y: 160 })).toEqual({ point: { x: 130, y: 160 }, snapped: true });
  });
  it('erhält Vierteldrehungen beim Andocken', () => {
    const p = fixture();
    p.parts[0].direction = 'either';
    p.placements[0].rotation = 90;
    expect(dock(p, { x: 96, y: 20 })?.point.x).toBe(100);
    expect(p.placements[0].rotation).toBe(90);
  });
  it('dockt an abgerundete Abstandsecken mit dem tatsächlichen Mindestabstand', () => {
    const p = fixture();
    p.fabric.gap = 10;
    const result = dock(p, { x: 136, y: 124 });
    expect(result?.snapped).toBe(true);
    const shape = shapeOf(p.parts[0], 0);
    expect(
      polygonDistance(
        translate(shape.cut, result!.point.x, result!.point.y),
        translate(shape.cut, 200, 20),
      ),
    ).toBeCloseTo(10, 5);
  });
  it('berücksichtigt den Sicherheitsabstand bei Kurvenkontakten', () => {
    const p = newProject(),
      circle = { ...newPart('circle', 80), quantity: 2 };
    p.parts = [circle];
    p.fabric.width = 600;
    p.fabric.gap = 3;
    p.placements = [place(circle, 20, 20), place(circle, 200, 20, 1)];
    const start = performance.now();
    const result = dock(p, { x: 114, y: 20 });
    expect(result?.snapped).toBe(true);
    expect(result!.point.x).toBeCloseTo(117, 1);
    expect(performance.now() - start).toBeLessThan(1000);
  });
  it('lehnt tiefe Kurvenüberlappungen ohne teure Kontaktsuche ab', () => {
    const p = newProject(),
      circle = { ...newPart('circle', 80), quantity: 2 };
    p.parts = [circle];
    p.fabric.width = 600;
    p.placements = [place(circle, 20, 20), place(circle, 200, 20, 1)];
    const snap = createMagneticSnap(p, p.placements[0]),
      start = performance.now();
    for (let i = 0; i < 30; i++)
      expect(snap({ x: 200 + i / 10, y: 20 }, { x: 200, y: 20 }, 12)).toBeNull();
    expect(performance.now() - start).toBeLessThan(1000);
  });
  it('verhindert kein Verschieben wegen eines unabhängigen Konflikts anderer Teile', () => {
    const p = fixture();
    p.parts[0].quantity = 4;
    p.placements.push(place(p.parts[0], 400, 20, 2), place(p.parts[0], 410, 20, 3));
    expect(dock(p)?.snapped).toBe(true);
  });
  it('bleibt mit 50 Exemplaren lokal und reagiert zügig', () => {
    const p = fixture();
    p.parts[0].quantity = 50;
    for (let i = 2; i < 50; i++) p.placements.push(place(p.parts[0], 400, 200 * i, i));
    const snap = createMagneticSnap(p, p.placements[0]),
      start = performance.now();
    for (let i = 0; i < 30; i++)
      expect(snap({ x: 136, y: 20 + i }, { x: 136, y: 20 + i }, 12)?.snapped).toBe(true);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
