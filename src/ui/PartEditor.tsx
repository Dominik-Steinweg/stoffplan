import { useRef, useState, type PointerEvent } from 'react';
import type { PartDefinition, Point, Unit } from '../domain/types';
import { grainAngle, mapPart, setGrainAngle } from '../domain/model';
import { toFreeContour } from '../geometry/primitives';
import { bounds, offset, polygonPath, positive } from '../geometry/kernel';
import { contourError, contourPath, flatten } from '../geometry/contours';
import { measureLabel } from '../domain/units';
import { Canvas, eventPoint, drawingEventPoint } from './Canvas';
import { MeasureInput } from './MeasureInput';

export function PartEditor({
  part,
  seam,
  unit,
  grid,
  gridStep,
  snap,
  selectedNode,
  onSelectNode,
  onChange,
}: {
  part: PartDefinition;
  seam: number;
  unit: Unit;
  grid: boolean;
  gridStep: number;
  snap: boolean;
  selectedNode: number;
  onSelectNode: (index: number) => void;
  onChange: (part: PartDefinition) => void;
}) {
  const [draft, setDraft] = useState<PartDefinition | null>(null);
  const drag = useRef<{
    part: PartDefinition;
    index: number;
    kind: 'node' | 'in' | 'out' | 'grainStart' | 'grainEnd';
    start: Point;
  } | null>(null);
  const latest = useRef<PartDefinition | null>(null);
  const visible = draft || part;
  let error: string | null = null,
    cut: Point[][] = [],
    base: Point[] = [];
  try {
    base = flatten(visible.contour);
    error = contourError(visible.contour, base);
    if (!error) cut = offset([positive(base)], seam);
  } catch (e) {
    error = (e as Error).message;
  }
  const b = base.length > 1 ? bounds([base]) : { minX: 0, minY: 0, width: 400, height: 600 };
  function down(
    event: PointerEvent<SVGCircleElement>,
    index: number,
    kind: NonNullable<typeof drag.current>['kind'],
  ) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectNode(index);
    drag.current = { part, index, kind, start: eventPoint(event) };
    latest.current = null;
  }
  function move(event: PointerEvent<SVGCircleElement>) {
    const d = drag.current;
    if (!d) return;
    const p = drawingEventPoint(event, snap, gridStep);
    const next = structuredClone(d.part);
    if (d.kind === 'grainStart' || d.kind === 'grainEnd')
      next.grain[d.kind === 'grainStart' ? 'start' : 'end'] = p;
    else {
      const n = next.contour.nodes[d.index];
      if (d.kind === 'node') {
        const dx = p.x - n.x,
          dy = p.y - n.y;
        n.x = p.x;
        n.y = p.y;
        if (n.in) n.in = { x: n.in.x + dx, y: n.in.y + dy };
        if (n.out) n.out = { x: n.out.x + dx, y: n.out.y + dy };
      } else n[d.kind] = p;
    }
    setDraft(next);
    latest.current = next;
  }
  function up() {
    if (latest.current) onChange(latest.current);
    drag.current = null;
    latest.current = null;
    setDraft(null);
  }
  const handlers = {
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: () => {
      drag.current = null;
      latest.current = null;
      setDraft(null);
    },
  };
  return (
    <div className="editor-stage">
      <Canvas
        extent={{
          x: b.minX - seam,
          y: b.minY - seam,
          width: Math.max(b.width, 100) + 2 * seam,
          height: Math.max(b.height, 100) + 2 * seam,
        }}
        fitKey={part.id}
        grid={grid}
        gridStep={gridStep}
        unit={unit}
        snap={snap}
        origin
        footer={
          !part.contour.closed
            ? 'Auf die Zeichenfläche klicken, um Punkte zu setzen. Danach Umriss schließen.'
            : undefined
        }
        onBackgroundClick={
          !part.contour.closed
            ? (p) => {
                if (part.contour.nodes.length >= 256) return;
                onChange({
                  ...part,
                  contour: { ...part.contour, nodes: [...part.contour.nodes, p] },
                });
                onSelectNode(part.contour.nodes.length);
              }
            : undefined
        }
      >
        {(u) => (
          <>
            {cut.length > 0 && (
              <path
                d={polygonPath(cut)}
                fill="#dfc9a140"
                stroke="#b89252"
                strokeWidth={1.5 * u}
                strokeDasharray={`${5 * u} ${3 * u}`}
                pointerEvents="none"
              />
            )}
            <path
              d={contourPath(visible.contour)}
              fill={visible.contour.closed ? `${visible.color}40` : 'none'}
              stroke={error && visible.contour.closed ? '#be5149' : visible.color}
              strokeWidth={2 * u}
              pointerEvents="none"
            />
            <g stroke="#496b61" strokeWidth={1.5 * u} fill="none">
              <path
                d={`M${visible.grain.start.x},${visible.grain.start.y}L${visible.grain.end.x},${visible.grain.end.y}`}
                strokeDasharray={`${7 * u} ${4 * u}`}
              />
            </g>
            {(['start', 'end'] as const).map((key, i) => (
              <circle
                key={key}
                aria-label={`Bezugslinie ${key}`}
                cx={visible.grain[key].x}
                cy={visible.grain[key].y}
                r={5 * u}
                fill="#fff"
                stroke="#345f91"
                strokeWidth={2 * u}
                onPointerDown={(e) => down(e, selectedNode, i ? 'grainEnd' : 'grainStart')}
                {...handlers}
              />
            ))}
            {visible.contour.nodes.map((n, i) => (
              <g key={i}>
                {i === selectedNode &&
                  (['in', 'out'] as const).map(
                    (key) =>
                      n[key] && (
                        <g key={key}>
                          <line
                            x1={n.x}
                            y1={n.y}
                            x2={n[key]!.x}
                            y2={n[key]!.y}
                            stroke="#9f855c"
                            strokeWidth={u}
                          />
                          <circle
                            cx={n[key]!.x}
                            cy={n[key]!.y}
                            r={4 * u}
                            fill="#fff5dd"
                            stroke="#a37e3c"
                            strokeWidth={1.5 * u}
                            onPointerDown={(e) => down(e, i, key)}
                            {...handlers}
                          />
                        </g>
                      ),
                  )}
                <circle
                  aria-label={`Punkt ${i + 1}`}
                  cx={n.x}
                  cy={n.y}
                  r={(selectedNode === i ? 6 : 4) * u}
                  fill={selectedNode === i ? '#254e42' : '#fff'}
                  stroke="#254e42"
                  strokeWidth={1.5 * u}
                  onPointerDown={(e) => down(e, i, 'node')}
                  {...handlers}
                />
                <text
                  x={n.x + 9 * u}
                  y={n.y - 9 * u}
                  fontSize={11 * u}
                  fill="#415c50"
                  pointerEvents="none"
                >
                  {i + 1}
                </text>
              </g>
            ))}
            {base.length > 1 && (
              <text
                x={b.minX + b.width / 2}
                y={b.minY + b.height + seam + 28 * u}
                textAnchor="middle"
                fontSize={12 * u}
                fill="#617368"
                pointerEvents="none"
              >
                {measureLabel(b.width, unit)} × {measureLabel(b.height, unit)} · Grundform
              </text>
            )}
          </>
        )}
      </Canvas>
      {error && (
        <div className={`canvas-message ${part.contour.closed ? 'warning' : ''}`}>
          {part.contour.closed ? error : 'Punkte setzen · mindestens drei, dann schließen'}
        </div>
      )}
    </div>
  );
}

