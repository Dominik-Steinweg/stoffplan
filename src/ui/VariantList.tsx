import type { CheckedVariant, Project } from '../domain/types';
import { measureLabel } from '../domain/units';
import { shapeOf } from '../geometry/contours';
import { polygonPath } from '../geometry/kernel';
import { STRATEGY_LABELS } from '../optimization/variants';

export function VariantList({
  project,
  variants,
  selectedId,
  onSelect,
}: {
  project: Project;
  variants: CheckedVariant[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!variants.length) return null;
  const best = variants[0].report.requiredLength;
  return (
    <section className="variant-list" aria-label="Anordnungsvarianten">
      <h3>
        Anordnungsvarianten <span className="count-tag">{variants.length}</span>
      </h3>
      <p className="help">Vorschau auswählen · höchstens 20 % Mehrbedarf</p>
      {variants.map((variant, index) => (
        <button
          type="button"
          className="variant-card"
          data-testid="variant-card"
          key={variant.id}
          aria-label={`Variante ${index + 1} · ${STRATEGY_LABELS[variant.strategy]} · ${measureLabel(variant.report.requiredLength, project.unit, true)}`}
          aria-pressed={selectedId === variant.id}
          onClick={() => onSelect(variant.id)}
        >
          <svg
            viewBox={`0 0 ${Math.max(1, project.fabric.width)} ${Math.max(1, variant.report.requiredLength)}`}
            aria-hidden="true"
          >
            <rect
              width={project.fabric.width}
              height={variant.report.requiredLength}
              fill="#fffdf7"
            />
            {variant.placements.map((placement) => {
              const part = project.parts.find((p) => p.id === placement.partId)!;
              const shape = shapeOf(part, project.fabric.seam, placement.flipped);
              return (
                <path
                  key={placement.instanceId}
                  d={polygonPath(shape.cut)}
                  transform={`translate(${placement.x} ${placement.y})`}
                  fill={part.color}
                  stroke="#4b6255"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
          <span>
            <strong>
              {index + 1} · {measureLabel(variant.report.requiredLength, project.unit, true)}
            </strong>
            <small>{STRATEGY_LABELS[variant.strategy]}</small>
            <small>
              {index === 0
                ? 'Kürzeste gefunden'
                : `+${((variant.report.requiredLength / best - 1) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % Mehrbedarf`}
            </small>
          </span>
        </button>
      ))}
    </section>
  );
}
