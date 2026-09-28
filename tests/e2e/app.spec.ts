import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { newPart, newProject } from '../../src/domain/model';

async function example(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Maßprobe · 620 mm' }).click();
}
async function arrange(page: Page) {
  await page.getByRole('button', { name: 'Automatisch anordnen' }).click();
  await expect(page.getByTestId('required-length')).toHaveText('620 mm');
  const stop = page.getByRole('button', { name: /Suche stoppen/ });
  if (await stop.isVisible()) await stop.click();
  await page.getByRole('button', { name: 'Variante übernehmen', exact: true }).click();
  await expect(page.getByText('Vollständig & geprüft', { exact: true })).toBeVisible();
}
async function fillMeasure(page: Page, label: string, value: string) {
  const input = page.getByRole('textbox', { name: label, exact: true });
  await input.fill(value);
  await input.press('Enter');
}

test('gemeldetes Kurvenprojekt: kompakter Vorschlag und reguläres Suchende', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1536, height: 960 });
  await page.goto('./');
  await expect(page.getByLabel('Projektname', { exact: true })).toBeVisible();
  await page
    .locator('input[type=file]')
    .setInputFiles(resolve('tests/fixtures/curved-project.stoffplan.json'));
  const started = Date.now();
  await page.getByRole('button', { name: 'Automatisch anordnen' }).click();
  await expect(page.getByTestId('required-length')).toHaveText('588,498 mm', { timeout: 5000 });
  await expect(page.getByTestId('placed-count')).toHaveText('3 / 3');
  await expect(page.getByRole('button', { name: 'Automatisch anordnen' })).toBeVisible({
    timeout: 35000,
  });
  expect(Date.now() - started).toBeLessThan(35000);
  await expect(page.getByText('Vollständiger Vorschlag gefunden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Variante übernehmen', exact: true }).click();
  await expect(page.getByText('Vollständig & geprüft', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/stoffplan-kurven-regression.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('vollständiger Ablauf: anordnen, manuell ändern, rückgängig, speichern und wieder öffnen', async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const externalRequests: string[] = [];
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== new URL(baseURL!).origin) {
      externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.setViewportSize({ width: 1536, height: 960 });
  await example(page);
  await arrange(page);
  await expect(page.getByTestId('placed-count')).toHaveText('2 / 2');
  await page.screenshot({ path: 'test-results/stoffplan-zuschnitt.png', fullPage: true });
  await page.getByTestId('placed-part').first().click();
  await fillMeasure(page, 'Position Y', '40 mm');
  await expect(page.getByTestId('required-length')).toHaveText('660 mm');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.getByTestId('required-length')).toHaveText('620 mm');
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(page.getByTestId('required-length')).toHaveText('660 mm');
  await page.getByRole('button', { name: 'Um 180° drehen' }).click();
  await expect(page.getByText('Lokal gesichert', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Projektdatei speichern' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const saved = JSON.parse(await readFile(path!, 'utf8'));
  expect(saved.placements).toHaveLength(2);
  expect(saved.placements[0].y).toBe(40);
  expect(saved.placements[0].flipped).toBe(true);
  await page.reload();
  await expect(page.getByTestId('required-length')).toHaveText('660 mm');
  await expect(page.getByText('Vollständig & geprüft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: '+ Neues Projekt' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'probe.stoffplan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(page.getByTestId('required-length')).toHaveText('660 mm');
  await expect(page.getByRole('button', { name: /Suche stoppen/ })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('Einheitenwechsel und gemischte Eingaben verändern keine Geometrie', async ({ page }) => {
  await example(page);
  await arrange(page);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Inch in', exact: true }).click();
    await page.getByRole('button', { name: 'Millimeter mm', exact: true }).click();
  }
  await expect(page.getByTestId('required-length')).toHaveText('620 mm');
  await page.getByRole('button', { name: 'Inch in', exact: true }).click();
  await fillMeasure(page, 'Teileabstand', '1/8 inch');
  await page.getByRole('button', { name: 'Millimeter mm', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Teileabstand', exact: true })).toHaveValue(
    '3,175',
  );
  await fillMeasure(page, 'Teileabstand', '1/0 inch');
  await expect(page.getByRole('alert')).toContainText('Ungültiger Bruch');
});

test('619 mm sind zu kurz; Überschneidungen werden sichtbar', async ({ page }) => {
  await example(page);
  await arrange(page);
  await page.getByLabel('Planungsmodus', { exact: true }).selectOption('fixed');
  await fillMeasure(page, 'Verfügbare Stofflänge', '619');
  await expect(page.getByText('Anordnung prüfen', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Grundteil: Stoffgrenze oder Randreserve verletzt.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Planungsmodus', { exact: true }).selectOption('auto');
  await page.getByTestId('placed-part').last().click();
  await fillMeasure(page, 'Position X', '21');
  await expect(
    page.getByText('Zwei Zuschneidekonturen überlappen.', { exact: true }),
  ).toBeVisible();
});

test('Formeditor, Kurven, Spiegelvorschau und Undo', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await example(page);
  await page.getByRole('button', { name: /Grundteil Längs/ }).click();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await fillMeasure(page, 'Formbreite', '15 inch');
  await expect(page.getByRole('textbox', { name: 'Formbreite', exact: true })).toHaveValue('381');
  await page.getByRole('button', { name: 'Ausgehende Kante zur Kurve machen' }).click();
  await fillMeasure(page, 'Ausgang Y', '-50 mm');
  await page.getByRole('button', { name: 'Punkt einfügen', exact: true }).click();
  await expect(page.getByText('5 Punkte', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/stoffplan-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Grundteil spiegeln', exact: true }).click();
  await page.getByRole('button', { name: 'Oben ↔ unten' }).click();
  await page.getByRole('button', { name: 'Gespiegelte Kopie erstellen', exact: true }).click();
  await expect(page.getByLabel('Teilname', { exact: true })).toHaveValue('Grundteil · gespiegelt');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.getByRole('button', { name: /Grundteil · gespiegelt/ })).toHaveCount(0);
});

test('beschädigte Dateien lassen das offene Projekt unverändert', async ({ page }) => {
  await example(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'broken.stoffplan.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":99}'),
  });
  await expect(page.getByRole('alert')).toContainText('Projektversion');
  await expect(page.getByLabel('Projektname', { exact: true })).toHaveValue(
    'Maßprobe · zwei Rechtecke',
  );
});

test('50 Exemplare: Bedienung bleibt möglich, Stopp und Verwerfen erhalten den Ausgangsstand', async ({
  page,
}) => {
  const p = newProject();
  p.fabric = { mode: 'auto', width: 1400, length: 2000, seam: 5, reserve: 10, gap: 3 };
  p.parts = Array.from({ length: 5 }, (_, i) => ({
    ...newPart(i === 4 ? 'free' : i % 2 ? 'triangle' : 'rectangle', 100 + i * 20, 150 + i * 25),
    quantity: 10,
  }));
  await page.goto('./');
  await expect(page.getByLabel('Projektname', { exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: '50-teile.stoffplan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole('button', { name: 'Automatisch anordnen' }).click();
  await expect(page.getByTestId('placed-count')).toHaveText('50 / 50', { timeout: 10000 });
  await page.getByRole('checkbox', { name: 'Raster', exact: true }).uncheck();
  const before = Date.now();
  await page.getByRole('button', { name: /Suche stoppen/ }).click();
  await expect(page.getByRole('button', { name: 'Automatisch anordnen' })).toBeVisible();
  expect(Date.now() - before).toBeLessThan(1000);
  await page.getByRole('button', { name: 'Vorschau verwerfen' }).click();
  await expect(page.getByTestId('placed-count')).toHaveText('0 / 50');
  await page.getByRole('button', { name: 'Automatisch anordnen' }).click();
  await fillMeasure(page, 'Stoffbreite', '1000');
  await expect(page.getByRole('button', { name: /Suche stoppen/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Variante übernehmen', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByTestId('placed-count')).toHaveText('0 / 50');
});

test('Freie Form zeichnen, per Maus ändern und Zoom ohne Maßänderung', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Freie Form zeichnen' }).click();
  const canvas = page.getByLabel('Zeichenfläche', { exact: true }),
    box = (await canvas.boundingBox())!;
  for (const [x, y] of [
    [0.35, 0.25],
    [0.7, 0.25],
    [0.6, 0.7],
    [0.35, 0.7],
  ])
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await page.getByRole('button', { name: 'Umriss schließen', exact: true }).click();
  await expect(page.getByText('4 Punkte', { exact: true })).toBeVisible();
  const width = await page.getByRole('textbox', { name: 'Formbreite', exact: true }).inputValue();
  await page.getByRole('button', { name: 'Vergrößern', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Formbreite', exact: true })).toHaveValue(width);
  const point = page.getByLabel('Punkt 1', { exact: true }),
    pointBox = (await point.boundingBox())!;
  await page.mouse.move(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    pointBox.x + pointBox.width / 2 + 30,
    pointBox.y + pointBox.height / 2 + 20,
    { steps: 5 },
  );
  await page.mouse.up();
  const x = await page.getByRole('textbox', { name: 'Punkt X', exact: true }).inputValue();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Punkt X', exact: true })).not.toHaveValue(x);
});
