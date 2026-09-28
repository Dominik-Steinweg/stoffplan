import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newPart, newProject, setGrainAngle } from '../../src/domain/model';
import { instanceId, type Project } from '../../src/domain/types';

function fixture() {
  const p = newProject();
  p.fabric.width = 600;
  const part = {
    ...newPart('rectangle', 60, 100),
    name: 'Probe',
    quantity: 2,
    direction: 'either' as const,
  };
  p.parts = [part];
  p.placements = [0, 1].map((i) => ({
    partId: part.id,
    instanceId: instanceId(part.id, i),
    x: 240 + i * 80,
    y: 20,
    rotation: 0 as const,
  }));
  p.variants = [
    {
      id: 'preview',
      strategy: 'rows',
      placements: p.placements.map((q, i) => ({ ...q, x: 20 + i * 80, y: 0 })),
    },
  ];
  return p;
}
async function open(page: Page, p: Project) {
  await page.setViewportSize({ width: 1536, height: 960 });
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles({
    name: 'test.stoffplan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(page.getByTestId('placed-part')).toHaveCount(p.placements.length);
  await page.getByRole('checkbox', { name: 'Einrasten', exact: true }).uncheck();
  // Wait for ResizeObserver to fit the actual canvas instead of its initial 800x650 size.
  await expect
    .poll(() =>
      page.getByLabel('Zeichenfläche', { exact: true }).evaluate((element) => {
        const svg = element as SVGSVGElement;
        const box = svg.getBoundingClientRect(),
          view = svg.viewBox.baseVal;
        return Math.abs(view.width / view.height - box.width / box.height);
      }),
    )
    .toBeLessThan(0.0001);
}
async function save(page: Page) {
  await expect(page.getByText('Lokal gesichert', { exact: true })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Projektdatei speichern' }).click();
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8')) as Project;
}
async function beginDrag(page: Page, dx = 35, dy = 25) {
  const piece = page.getByTestId('placed-part').first();
  const box = (await piece.boundingBox())!;
  const scale = await page
    .getByLabel('Zeichenfläche', { exact: true })
    .evaluate((e) => (e as SVGSVGElement).getScreenCTM()!.a);
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx * scale, y + dy * scale, { steps: 8 });
}

for (const source of ['main', 'applied', 'preview'] as const) {
  test('Verschieben und ein Schritt Rückgängig: ' + source, async ({ page }) => {
    const p = fixture();
    await open(page, p);
    if (source !== 'main') await page.getByTestId('variant-card').click();
    if (source === 'applied')
      await page.getByRole('button', { name: 'Variante übernehmen', exact: true }).click();
    const before = source === 'applied' ? p.variants[0].placements : p.placements;
    const displayed = source === 'main' ? p.placements : p.variants[0].placements;
    const canvas = page.getByLabel('Zeichenfläche', { exact: true });
    const view = await canvas.getAttribute('viewBox');
    await beginDrag(page);
    await expect(canvas).toHaveAttribute('viewBox', view!);
    await page.mouse.up();
    const saved = await save(page);
    expect(saved.placements[0].x).toBeCloseTo(displayed[0].x + 35, 4);
    expect(saved.placements[0].y).toBeCloseTo(displayed[0].y + 25, 4);
    expect(saved.placements[1]).toEqual(displayed[1]);
    expect(saved.variants).toEqual(p.variants);
    expect(saved.layoutSource).toBe('manual');
    await expect(
      page.getByRole('button', { name: 'Variante übernehmen', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
    expect((await save(page)).placements).toEqual(before);
  });
}

test('Klick und Abbruch übernehmen die Vorschau nicht', async ({ page }) => {
  const p = fixture();
  await open(page, p);
  await page.getByTestId('variant-card').click();
  await page.getByTestId('placed-part').first().click();
  expect((await save(page)).placements).toEqual(p.placements);
  await beginDrag(page);
  await page.getByTestId('placed-part').first().dispatchEvent('pointercancel');
  await page.mouse.up();
  await expect(
    page.getByRole('button', { name: 'Variante übernehmen', exact: true }),
  ).toBeVisible();
  expect((await save(page)).placements).toEqual(p.placements);
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toBeDisabled();
});

test('Verschieben mit Raster nach Zoom und Verschieben der Ansicht bleibt maßhaltig', async ({
  page,
}) => {
  const p = fixture();
  await open(page, p);
  await page.getByRole('checkbox', { name: 'Einrasten', exact: true }).check();
  await page.getByRole('button', { name: 'Vergrößern', exact: true }).click();
  const box = (await page.getByTestId('placed-part').first().boundingBox())!;
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 25);
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect((await save(page)).placements).toEqual(p.placements);
  await beginDrag(page, 33, 27);
  await page.mouse.up();
  const saved = await save(page);
  // The default grid step is 25 mm.
  expect(saved.placements[0].x).toBe(275);
  expect(saved.placements[0].y).toBe(50);
});

test('Egal mit 45°-Bezugslinie lässt sich drehen, speichern und auf längs zurücksetzen', async ({
  page,
}) => {
  const p = fixture();
  p.parts[0] = setGrainAngle(p.parts[0], 45);
  p.placements[0].x = 20;
  p.placements[1].x = 220;
  p.variants = [];
  await open(page, p);
  await page.getByTestId('placed-part').first().click();
  const turn = page.getByRole('button', { name: 'Um 90° drehen ↻', exact: true });
  for (const rotation of [90, 180, 270]) {
    await turn.click();
    const saved = await save(page);
    expect(saved.placements[0]).toEqual({ ...p.placements[0], rotation });
  }
  await page.reload();
  await page.getByTestId('placed-part').first().click();
  expect((await save(page)).placements[0].rotation).toBe(270);
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.getByLabel('Stoffrichtung', { exact: true })).toHaveValue('either');
  await expect(page.getByRole('button', { name: 'Bezugslinie 45°', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Stoffrichtung', { exact: true }).selectOption('straight');
  expect((await save(page)).placements[0].rotation).toBe(180);
  await page.getByLabel('Stoffrichtung', { exact: true }).selectOption('either');
  await page.getByRole('button', { name: 'Zuschnitt', exact: true }).click();
  await page.getByTestId('placed-part').first().click();
  await turn.click();
  await turn.click();
  await turn.click();
  expect((await save(page)).placements[0].rotation).toBe(90);
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await page.getByLabel('Stoffrichtung', { exact: true }).selectOption('cross');
  expect((await save(page)).placements[0].rotation).toBe(0);
});

test('Während der Suche bleibt die Vorschau gesperrt; nach Stopp direkt verschiebbar', async ({
  page,
}) => {
  const p = fixture();
  p.parts.push({ ...newPart('triangle', 80, 120), name: 'Dreieck' });
  p.variants = [];
  await open(page, p);
  await page.getByRole('button', { name: 'Automatisch anordnen' }).click();
  await expect(page.getByTestId('placed-part')).toHaveCount(3);
  await beginDrag(page);
  await page.mouse.up();
  expect((await save(page)).placements).toEqual(p.placements);
  await page.getByRole('button', { name: /Suche stoppen/ }).click();
  await expect(
    page.getByText('Zum Bearbeiten ein Teil ziehen oder Variante übernehmen.'),
  ).toBeVisible();
  await beginDrag(page);
  await page.mouse.up();
  const saved = await save(page);
  expect(saved.placements).toHaveLength(3);
  expect(saved.placements).not.toEqual(p.placements);
});

test('Magnetisch andocken hat Vorrang vor Raster, hält Abstand und ist abschaltbar', async ({
  page,
}) => {
  const p = fixture();
  p.fabric.gap = 7;
  await open(page, p);
  const magnet = page.getByRole('checkbox', { name: 'Magnetisch andocken', exact: true });
  await expect(magnet).not.toBeChecked();
  await magnet.check();
  await page.getByRole('checkbox', { name: 'Einrasten', exact: true }).check();
  await beginDrag(page, 17, 0);
  await expect(page.getByTestId('magnet-status')).toHaveText('Magnetisch angedockt');
  await page.screenshot({ path: 'test-results/stoffplan-magnetisch.png', fullPage: true });
  await page.mouse.up();
  const saved = await save(page);
  expect(saved.placements[0]).toEqual({ ...p.placements[0], x: 253 });
  expect(saved.placements[1]).toEqual(p.placements[1]);
  await expect(page.getByText('Vollständig & geprüft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  expect((await save(page)).placements).toEqual(p.placements);
  await magnet.uncheck();
  await beginDrag(page, 17, 0);
  await page.mouse.up();
  expect((await save(page)).placements[0]).toEqual({ ...p.placements[0], x: 250, y: 25 });
});

test('Magnetische Vorschau: Abbruch unverändert, Übernahme und Verschieben gemeinsam rückgängig', async ({
  page,
}) => {
  const p = fixture();
  await open(page, p);
  await page.getByRole('checkbox', { name: 'Magnetisch andocken', exact: true }).check();
  await page.getByTestId('variant-card').click();
  await beginDrag(page, 17, 0);
  await expect(page.getByTestId('magnet-status')).toHaveText('Magnetisch angedockt');
  await page.getByTestId('placed-part').first().dispatchEvent('pointercancel');
  await page.mouse.up();
  expect((await save(page)).placements).toEqual(p.placements);
  await beginDrag(page, 17, 0);
  await page.mouse.up();
  const saved = await save(page);
  expect(saved.placements[0]).toEqual({ ...p.variants[0].placements[0], x: 40 });
  expect(saved.variants).toEqual(p.variants);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  expect((await save(page)).placements).toEqual(p.placements);
});

test('Magnetreichweite bleibt beim Zoomen in Bildschirmpixeln konstant', async ({ page }) => {
  const p = fixture();
  await open(page, p);
  await page.getByRole('checkbox', { name: 'Magnetisch andocken', exact: true }).check();
  const scale = () =>
    page
      .getByLabel('Zeichenfläche', { exact: true })
      .evaluate((e) => (e as SVGSVGElement).getScreenCTM()!.a);
  for (let i = 0; i < 2; i++) {
    await beginDrag(page, 20 + 8 / (await scale()), 0);
    await expect(page.getByTestId('magnet-status')).toHaveText('Magnetisch angedockt');
    await page.mouse.up();
    expect((await save(page)).placements[0].x).toBeCloseTo(260, 5);
    await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
    await page.getByRole('button', { name: 'Vergrößern', exact: true }).click();
  }
  const outside = 260 - 25 / (await scale());
  await beginDrag(page, outside - 240, 0);
  await page.mouse.up();
  expect((await save(page)).placements[0].x).toBeCloseTo(outside, 5);
});

test('Magnetisches Verschieben behält bei Kollisionen die letzte freie Position', async ({
  page,
}) => {
  const p = fixture();
  await open(page, p);
  await page.getByRole('checkbox', { name: 'Magnetisch andocken', exact: true }).check();
  await beginDrag(page, 80, 0);
  await expect(page.getByTestId('magnet-status')).toHaveText('Kein konfliktfreier Platz');
  await page.mouse.up();
  expect((await save(page)).placements[0].x).toBeCloseTo(260, 5);
  await expect(page.getByText('Vollständig & geprüft', { exact: true })).toBeVisible();
});
