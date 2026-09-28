import { useRef, useState, type PointerEvent } from 'react';
import type { Placement, Project, ValidationReport } from '../domain/types';
import { measureLabel } from '../domain/units';
import { polygonPath } from '../geometry/kernel';
import { createMagneticSnap, MAGNET_RADIUS_PX } from '../geometry/magnetic-snap';
import { shapeOf } from '../geometry/contours';
import { Canvas, eventPoint } from './Canvas';

export function LayoutCanvas({
  project,
  report,
  grid,
  gridStep,
  snap,
  magnetic,
  selectedId,
  onSelect,
  onPreview,
  onCommit,
  preview,
  locked,
}: {
  project: Project;
  report: ValidationReport;
  grid: boolean;
  gridStep: number;
  snap: boolean;
  magnetic: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPreview: (p: Placement[] | null) => void;
  onCommit: (p: Placement[]) => void;
  preview: boolean;
  locked: boolean;
}) {
  const drag = useRef<{
    start: { x: number; y: number };
    original: Placement;
    list: Placement[];
    length: number;
    clientX: number;
    clientY: number;
    moved: boolean;
    magnet: ReturnType<typeof createMagneticSnap> | null;
  } | null>(null);
  const last = useRef<Placement[] | null>(null);
  const [fitTick, setFitTick] = useState(0);
  const [magnetStatus, setMagnetStatus] = useState('');
  const f = project.fabric,
    width = f.width || 1000,
    length = f.mode === 'fixed' ? f.length : report.requiredLength || 800;
  const invalidIds = new Set(report.violations.flatMap((v) => v.instanceIds));
  function down(e: PointerEvent<SVGGElement>, placement: Placement) {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(placement.instanceId);
    if (locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    let magnet: ReturnType<typeof createMagneticSnap> | null = null;
    if (magnetic) {
      try {
        magnet = createMagneticSnap(project, placement);
      } catch {
        /* Invalid contours cannot safely dock. */
      }
    }
    drag.current = {
      start: eventPoint(e),
      original: placement,
      list: project.placements,
      length,
      clientX: e.clientX,
      clientY: e.clientY,
      moved: false,
      magnet,
    };
    last.current = null;
  }
  function move(e: PointerEvent<SVGGElement>) {
    const d = drag.current;
    if (!d || locked) return;
    if (!d.moved && Math.hypot(e.clientX - d.clientX, e.clientY - d.clientY) < 3) return;
    d.moved = true;
    const point = eventPoint(e);
    let x = d.original.x + point.x - d.start.x,
      y = d.original.y + point.y - d.start.y;
    if (snap) {
      x = Math.round(x / gridStep) * gridStep;
      y = Math.round(y / gridStep) * gridStep;
    }
    if (magnetic) {
      const matrix = e.currentTarget.ownerSVGElement!.getScreenCTM()!;
      const result = d.magnet?.(
        { x: d.original.x + point.x - d.start.x, y: d.original.y + point.y - d.start.y },
        { x, y },
        MAGNET_RADIUS_PX / Math.hypot(matrix.a, matrix.b),
      );
      if (!result) {
        setMagnetStatus('Kein konfliktfreier Platz');
        return;
      }
      ({ x, y } = result.point);
      setMagnetStatus(result.snapped ? 'Magnetisch angedockt' : '');
    }
    const list = d.list.map((p) => (p.instanceId === d.original.instanceId ? { ...p, x, y } : p));
    last.current = x !== d.original.x || y !== d.original.y ? list : null;
    onPreview(list);
  }
  function up() {
    if (last.current && !locked) onCommit(last.current);
    drag.current = null;
    last.current = null;
    onPreview(null);
    setMagnetStatus('');
  }
  return (
    <Canvas
      extent={{ x: 0, y: 0, width, height: length }}
      fitKey={`${project.id}-${f.width}-${f.mode}-${fitTick}-${preview ? Math.round(drag.current?.length ?? length) : 'current'}`}
      grid={grid}
      gridStep={gridStep}
      unit={project.unit}
      footer={
        <>
          {magnetStatus ? (
            <span role="status" data-testid="magnet-status">
              {magnetStatus}
            </span>
          ) : (
            <>
              <span className="legend-dot" /> Zuschneidekontur <span className="legend-dash" />{' '}
              Grundform
            </>
          )}
          <button className="text-button" onClick={() => setFitTick((x) => x + 1)}>
            Gesamte Bahn einpassen
          </button>
        </>
      }
    >
      {(u) => (
        <>
          <defs>
            <pattern
              id="selvedge"
              width={8 * u}
              height={8 * u}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2={8 * u} stroke="#c4baa680" strokeWidth={2 * u} />
            </pattern>
          </defs>
          <rect
            data-pan="true"
            x="0"
            y="0"
            width={width}
            height={length}
            fill="#fffdf7"
            stroke="#bbb7a8"
            strokeWidth={1.5 * u}
          />
          {f.reserve > 0 && (
            <>
              <path
                pointerEvents="none"
                d={`M0 0H${f.reserve}V${length}H0ZM${Math.max(f.reserve, width - f.reserve)} 0H${width}V${length}H${Math.max(f.reserve, width - f.reserve)}Z`}
                fill="url(#selvedge)"
                fillRule="evenodd"
              />
              <rect
                pointerEvents="none"
                x={f.reserve}
                y={0}
                width={Math.max(0, width - 2 * f.reserve)}
                height={Math.max(0, length)}
                fill="none"
                stroke="#c8bda5"
                strokeDasharray={`${5 * u} ${4 * u}`}
                strokeWidth={u}
              />
            </>
          )}
          <text x={width / 2} y={-20 * u} textAnchor="middle" fontSize={12 * u} fill="#597064">
            ← Stoffbreite · Cross-Grain · {measureLabel(f.width, project.unit)} →
          </text>
          <text
            transform={`translate(${-24 * u} ${length / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={12 * u}
            fill="#597064"
          >
            Stofflänge · Straight-Grain →
          </text>
          {project.placements.map((placement) => {
            const index = project.parts.findIndex((p) => p.id === placement.partId),
              part = project.parts[index];
            if (!part) return null;
            let shape;
            try {
              shape = shapeOf(part, f.seam, placement.rotation);
            } catch {
              return null;
            }
            const selected = placement.instanceId === selectedId,
              invalid = invalidIds.has(placement.instanceId),
              color = part.color;
            const instanceNumber = Number(placement.instanceId.split(':').at(-1)) + 1;
            return (
              <g
                key={placement.instanceId}
                data-testid="placed-part"
                aria-label={`${part.name}, Exemplar ${instanceNumber}`}
                className="placed-piece"
                transform={`translate(${placement.x} ${placement.y})`}
                onPointerDown={(e) => down(e, placement)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => {
                  drag.current = null;
                  last.current = null;
                  onPreview(null);
                  setMagnetStatus('');
                }}
              >
                <path
                  d={polygonPath(shape.cut)}
                  fill={`${color}90`}
                  stroke={invalid ? '#b5413d' : selected ? '#254e42' : color}
                  strokeWidth={(selected ? 3 : 1.5) * u}
                />
                <path
                  d={polygonPath([shape.base])}
                  fill="none"
                  stroke={invalid ? '#b5413d' : '#536557'}
                  strokeWidth={u}
                  strokeDasharray={`${4 * u} ${3 * u}`}
                  pointerEvents="none"
                />
                <path
                  d={`M${shape.grain.start.x},${shape.grain.start.y}L${shape.grain.end.x},${shape.grain.end.y}`}
                  fill="none"
                  stroke="#3e5b5090"
                  strokeWidth={u}
                  pointerEvents="none"
                />
                <g pointerEvents="none">
                  <text
                    x={shape.width / 2}
                    y={shape.height / 2}
                    textAnchor="middle"
                    fontSize={12 * u}
                    fontWeight="600"
                    fill="#263f34"
                  >
                    {part.name.length > 25 ? part.name.slice(0, 23) + '…' : part.name}
                  </text>
                  <text
                    x={shape.width / 2}
                    y={shape.height / 2 + 17 * u}
                    textAnchor="middle"
                    fontSize={10 * u}
                    fill="#496353"
                  >
                    {index + 1}.{instanceNumber}
                    {part.mirrored ? ' · gespiegelt' : ''}
                  </text>
                </g>
              </g>
            );
          })}
          {!!report.requiredLength && (
            <g pointerEvents="none">
              <line
                x1="0"
                x2={width}
                y1={report.requiredLength}
                y2={report.requiredLength}
                stroke="#527963"
                strokeWidth={u}
                strokeDasharray={`${8 * u} ${4 * u}`}
              />
              <text
                x={width}
                y={report.requiredLength + 20 * u}
                textAnchor="end"
                fill="#466854"
                fontSize={11 * u}
              >
                Benötigte Länge: {measureLabel(report.requiredLength, project.unit, true)}
              </text>
            </g>
          )}
        </>
      )}
    </Canvas>
  );
}
