import type { Unit } from './types';

export function parseMeasure(raw: string, defaultUnit: Unit): number {
  const match = raw.trim().match(/^([+\-]?[\d\s.,/]+?)\s*(mm|inch|in|")?$/i);
  if (!match) throw new Error('Bitte ein Maß eingeben, z. B. 25 mm oder 1 1/2 inch.');
  const input = match[1].trim().replace(',', '.');
  const sign = input.startsWith('-') ? -1 : 1;
  const unsigned = input.replace(/^[+-]/, '');
  let value: number;
  if (unsigned.includes('/')) {
    const fraction = unsigned.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/);
    if (!fraction || Number(fraction[3]) === 0)
      throw new Error('Ungültiger Bruch. Beispiel: 1 1/2; der Nenner darf nicht 0 sein.');
    value = sign * (Number(fraction[1] || 0) + Number(fraction[2]) / Number(fraction[3]));
  } else {
    if (!/^\d*\.?\d+$/.test(unsigned))
      throw new Error('Bitte eine Dezimalzahl ohne Tausendertrennzeichen eingeben.');
    value = sign * Number(unsigned);
  }
  const unit = match[2]?.toLowerCase() || defaultUnit;
  const mm = value * (unit === 'mm' ? 1 : 25.4);
  if (!Number.isFinite(mm) || Math.abs(mm) > 1e6)
    throw new Error('Das Maß muss endlich und höchstens 1.000.000 mm groß sein.');
  return mm;
}

export function formatMeasure(mm: number, unit: Unit, upward = false): string {
  const digits = unit === 'mm' ? 3 : 5;
  const scale = 10 ** digits;
  const value = mm / (unit === 'mm' ? 1 : 25.4);
  const rounded = upward ? Math.ceil(value * scale - 1e-7) / scale : value;
  return new Intl.NumberFormat('de-DE', {
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(rounded);
}
export const measureLabel = (mm: number, unit: Unit, upward = false) =>
  `${formatMeasure(mm, unit, upward)} ${unit}`;
