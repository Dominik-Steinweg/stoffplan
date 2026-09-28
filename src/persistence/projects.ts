import type { Project } from '../domain/types';
import { COLORS } from '../domain/model';
import { reviewVariants } from '../optimization/variants';
import { initGeometry } from '../geometry/kernel';

function placements(value: unknown, legacyRotation: boolean) {
  if (!Array.isArray(value) || value.length > 500)
    throw new Error('Ungültige Platzierungsliste (maximal 500 Exemplare).');
  for (const entry of value) {
    const placement = object(entry);
    text(placement.instanceId);
    text(placement.partId);
    number(placement.x);
    number(placement.y);
    if (legacyRotation) {
      if (typeof placement.flipped !== 'boolean') throw new Error('Ungültige Drehvariante.');
      placement.rotation = placement.flipped ? 180 : 0;
      delete placement.flipped;
    }
    if (![0, 90, 180, 270].includes(placement.rotation as number))
      throw new Error('Ungültige Drehvariante.');
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Ungültige Projektstruktur.');
  return value as Record<string, unknown>;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 500)
    throw new Error('Ungültiger Name oder Bezeichner.');
}
function number(value: unknown, min = -1e6, max = 1e6): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('Ungültiges Maß in der Projektdatei.');
}
function point(value: unknown) {
  const p = object(value);
  number(p.x);
  number(p.y);
}
export function parseProject(raw: string): Project {
  if (raw.length > 10_000_000) throw new Error('Die Projektdatei ist zu groß (maximal 10 MB).');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Die Datei enthält kein gültiges JSON.');
  }
  const p = object(parsed);
  const legacy = p.schemaVersion === 1;
  const legacyRotation = legacy || p.schemaVersion === 2;
  if (!legacyRotation && p.schemaVersion !== 3)
    throw new Error(
      'Diese Projektversion wird nicht unterstützt. Erwartet wird Version 1, 2 oder 3.',
    );
  text(p.id);
  text(p.name);
  text(p.updatedAt);
  if (
    !p.id ||
    !['mm', 'inch'].includes(p.unit as string) ||
    !['manual', 'optimized'].includes(p.layoutSource as string)
  )
    throw new Error('Ungültige Projekteinstellungen.');
  const f = object(p.fabric);
  if (!['auto', 'fixed'].includes(f.mode as string)) throw new Error('Unbekannter Stoffmodus.');
  for (const key of ['width', 'length', 'seam', 'reserve', 'gap']) number(f[key], 0);
  if (
    !Array.isArray(p.parts) ||
    p.parts.length > 200 ||
    !Array.isArray(p.placements) ||
    p.placements.length > 500
  )
    throw new Error('Zu viele Teile (maximal 500 Exemplare).');
  const ids = new Set<string>();
  let count = 0;
  for (const entry of p.parts) {
    const part = object(entry);
    text(part.id);
    text(part.name);
    number(part.quantity, 1, 500);
    if (!part.id || ids.has(part.id) || !Number.isInteger(part.quantity))
      throw new Error('Doppelte Teile-ID oder ungültige Stückzahl.');
    ids.add(part.id);
    if (legacy) part.color = COLORS[(ids.size - 1) % COLORS.length];
    if (typeof part.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(part.color))
      throw new Error('Ungültige Schnittteilfarbe.');
    count += part.quantity;
    if (
      typeof part.mirrored !== 'boolean' ||
      !['straight', 'cross', 'either'].includes(part.direction as string)
    )
      throw new Error('Ungültige Ausrichtung.');
    const grain = object(part.grain);
    point(grain.start);
    point(grain.end);
    const contour = object(part.contour);
    if (
      typeof contour.closed !== 'boolean' ||
      !Array.isArray(contour.nodes) ||
      contour.nodes.length > 256
    )
      throw new Error('Ungültiger Umriss (maximal 256 Punkte).');
    for (const entry of contour.nodes) {
      const n = object(entry);
      point(n);
      if (n.in !== undefined) point(n.in);
      if (n.out !== undefined) point(n.out);
    }
    if (contour.primitive !== undefined) {
      const primitive = object(contour.primitive);
      if (
        legacy ||
        !['circle', 'ellipse'].includes(primitive.kind as string) ||
        !contour.closed ||
        contour.nodes.length
      )
        throw new Error('Ungültige parametrische Grundform.');
      point(primitive.center);
      number(primitive.rx, 0);
      number(primitive.ry, 0);
      if (
        !primitive.rx ||
        !primitive.ry ||
        (primitive.kind === 'circle' && primitive.rx !== primitive.ry)
      )
        throw new Error('Ungültige Kreis- oder Ovalmaße.');
    }
  }
  if (count > 500)
    throw new Error('Maximal 500 Exemplare werden unterstützt; empfohlen sind bis zu 50.');
  placements(p.placements, legacyRotation);
  if (legacy) p.variants = [];
  if (!Array.isArray(p.variants) || p.variants.length > 10)
    throw new Error('Maximal zehn Anordnungsvarianten werden unterstützt.');
  const variantIds = new Set<string>();
  for (const entry of p.variants) {
    const variant = object(entry);
    text(variant.id);
    if (
      !variant.id ||
      variantIds.has(variant.id) ||
      !['compact', 'rows', 'grouped'].includes(variant.strategy as string)
    )
      throw new Error('Ungültige Anordnungsvariante.');
    variantIds.add(variant.id);
    placements(variant.placements, legacyRotation);
  }
  p.schemaVersion = 3;
  return parsed as Project;
}
export const serializeProject = (project: Project) => JSON.stringify(project, null, 2);

let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('stoffplan', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(
        new Error(
          'Der lokale Projektspeicher ist nicht verfügbar. Bitte eine Projektdatei speichern.',
        ),
      );
    };
  }));
}
export async function saveProject(project: Project): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(project);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(new Error('Lokale Sicherung fehlgeschlagen. Bitte eine Projektdatei speichern.'));
  });
}
export async function listProjects(warn?: (message: string) => void): Promise<Project[]> {
  await initGeometry();
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('projects').objectStore('projects').getAll();
    request.onsuccess = () => {
      try {
        resolve(
          request.result
            .map((p) => reviewVariants(parseProject(JSON.stringify(p)), warn))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        );
      } catch (e) {
        reject(e);
      }
    };
    request.onerror = () =>
      reject(new Error('Die gespeicherten Projekte konnten nicht geöffnet werden.'));
  });
}
export function downloadProject(project: Project) {
  const url = URL.createObjectURL(
    new Blob([serializeProject(project)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name.replace(/[^\p{L}\p{N}_-]/gu, '_') || 'Projekt'}.stoffplan.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