export function PartInspector({
  part,
  unit,
  selectedNode,
  onSelectNode,
  onChange,
}: {
  part: PartDefinition;
  unit: Unit;
  selectedNode: number;
  onSelectNode: (i: number) => void;
  onChange: (part: PartDefinition) => void;
}) {
  const nodes = part.contour.nodes,
    node = nodes[selectedNode];
  const primitive = part.contour.primitive;
  const angle = grainAngle(part);
  const preset = [0, 45, 90].find((v) => Math.abs(angle - v) < 0.000001);
  let b = { minX: 0, minY: 0, width: 0, height: 0 };
  try {
    if (nodes.length || primitive) b = bounds([flatten(part.contour)]);
  } catch {
    /* error shown in canvas */
  }
  function patchNode(key: 'x' | 'y', value: number, control?: 'in' | 'out') {
    const next = structuredClone(part),
      n = next.contour.nodes[selectedNode];
    if (control) n[control] = { ...n[control]!, [key]: value };
    else {
      const delta = value - n[key];
      n[key] = value;
      if (n.in) n.in[key] += delta;
      if (n.out) n.out[key] += delta;
    }
    onChange(next);
  }
  function toggleCurve() {
    const next = structuredClone(part),
      a = next.contour.nodes[selectedNode],
      b = next.contour.nodes[(selectedNode + 1) % nodes.length];
    if (a.out || b.in) {
      delete a.out;
      delete b.in;
    } else {
      a.out = { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
      b.in = { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 };
    }
    onChange(next);
  }
  function insertPoint() {
    const next = structuredClone(part),
      a = next.contour.nodes[selectedNode],
      b = next.contour.nodes[(selectedNode + 1) % nodes.length];
    const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    if (a.out || b.in) {
      const ab = midpoint(a, a.out || a),
        bc = midpoint(a.out || a, b.in || b),
        cd = midpoint(b.in || b, b),
        abc = midpoint(ab, bc),
        bcd = midpoint(bc, cd);
      const center = midpoint(abc, bcd);
      a.out = ab;
      b.in = cd;
      next.contour.nodes.splice(selectedNode + 1, 0, { ...center, in: abc, out: bcd });
    } else next.contour.nodes.splice(selectedNode + 1, 0, midpoint(a, b));
    onChange(next);
    onSelectNode(selectedNode + 1);
  }
  return (
    <>
      <div className="panel-heading">
        <span className="eyebrow">SCHNITTTEIL</span>
        <span className="small-tag">{part.mirrored ? 'Gespiegelt' : 'Original'}</span>
      </div>
      <label className="field">
        <span>Name</span>
        <input
          aria-label="Teilname"
          value={part.name}
          onChange={(e) => onChange({ ...part, name: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Benötigte Stückzahl</span>
        <input
          aria-label="Stückzahl"
          type="number"
          min="1"
          max="500"
          value={part.quantity}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isInteger(value) && value >= 1 && value <= 500)
              onChange({ ...part, quantity: value });
          }}
        />
      </label>
      <label className="field color-field">
        <span>Schnittteilfarbe</span>
        <input
          type="color"
          aria-label="Schnittteilfarbe"
          value={part.color}
          onChange={(e) => onChange({ ...part, color: e.target.value })}
        />
      </label>
      <div className="form-row">
        {primitive?.kind === 'circle' ? (
          <MeasureInput
            label="Durchmesser"
            unit={unit}
            value={primitive.rx * 2}
            positive
            onChange={(v) => {
              const minX = primitive.center.x - primitive.rx,
                minY = primitive.center.y - primitive.ry;
              const scale = v / (2 * primitive.rx);
              onChange(
                mapPart(part, (p) => ({
                  x: minX + (p.x - minX) * scale,
                  y: minY + (p.y - minY) * scale,
                })),
              );
            }}
          />
        ) : (
          <>
            <MeasureInput
              label="Formbreite"
              unit={unit}
              value={b.width}
              positive
              onChange={(v) => {
                if (b.width)
                  onChange(
                    mapPart(part, (p) => ({ x: b.minX + ((p.x - b.minX) * v) / b.width, y: p.y })),
                  );
              }}
            />
            <MeasureInput
              label="Formhöhe"
              unit={unit}
              value={b.height}
              positive
              onChange={(v) => {
                if (b.height)
                  onChange(
                    mapPart(part, (p) => ({ x: p.x, y: b.minY + ((p.y - b.minY) * v) / b.height })),
                  );
              }}
            />
          </>
        )}
      </div>
      <p className="help">Maße der Grundform, ohne Nahtzugabe.</p>
      <label className="field">
        <span>Stoffrichtung</span>
        <select
          aria-label="Stoffrichtung"
          value={part.direction}
          onChange={(e) =>
            onChange({ ...part, direction: e.target.value as PartDefinition['direction'] })
          }
        >
          <option value="straight">Straight-Grain · längs</option>
          <option value="cross">Cross-Grain · quer</option>
        </select>
      </label>
      <div className="field">
        <span>Winkel der Bezugslinie</span>
        <div className="segmented grain-presets">
          {[0, 45, 90].map((value) => (
            <button
              key={value}
              aria-label={`Bezugslinie ${value}°`}
              aria-pressed={preset === value}
              onClick={() => onChange(setGrainAngle(part, value))}
            >
              {value}° {value === 0 ? '↓' : value === 45 ? '↘' : '→'}
            </button>
          ))}
        </div>
        <small>
          {preset === undefined ? 'Benutzerdefiniert' : `${preset}°`} · 0° senkrecht, 90° waagerecht
        </small>
      </div>
      <details>
        <summary>Bezugslinie präzise einstellen</summary>
        {(['start', 'end'] as const).map((key, i) => (
          <div className="form-row" key={key}>
            {(['x', 'y'] as const).map((axis) => (
              <MeasureInput
                key={axis}
                label={`${i ? 'Ende' : 'Anfang'} ${axis.toUpperCase()}`}
                unit={unit}
                min={-1e6}
                value={part.grain[key][axis]}
                onChange={(v) =>
                  onChange({
                    ...part,
                    grain: { ...part.grain, [key]: { ...part.grain[key], [axis]: v } },
                  })
                }
              />
            ))}
          </div>
        ))}
      </details>
      <hr />
      {primitive ? (
        <>
          <p className="help">
            {primitive.kind === 'circle' ? 'Der Kreis' : 'Das Oval'} bleibt beim Ändern der Maße
            exakt. Für einzelne Punkte zuerst umwandeln.
          </p>
          <button
            className="full"
            onClick={() => {
              onChange({ ...part, contour: toFreeContour(part.contour) });
              onSelectNode(0);
            }}
          >
            In freie Form umwandeln
          </button>
        </>
      ) : (
        <>
          <div className="panel-heading">
            <span className="eyebrow">UMRISS BEARBEITEN</span>
            <span className="muted">{nodes.length} Punkte</span>
          </div>
          {!part.contour.closed && (
            <button
              className="primary full"
              disabled={nodes.length < 3}
              onClick={() => onChange({ ...part, contour: { ...part.contour, closed: true } })}
            >
              Umriss schließen
            </button>
          )}
          {node && (
            <>
              <label className="field">
                <span>Ausgewählter Punkt</span>
                <select
                  aria-label="Ausgewählter Punkt"
                  value={selectedNode}
                  onChange={(e) => onSelectNode(Number(e.target.value))}
                >
                  {nodes.map((_, i) => (
                    <option key={i} value={i}>
                      Punkt {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <MeasureInput
                  label="Punkt X"
                  unit={unit}
                  min={-1e6}
                  value={node.x}
                  onChange={(v) => patchNode('x', v)}
                />
                <MeasureInput
                  label="Punkt Y"
                  unit={unit}
                  min={-1e6}
                  value={node.y}
                  onChange={(v) => patchNode('y', v)}
                />
              </div>
              {(part.contour.closed || selectedNode < nodes.length - 1) && (
                <button className="full" onClick={toggleCurve}>
                  {node.out || nodes[(selectedNode + 1) % nodes.length]?.in
                    ? 'Ausgehende Kante begradigen'
                    : 'Ausgehende Kante zur Kurve machen'}
                </button>
              )}
              {(['in', 'out'] as const).map(
                (control) =>
                  node[control] && (
                    <div key={control}>
                      <p className="mini-heading">
                        Kontrollpunkt · {control === 'in' ? 'eingehend' : 'ausgehend'}
                      </p>
                      <div className="form-row">
                        {(['x', 'y'] as const).map((axis) => (
                          <MeasureInput
                            key={axis}
                            label={`${control === 'in' ? 'Eingang' : 'Ausgang'} ${axis.toUpperCase()}`}
                            unit={unit}
                            min={-1e6}
                            value={node[control]![axis]}
                            onChange={(v) => patchNode(axis, v, control)}
                          />
                        ))}
                      </div>
                    </div>
                  ),
              )}
              <div className="button-row">
                <button
                  disabled={
                    nodes.length >= 256 ||
                    (!part.contour.closed && selectedNode === nodes.length - 1)
                  }
                  onClick={insertPoint}
                >
                  Punkt einfügen
                </button>
                <button
                  disabled={nodes.length <= 3 && part.contour.closed}
                  onClick={() => {
                    const next = structuredClone(part);
                    next.contour.nodes.splice(selectedNode, 1);
                    onChange(next);
                    onSelectNode(Math.max(0, selectedNode - 1));
                  }}
                >
                  Punkt löschen
                </button>
              </div>
            </>
          )}
          <button
            className="text-button full"
            onClick={() => {
              onChange({ ...part, contour: { closed: false, nodes: [] } });
              onSelectNode(0);
            }}
          >
            Umriss neu zeichnen
          </button>
          <p className="help">
            Punkte und blaue Bezugslinie sind direkt verschiebbar. Kurven: goldene Kontrollpunkte
            ziehen.
          </p>
        </>
      )}
    </>
  );
}
