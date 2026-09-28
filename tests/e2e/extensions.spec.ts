import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newPart, newProject } from '../../src/domain/model';
import { instanceId } from '../../src/domain/types';

async function fill(page: Page, label: string, value: string) {
  const input = page.getByRole('textbox', { name: label, exact: true });
  await input.fill(value);
  await input.press('Enter');
}
async function save(page: Page) {
  await expect(page.getByText('Lokal gesichert', { exact: true })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Projektdatei speichern' }).click();
  const download = await pending;
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}
async function setColor(page: Page, color: string) {
  await page.getByLabel('Schnittteilfarbe', { exact: true }).evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, color);
}

test('Kreis, Oval, Farbe und Winkelvorgaben bleiben maßhaltig und speicherbar', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Kreis hinzufügen' }).click();
  await expect(page.getByRole('textbox', { name: 'Durchmesser', exact: true })).toHaveValue('400');
  await fill(page, 'Durchmesser', '10 inch');
  await setColor(page, '#d23f80');
  await page.getByRole('button', { name: 'Bezugslinie 45°', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bezugslinie 45°', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByText('Bezugslinie präzise einstellen', { exact: true }).click();
  await fill(page, 'Ende X', '180');
  await expect(page.getByText(/Benutzerdefiniert ·/)).toBeVisible();
  await fill(page, 'Stoffbreite', '800');
  await page.getByRole('button', { name: 'Zuschnitt', exact: true }).click();
  await page.getByRole('button', { name: 'Kreis 1 manuell platzieren', exact: true }).click();
  await expect(page.getByText('Vollständig & geprüft', { exact: true })).toBeVisible();
  await expect(page.getByTestId('placed-part').locator('path').first()).toHaveAttribute(
    'fill',
    '#d23f8090',
  );
  const saved = await save(page);
  expect(saved.schemaVersion).toBe(3);
  expect(saved.parts[0].contour.primitive).toMatchObject({ kind: 'circle', rx: 127, ry: 127 });
  expect(saved.parts[0].color).toBe('#d23f80');
  expect(saved.parts[0].grain.end.x).toBe(180);
  await page.reload();
  await page.getByRole('button', { name: /Kreis 1 Längs/ }).click();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.getByLabel('Schnittteilfarbe', { exact: true })).toHaveValue('#d23f80');
  await expect(page.getByRole('textbox', { name: 'Durchmesser', exact: true })).toHaveValue('254');
  await page.getByRole('button', { name: 'In freie Form umwandeln' }).click();
  await expect(page.getByText('32 Punkte', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Durchmesser', exact: true })).toHaveValue('254');
  await page.getByRole('button', { name: 'Oval hinzufügen' }).click();
  await expect(page.getByRole('textbox', { name: 'Formbreite', exact: true })).toHaveValue('400');
  await expect(page.getByRole('textbox', { name: 'Formhöhe', exact: true })).toHaveValue('600');
  await fill(page, 'Formhöhe', '350');
  await page.getByRole('button', { name: 'Oval 2 spiegeln', exact: true }).click();
  await page.getByRole('button', { name: 'Gespiegelte Kopie erstellen', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Formhöhe', exact: true })).toHaveValue('350');
  await page.screenshot({ path: 'test-results/stoffplan-runde-formen.png', fullPage: true });
});

test('Nullpunkt bleibt ohne Raster sichtbar und wird nach Zoom und Verschieben exakt gefangen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Freie Form zeichnen' }).click();
  await page.getByRole('checkbox', { name: 'Raster', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Einrasten', exact: true }).check();
  await expect(page.getByTestId('origin-marker')).toBeVisible();
  await page.getByRole('button', { name: 'Vergrößern', exact: true }).click();
  const canvas = page.getByLabel('Zeichenfläche', { exact: true });
  const box = (await canvas.boundingBox())!;
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30);
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.getByRole('button', { name: 'Zum Nullpunkt' }).click();
  const at = async (x: number, y: number) =>
    canvas.evaluate(
      (element, p) => {
        const svg = element as SVGSVGElement,
          point = svg.createSVGPoint();
        point.x = p.x;
        point.y = p.y;
        const screen = point.matrixTransform(svg.getScreenCTM()!);
        return { x: screen.x, y: screen.y };
      },
      { x, y },
    );
  const zero = await at(0, 0);
  await page.mouse.move(zero.x + 3, zero.y + 2);
  await expect(page.getByTestId('cursor-coordinates')).toHaveText('X: 0 · Y: 0 mm · eingerastet');
  await page.mouse.click(zero.x + 3, zero.y + 2);
  for (const [x, y] of [
    [200, 0],
    [200, 100],
    [0, 100],
  ]) {
    const point = await at(x, y);
    await page.mouse.click(point.x, point.y);
  }
  await page.getByRole('button', { name: 'Umriss schließen' }).click();
  await page.getByLabel('Ausgewählter Punkt', { exact: true }).selectOption('0');
  await expect(page.getByRole('textbox', { name: 'Punkt X', exact: true })).toHaveValue('0');
  await expect(page.getByRole('textbox', { name: 'Punkt Y', exact: true })).toHaveValue('0');
  await expect(page.getByRole('textbox', { name: 'Formbreite', exact: true })).toHaveValue('200');
  await page.getByRole('button', { name: 'Inch in', exact: true }).click();
  const target = await at(25.4, 25.4);
  await page.getByRole('checkbox', { name: 'Einrasten', exact: true }).uncheck();
  await page.mouse.move(target.x, target.y);
  await expect(page.getByTestId('cursor-coordinates')).toContainText('inch');
  const saved = await save(page);
  expect(saved.parts[0].contour.nodes[0]).toEqual({ x: 0, y: 0 });
  await page.screenshot({ path: 'test-results/stoffplan-nullpunkt.png', fullPage: true });
});

test('Suche speichert Alternativen; Auswahl, Übernahme, Reload und Invalidierung funktionieren', async ({
  page,
}) => {
  const p = newProject();
  p.fabric.width = 100;
  p.parts = [
    newPart('rectangle', 60, 100),
    { ...newPart('rectangle', 40, 80), quantity: 2, color: '#d0ad79' },
  ];
  p.parts[0].name = 'A';
  p.parts[1].name = 'B';
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles({
    name: 'alternativen.stoffplan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole('button', { name: 'Automatisch anordnen' }).click();
  await expect(page.getByTestId('required-length')).toHaveText('160 mm');
  await page.getByRole('button', { name: /Suche stoppen/ }).click();
  await expect(page.getByTestId('variant-card').nth(1)).toBeVisible();
  const archived = await save(page);
  expect(archived.placements).toEqual([]);
  expect(archived.variants.length).toBeGreaterThanOrEqual(2);
  await page.getByTestId('variant-card').filter({ hasText: '180 mm' }).first().click();
  await expect(page.getByTestId('required-length')).toHaveText('180 mm');
  await page.getByRole('button', { name: 'Variante übernehmen', exact: true }).click();
  await expect(page.getByText('Vollständig & geprüft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.getByTestId('placed-count')).toHaveText('0 / 3');
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(page.getByTestId('required-length')).toHaveText('180 mm');
  await expect(page.getByText('Lokal gesichert', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('required-length')).toHaveText('180 mm');
  await expect(page.getByTestId('variant-card').nth(1)).toBeVisible();
  await page.getByRole('button', { name: /A Längs/ }).click();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await setColor(page, '#8040d0');
  await page.getByLabel('Teilname', { exact: true }).fill('A neu');
  const styled = await save(page);
  expect(styled.variants).toEqual(archived.variants);
  await page.getByRole('button', { name: 'Zuschnitt', exact: true }).click();
  await expect(
    page.getByTestId('placed-part').filter({ hasText: 'A neu' }).locator('path').first(),
  ).toHaveAttribute('fill', '#8040d090');
  await page.screenshot({ path: 'test-results/stoffplan-varianten.png', fullPage: true });
  await page.getByRole('button', { name: 'Inch in', exact: true }).click();
  await expect(page.getByTestId('variant-card').nth(1)).toBeVisible();
  await page.getByRole('button', { name: 'Millimeter mm', exact: true }).click();
  await fill(page, 'Stoffbreite', '120');
  await expect(page.getByTestId('variant-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.getByTestId('variant-card').nth(1)).toBeVisible();
});

test('gespeicherte ungültige Varianten werden mit Hinweis verworfen', async ({ page }) => {
  const p = newProject();
  p.fabric.width = 200;
  const part = newPart('rectangle', 50, 50);
  p.parts = [part];
  p.variants = [
    {
      id: 'outside',
      strategy: 'rows',
      placements: [
        { partId: part.id, instanceId: instanceId(part.id, 0), x: 300, y: 0, rotation: 0 as const },
      ],
    },
  ];
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles({
    name: 'veraltet.stoffplan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(page.getByRole('alert')).toContainText('Anordnungsvarianten wurden entfernt');
  await expect(page.getByTestId('placed-count')).toHaveText('0 / 1');
  await expect(page.getByTestId('variant-card')).toHaveCount(0);
});
