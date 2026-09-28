import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { Point, Unit } from '../domain/types';
import { formatMeasure } from '../domain/units';

export type Box = { x: number; y: number; width: number; height: number };
export function eventPoint(event: ReactPointerEvent<SVGElement>): Point {
  const svg =
    event.currentTarget instanceof SVGSVGElement
      ? event.currentTarget
      : event.currentTarget.ownerSVGElement!;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const result = point.matrixTransform(svg.getScreenCTM()!.inverse());
  return { x: result.x, y: result.y };
}
export function snapDrawingPoint(
  point: Point,
  snap: boolean,
  step: number,
  unitsPerPixel: number,
): Point {
  if (!snap) return point;
  if (Math.hypot(point.x, point.y) <= 8 * unitsPerPixel) return { x: 0, y: 0 };
  return { x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step };
}
export function drawingEventPoint(
  event: ReactPointerEvent<SVGElement>,
  snap: boolean,
  step: number,
): Point {
  const svg =
    event.currentTarget instanceof SVGSVGElement
      ? event.currentTarget
      : event.currentTarget.ownerSVGElement!;
  const matrix = svg.getScreenCTM()!;
  return snapDrawingPoint(eventPoint(event), snap, step, 1 / Math.hypot(matrix.a, matrix.b));
}
export function Canvas({
  extent,
  fitKey,
  grid,
  gridStep,
  unit,
  children,
  onBackgroundClick,
  footer,
  snap = false,
  origin = false,
}: {
  extent: Box;
  fitKey: string;
  grid: boolean;
  gridStep: number;
  unit: Unit;
  children: (unitsPerPixel: number) => ReactNode;
  onBackgroundClick?: (p: Point) => void;
  footer?: ReactNode;
  snap?: boolean;
  origin?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 650 }),
    [view, setView] = useState<Box>({ x: -100, y: -100, width: 1200, height: 1000 });
  const pan = useRef<{ x: number; y: number; view: Box; moved: boolean } | null>(null);
  const [space, setSpace] = useState(false);
  const [cursor, setCursor] = useState<Point | null>(null);
  const currentView = useRef(view);
  currentView.current = view;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  const fit = () => {
    const box = origin
      ? {
          x: Math.min(0, extent.x),
          y: Math.min(0, extent.y),
          width: Math.max(0, extent.x + extent.width) - Math.min(0, extent.x),
          height: Math.max(0, extent.y + extent.height) - Math.min(0, extent.y),
        }
      : extent;
    const ratio = size.width / Math.max(1, size.height);
    const width = Math.max(box.width, box.height * ratio, 100) * 1.22,
      height = width / ratio;
    setView({
      x: box.x + box.width / 2 - width / 2,
      y: box.y + box.height / 2 - height / 2,
      width,
      height,
    });
  };
  useEffect(fit, [fitKey, size.width, size.height]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    const blur = () => setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  useEffect(() => {
    const svg = svgRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = currentView.current,
        rect = svg.getBoundingClientRect(),
        factor = Math.exp(Math.max(-0.3, Math.min(0.3, e.deltaY * 0.001)));
      const nextWidth = Math.max(5, Math.min(2e6, v.width * factor)),
        f = nextWidth / v.width;
      const rx = (e.clientX - rect.left) / rect.width,
        ry = (e.clientY - rect.top) / rect.height;
      setView({
        x: v.x + v.width * rx * (1 - f),
        y: v.y + v.height * ry * (1 - f),
        width: nextWidth,
        height: v.height * f,
      });
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, []);
  const up = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pan.current && !pan.current.moved && !space && e.button === 0 && onBackgroundClick)
      onBackgroundClick(drawingEventPoint(e, snap, gridStep));
    pan.current = null;
  };
  const u = view.width / Math.max(size.width, 1);
  const rulerWidth = unit === 'inch' ? 65 : 46;
  let step = Math.max(gridStep, 0.001);
  while (step / u < 18) step *= 2;
  const xs: number[] = [],
    ys: number[] = [];
  for (
    let x = Math.ceil(view.x / step) * step;
    x < view.x + view.width && xs.length < 150;
    x += step
  )
    xs.push(x);
  for (
    let y = Math.ceil(view.y / step) * step;
    y < view.y + view.height && ys.length < 150;
    y += step
  )
    ys.push(y);
  const zoom = (factor: number) =>
    setView((v) => ({
      x: v.x + (v.width * (1 - factor)) / 2,
      y: v.y + (v.height * (1 - factor)) / 2,
      width: v.width * factor,
      height: v.height * factor,
    }));
  return (
    <div className={`canvas-host ${space ? 'panning' : ''}`} ref={host}>
      <svg
        ref={svgRef}
        className="work-canvas"
        aria-label="Zeichenfläche"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        onPointerMoveCapture={(e) => {
          if (origin && !space && !pan.current?.moved)
            setCursor(drawingEventPoint(e, snap, gridStep));
        }}
        onPointerLeave={() => setCursor(null)}
        onPointerDownCapture={(e) => {
          if (space || e.button === 1) {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            pan.current = { x: e.clientX, y: e.clientY, view, moved: false };
          }
        }}
        onPointerDown={(e) => {
          if ((e.target as Element).getAttribute('data-pan') || e.target === e.currentTarget) {
            e.currentTarget.setPointerCapture(e.pointerId);
            pan.current = { x: e.clientX, y: e.clientY, view, moved: false };
          }
        }}
        onPointerMove={(e) => {
          const p = pan.current;
          if (p) {
            const dx = (e.clientX - p.x) * u,
              dy = (e.clientY - p.y) * u;
            if (Math.abs(dx) + Math.abs(dy) > u * 3) p.moved = true;
            setView({ ...p.view, x: p.view.x - dx, y: p.view.y - dy });
          }
        }}
        onPointerUp={up}
        onPointerCancel={() => {
          pan.current = null;
        }}
      >
        <defs>
          <pattern id="draft-grid" width={step} height={step} patternUnits="userSpaceOnUse">
            <path d={`M${step} 0H0V${step}`} fill="none" stroke="#d9dfd7" strokeWidth={0.7 * u} />
          </pattern>
        </defs>
        <rect
          data-pan="true"
          x={view.x}
          y={view.y}
          width={view.width}
          height={view.height}
          fill={grid ? 'url(#draft-grid)' : '#eef1eb'}
        />
        {children(u)}
        {origin && (
          <g
            pointerEvents="none"
            data-testid="origin-marker"
            aria-label="Nullpunkt 0, 0"
            stroke="#345f91"
            strokeWidth={1.8 * u}
            fill="none"
          >
            <path
              d={`M${-8 * u} 0H${32 * u}l${-5 * u} ${-3 * u}m${5 * u} ${3 * u}l${-5 * u} ${3 * u}M0 ${-8 * u}V${32 * u}l${-3 * u} ${-5 * u}m${3 * u} ${5 * u}l${3 * u} ${-5 * u}`}
            />
            <circle r={3 * u} fill="#fff" />
            <g
              fill="#254f82"
              stroke="#fff"
              strokeWidth={3 * u}
              paintOrder="stroke"
              fontSize={11 * u}
            >
              <text x={8 * u} y={-10 * u}>
                (0, 0)
              </text>
              <text x={36 * u} y={4 * u}>
                +X
              </text>
              <text x={-7 * u} y={47 * u}>
                +Y
              </text>
            </g>
          </g>
        )}
        <g className="ruler" pointerEvents="none" fontSize={10 * u} fill="#69766b">
          <rect x={view.x} y={view.y} width={view.width} height={23 * u} fill="#f8f9f5" />
          <rect x={view.x} y={view.y} width={rulerWidth * u} height={view.height} fill="#f8f9f5" />
          {xs
            .filter((_, i) => i % 2 === 0)
            .map((x) => (
              <text key={x} x={x} y={view.y + 15 * u} textAnchor="middle">
                {formatMeasure(x, unit)}
              </text>
            ))}
          {ys
            .filter((_, i) => i % 2 === 0)
            .map((y) => (
              <text key={y} x={view.x + (rulerWidth - 4) * u} y={y} textAnchor="end">
                {formatMeasure(y, unit)}
              </text>
            ))}
          <rect x={view.x} y={view.y} width={rulerWidth * u} height={23 * u} fill="#f8f9f5" />
          <text x={view.x + (rulerWidth / 2) * u} y={view.y + 15 * u} textAnchor="middle">
            {unit}
          </text>
        </g>
      </svg>
      <div className="canvas-bottom">
        <span>
          {origin && cursor ? (
            <span data-testid="cursor-coordinates">
              X: {formatMeasure(cursor.x, unit)} · Y: {formatMeasure(cursor.y, unit)} {unit}
              {snap ? ' · eingerastet' : ''}
            </span>
          ) : (
            footer || 'Mausrad: Zoom · Leertaste + Ziehen: Ansicht verschieben'
          )}
        </span>
        <div className="zoom-buttons">
          {origin && (
            <button onClick={() => setView((v) => ({ ...v, x: -v.width / 2, y: -v.height / 2 }))}>
              Zum Nullpunkt
            </button>
          )}
          <button aria-label="Verkleinern" onClick={() => zoom(1.3)}>
            −
          </button>
          <button onClick={fit}>Einpassen</button>
          <button aria-label="Vergrößern" onClick={() => zoom(1 / 1.3)}>
            +
          </button>
        </div>
      </div>
    </div>
  );
}
