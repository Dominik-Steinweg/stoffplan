import type {
  CheckedVariant,
  LayoutStrategy,
  Placement,
  Project,
  ValidationReport,
} from '../domain/types';
import { uid } from '../domain/types';
import { shapeOf, EPS } from '../geometry/contours';
import { validate } from '../geometry/validation';

export const STRATEGY_LABELS: Record<LayoutStrategy, string> = {
  compact: 'Kompakt',
  rows: 'Reihen',
  grouped: 'Nach Schnittteil gruppiert',
};

/** Canonicalize occupied geometry, not interchangeable instance numbers. */
export function layoutFingerprint(project: Project, placements: Placement[]): string {
  const orientations = new Map<string, boolean>();
  const rounded = (n: number) => Math.round(n * 1000);
  const symmetric = (partId: string) => {
    if (!orientations.has(partId)) {
      const part = project.parts.find((p) => p.id === partId)!;
      const signature = (flipped: boolean) =>
        shapeOf(part, project.fabric.seam, flipped)
          .cut.map((poly) =>
            poly
              .map((p) => `${rounded(p.x)},${rounded(p.y)}`)
              .sort()
              .join(';'),
          )
          .sort()
          .join('|');
      orientations.set(partId, signature(false) === signature(true));
    }
    return orientations.get(partId);
  };
  return placements
    .map(
      (p) =>
        `${p.partId}:${rounded(p.x)},${rounded(p.y)},${symmetric(p.partId) ? 0 : Number(p.flipped)}`,
    )
    .sort()
    .join('|');
}

export class VariantPool {
  private entries: (CheckedVariant & { key: string })[] = [];
  constructor(private project: Project) {}
  get variants(): CheckedVariant[] {
    return this.entries.map(({ key: _key, ...variant }) => variant);
  }
  add(
    placements: Placement[],
    strategy: LayoutStrategy,
    report: ValidationReport = validate(this.project, placements),
    id: string = uid(),
  ): boolean {
    if (report.status !== 'valid') return false;
    const before = JSON.stringify(this.entries.map((v) => [v.id, v.strategy]));
    const key = layoutFingerprint(this.project, placements);
    const duplicate = this.entries.find((v) => v.key === key);
    if (duplicate) {
      if (report.requiredLength < duplicate.report.requiredLength) {
        duplicate.placements = structuredClone(placements);
        duplicate.report = report;
      }
      if (duplicate.strategy === 'compact' && strategy !== 'compact') duplicate.strategy = strategy;
    } else
      this.entries.push({ id, strategy, placements: structuredClone(placements), report, key });
    this.entries.sort(
      (a, b) => a.report.requiredLength - b.report.requiredLength || a.key.localeCompare(b.key),
    );
    const limit = this.entries[0].report.requiredLength * 1.2;
    this.entries = this.entries.filter((v) => v.report.requiredLength <= limit + EPS);
    const keep = new Set([this.entries[0]]);
    for (const type of ['rows', 'grouped'] as const) {
      const variant = this.entries.find((v) => v.strategy === type);
      if (variant) keep.add(variant);
    }
    for (const entry of this.entries) {
      if (keep.size >= 10) break;
      keep.add(entry);
    }
    this.entries = this.entries.filter((v) => keep.has(v));
    return before !== JSON.stringify(this.entries.map((v) => [v.id, v.strategy]));
  }
}

export function reviewVariants(
  project: Project,
  warn: (message: string) => void = () => {},
): Project {
  const pool = new VariantPool(project);
  for (const variant of project.variants) {
    try {
      pool.add(
        variant.placements,
        variant.strategy,
        validate(project, variant.placements),
        variant.id,
      );
    } catch {
      /* Preserve the main editable project even when a saved alternative is unusable. */
    }
  }
  const variants = pool.variants.map(({ report: _report, ...variant }) => variant);
  if (variants.length < project.variants.length)
    warn(
      'Veraltete oder ungültige Anordnungsvarianten wurden entfernt. Die Hauptanordnung bleibt erhalten.',
    );
  return { ...project, variants };
}
