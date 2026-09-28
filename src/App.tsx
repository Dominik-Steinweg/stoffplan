import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  OptimizationResult,
  PartDefinition,
  Placement,
  Project,
  WorkerResponse,
} from './domain/types';
import { instanceId, uid } from './domain/types';
import {
  exampleProject,
  mirrorPart,
  mixedExampleProject,
  newPart,
  newProject,
  COLORS,
  planningKey,
  type PartKind,
} from './domain/model';
import { measureLabel } from './domain/units';
import { bounds, initGeometry, polygonPath } from './geometry/kernel';
import { contourPath, flatten, shapeOf } from './geometry/contours';
import { fabricErrors, validate } from './geometry/validation';
import { downloadProject, listProjects, parseProject, saveProject } from './persistence/projects';
import { MeasureInput } from './ui/MeasureInput';
import { useHistory } from './ui/useHistory';
import { LayoutCanvas } from './ui/LayoutCanvas';
import { PartEditor, PartInspector } from './ui/PartEditor';
import { VariantList } from './ui/VariantList';
import { reviewVariants } from './optimization/variants';

function PartIcon({ part }: { part: PartDefinition }) {
  let b;
  try {
    b = bounds([flatten(part.contour)]);
  } catch {
    return <span>◇</span>;
  }
  if (!Number.isFinite(b.width)) return <span>✎</span>;
  const pad = Math.max(b.width, b.height) * 0.08 || 10;
  return (
    <svg
      viewBox={`${b.minX - pad} ${b.minY - pad} ${b.width + pad * 2} ${b.height + pad * 2}`}
      aria-hidden="true"
    >
      <path d={contourPath(part.contour)} fill="currentColor" opacity=".75" />
    </svg>
  );
}
function Mark() {
  return (
    <svg viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M7 5h16l6 6v20H7z" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M13 12h10v13H13zM13 17h10M18 12v13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2 2"
      />
    </svg>
  );
}

export default function App() {
  const history = useHistory(useMemo(newProject, []));
  const { project, revision, commit, undo, redo, load } = history;
  const [ready, setReady] = useState(false),
    [loaded, setLoaded] = useState(false),
    [fatal, setFatal] = useState('');
  const [notice, setNotice] = useState(''),
    [saveState, setSaveState] = useState('Wird geladen …');
  const [mode, setMode] = useState<'layout' | 'editor'>('layout');
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [selectedNode, setSelectedNode] = useState(0);
  const [grid, setGrid] = useState(true),
    [snap, setSnap] = useState(false),
    [gridStep, setGridStep] = useState(25);
  const [dragPreview, setDragPreview] = useState<Placement[] | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null),
    [running, setRunning] = useState(false),
    [elapsed, setElapsed] = useState(0);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const resultRef = useRef<OptimizationResult | null>(null);
  const planKey = planningKey(project);
  const planningRevision = useRef({ key: planKey, revision });
  if (planningRevision.current.key !== planKey)
    planningRevision.current = { key: planKey, revision };
  const worker = useRef<Worker | null>(null),
    activeRun = useRef(''),
    activeRevision = useRef(revision),
    startedAt = useRef(0);
  activeRevision.current = planningRevision.current.revision;
  const [library, setLibrary] = useState<Project[] | null>(null),
    [mirror, setMirror] = useState<{ partId: string; axis: 'vertical' | 'horizontal' } | null>(
      null,
    );
  const fileInput = useRef<HTMLInputElement>(null),
    savedVersion = useRef(0);

  useEffect(() => {
    initGeometry()
      .then(() => setReady(true))
      .catch((e) => setFatal(`Die Geometrie konnte nicht geladen werden: ${String(e)}`));
    listProjects(setNotice)
      .then((list) => {
        if (list.length) load(list[0]);
      })
      .catch((e) => setNotice((e as Error).message))
      .finally(() => setLoaded(true));
    return () => {
      worker.current?.terminate();
    };
  }, [load]);
  useEffect(() => {
    if (!loaded) return;
    const version = ++savedVersion.current;
    setSaveState('Wird gesichert …');
    saveProject(project)
      .then(() => {
        if (version === savedVersion.current) setSaveState('Lokal gesichert');
      })
      .catch((e) => {
        if (version === savedVersion.current) {
          setSaveState('Nicht gesichert');
          setNotice((e as Error).message);
        }
      });
  }, [project, loaded]);
  useEffect(() => {
    worker.current?.terminate();
    worker.current = null;
    activeRun.current = '';
    setRunning(false);
    setResult(null);
    resultRef.current = null;
    setSelectedVariantId(null);
    setDragPreview(null);
  }, [planKey]);
  useEffect(() => {
    if (selectedVariantId && !project.variants.some((v) => v.id === selectedVariantId))
      setSelectedVariantId(null);
  }, [project.variants, selectedVariantId]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        downloadProject(project);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, project]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => setElapsed((performance.now() - startedAt.current) / 1000),
      200,
    );
    return () => clearInterval(timer);
  }, [running]);

  const variants = useMemo(
    () =>
      ready
        ? project.variants
            .map((v) => ({ ...v, report: validate(project, v.placements) }))
            .filter((v) => v.report.status === 'valid')
            .sort((a, b) => a.report.requiredLength - b.report.requiredLength)
        : [],
    [project, ready],
  );
  const selectedVariant = variants.find((v) => v.id === selectedVariantId);
  const previewPlacements = result?.placements ?? selectedVariant?.placements;
  const previewing = !!previewPlacements;
  const visibleProject = useMemo(
    () =>
      dragPreview
        ? { ...project, placements: dragPreview }
        : previewPlacements
          ? { ...project, placements: previewPlacements }
          : project,
    [project, dragPreview, previewPlacements],
  );
  const report = useMemo(() => (ready ? validate(visibleProject) : null), [visibleProject, ready]);
  const selectedPart = project.parts.find((p) => p.id === selectedPartId);
  const selectedPlacement = visibleProject.placements.find((p) => p.instanceId === selectedId);
  const placementPart = project.parts.find((p) => p.id === selectedPlacement?.partId);
  const total = project.parts.reduce((n, p) => n + p.quantity, 0);
  const stateLabels = {
    valid: 'Vollständig & geprüft',
    invalid: 'Anordnung prüfen',
    incomplete: 'Noch unvollständig',
    unchecked: 'Wird geprüft',
  };
  const problemSummary = report ? [...new Set(report.violations.map((v) => v.message))] : [];

  function openProject(p: Project) {
    stopSearch(false);
    setResult(null);
    setSelectedVariantId(null);
    load(p);
    setLibrary(null);
    setMode('layout');
    setSelectedPartId(p.parts[0]?.id || null);
    setSelectedId(null);
    setSelectedNode(0);
    setNotice('');
  }
  function changePart(part: PartDefinition) {
    if (
      project.parts.reduce((sum, p) => sum + (p.id === part.id ? part.quantity : p.quantity), 0) >
      500
    ) {
      setNotice('Maximal 500 Exemplare; empfohlen sind Projekte mit bis zu 50.');
      return;
    }
    commit((p) => ({
      ...p,
      parts: p.parts.map((old) => (old.id === part.id ? part : old)),
      placements: p.placements.filter(
        (q) =>
          q.partId !== part.id ||
          Array.from({ length: part.quantity }, (_, i) => instanceId(part.id, i)).includes(
            q.instanceId,
          ),
      ),
    }));
  }
  function addPart(kind: PartKind) {
    if (total >= 500 || project.parts.length >= 200) {
      setNotice('Maximal 200 Schnittteile und 500 Exemplare pro Projekt.');
      return;
    }
    const part = newPart(kind);
    part.color = COLORS[project.parts.length % COLORS.length];
    if (kind === 'free') part.contour = { closed: false, nodes: [] };
    part.name += ` ${project.parts.length + 1}`;
    commit((p) => ({ ...p, parts: [...p.parts, part] }));
    setSelectedPartId(part.id);
    setSelectedNode(0);
    setMode('editor');
  }
  function duplicate(part: PartDefinition) {
    if (total + part.quantity > 500 || project.parts.length >= 200) {
      setNotice('Maximal 200 Schnittteile und 500 Exemplare pro Projekt.');
      return;
    }
    const copy = { ...structuredClone(part), id: uid(), name: `${part.name} · Kopie` };
    commit((p) => ({ ...p, parts: [...p.parts, copy] }));
    setSelectedPartId(copy.id);
  }
  function removePart(part: PartDefinition) {
    commit((p) => ({
      ...p,
      parts: p.parts.filter((a) => a.id !== part.id),
      placements: p.placements.filter((a) => a.partId !== part.id),
    }));
    setSelectedPartId(null);
    setSelectedId(null);
  }
  function changePlacement(patch: Partial<Placement>) {
    if (!selectedPlacement || previewing) return;
    commit((p) => ({
      ...p,
      layoutSource: 'manual',
      placements: p.placements.map((q) => (q.instanceId === selectedId ? { ...q, ...patch } : q)),
    }));
  }
  function placeMissing(partId: string) {
    if (previewing) return;
    const part = project.parts.find((p) => p.id === partId)!;
    const index = Array.from({ length: part.quantity }, (_, i) => i).find(
      (i) => !project.placements.some((p) => p.instanceId === instanceId(partId, i)),
    );
    if (index === undefined) return;
    let clearance = 0;
    try {
      if (shapeOf(part, project.fabric.seam).curved) clearance = 0.012;
    } catch {
      /* Invalid editable parts are still shown with their validation message. */
    }
    const placement = {
      partId,
      instanceId: instanceId(partId, index),
      x: project.fabric.reserve + clearance,
      y: clearance,
      flipped: false,
    };
    commit((p) => ({ ...p, layoutSource: 'manual', placements: [...p.placements, placement] }));
    setSelectedId(placement.instanceId);
  }
  function startSearch() {
    setMode('layout');
    setNotice('');
    setResult(null);
    resultRef.current = null;
    setSelectedVariantId(null);
    setSelectedId(null);
    worker.current?.terminate();
    const w = new Worker(new URL('./optimization/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    const runId = uid(),
      snapshotRevision = activeRevision.current;
    activeRun.current = runId;
    startedAt.current = performance.now();
    setElapsed(0);
    setRunning(true);
    w.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data,
        incoming = message.type === 'error' ? message : message.result;
      if (incoming.runId !== activeRun.current || incoming.revision !== activeRevision.current)
        return;
      if (message.type === 'error') {
        setNotice(`Suche fehlgeschlagen: ${message.message}`);
        stopSearch();
      } else {
        resultRef.current = message.result;
        setResult(message.result);
        if (message.type === 'done') {
          stopSearch();
        }
      }
    };
    w.onerror = () => {
      if (activeRun.current !== runId) return;
      setNotice(
        'Die Suche wurde wegen eines Fehlers beendet. Die gespeicherte Anordnung bleibt erhalten.',
      );
      stopSearch();
    };
    w.postMessage({
      project: structuredClone(project),
      runId,
      revision: snapshotRevision,
      budgetMs: 30000,
      seed: 20260928,
    });
  }
  function stopSearch(persist = true) {
    const hadRun = !!activeRun.current;
    worker.current?.terminate();
    worker.current = null;
    activeRun.current = '';
    setRunning(false);
    if (persist && hadRun && resultRef.current) {
      const finished = resultRef.current;
      if (finished.variants.length) {
        const saved = finished.variants.map(({ report: _report, ...variant }) => variant);
        commit((p) =>
          JSON.stringify(p.variants) === JSON.stringify(saved) ? p : { ...p, variants: saved },
        );
        setSelectedVariantId(saved[0].id);
        setResult(null);
      } else setResult(finished);
    }
  }
  function applyResult() {
    if (!previewPlacements) return;
    const next = previewPlacements;
    stopSearch(false);
    commit((p) => ({ ...p, placements: next, layoutSource: 'optimized' }));
    setResult(null);
    setSelectedVariantId(null);
  }
  async function importFile(file: File) {
    try {
      if (file.size > 10_000_000)
        throw new Error('Die Projektdatei darf höchstens 10 MB groß sein.');
      const messages: string[] = [];
      const p = reviewVariants(parseProject(await file.text()), (message) =>
        messages.push(message),
      );
      openProject({ ...p, updatedAt: new Date().toISOString() });
      if (messages.length) setNotice(messages.join(' '));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function showLibrary() {
    try {
      setLibrary(await listProjects(setNotice));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  let mirrorCopy: PartDefinition | undefined;
  if (mirror) {
    const source = project.parts.find((p) => p.id === mirror.partId);
    if (source) mirrorCopy = mirrorPart(source, mirror.axis);
  }
  if (fatal)
    return (
      <main className="loading-screen">
        <Mark />
        <h1>Stoffplan konnte nicht starten</h1>
        <p>{fatal}</p>
        <button onClick={() => location.reload()}>Erneut laden</button>
      </main>
    );
  if (!ready || !loaded || !report)
    return (
      <main className="loading-screen">
        <Mark />
        <h1>Die Werkstatt wird vorbereitet …</h1>
        <p>Geometrie und lokale Projekte werden geladen.</p>
      </main>
    );
  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setMode('layout');
          }}
        >
          <Mark />
          <span>
            stoffplan<small>DEINE ZUSCHNITTWERKSTATT</small>
          </span>
        </a>
        <div className="project-heading">
          <span className="eyebrow">PROJEKT</span>
          <input
            aria-label="Projektname"
            value={project.name}
            onChange={(e) => commit((p) => ({ ...p, name: e.target.value }))}
          />
        </div>
        <div className="header-actions">
          <button onClick={showLibrary}>Projekte</button>
          <button onClick={() => fileInput.current?.click()}>Datei öffnen</button>
          <button className="save-button" onClick={() => downloadProject(project)}>
            Projektdatei speichern <span>↗</span>
          </button>
        </div>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept=".json,.stoffplan.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = '';
          }}
        />
      </header>
      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button aria-label="Meldung schließen" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      <div className="workspace">
        <aside className="left-panel">
          <section className="fabric-settings">
            <div className="panel-heading">
              <h2>Dein Stoff</h2>
              <span className="section-number">01</span>
            </div>
            <div className="segmented unit-switch" aria-label="Anzeigeeinheit">
              <button
                aria-pressed={project.unit === 'mm'}
                onClick={() => commit((p) => ({ ...p, unit: 'mm' }))}
              >
                Millimeter <b>mm</b>
              </button>
              <button
                aria-pressed={project.unit === 'inch'}
                onClick={() => commit((p) => ({ ...p, unit: 'inch' }))}
              >
                Inch <b>in</b>
              </button>
            </div>
            <label className="field">
              <span>Planungsmodus</span>
              <select
                aria-label="Planungsmodus"
                value={project.fabric.mode}
                onChange={(e) =>
                  commit((p) => ({
                    ...p,
                    fabric: { ...p.fabric, mode: e.target.value as 'auto' | 'fixed' },
                  }))
                }
              >
                <option value="auto">Benötigte Länge ermitteln</option>
                <option value="fixed">Vorhandenen Stoff verwenden</option>
              </select>
            </label>
            <MeasureInput
              label="Stoffbreite"
              unit={project.unit}
              value={project.fabric.width}
              positive
              onChange={(width) => commit((p) => ({ ...p, fabric: { ...p.fabric, width } }))}
            />
            {project.fabric.mode === 'fixed' && (
              <MeasureInput
                label="Verfügbare Stofflänge"
                unit={project.unit}
                value={project.fabric.length}
                positive
                onChange={(length) => commit((p) => ({ ...p, fabric: { ...p.fabric, length } }))}
              />
            )}
            <details className="allowances" open>
              <summary>Zugaben & Abstände</summary>
              <div className="form-row">
                <MeasureInput
                  label="Nahtzugabe"
                  unit={project.unit}
                  value={project.fabric.seam}
                  onChange={(seam) => commit((p) => ({ ...p, fabric: { ...p.fabric, seam } }))}
                />
                <MeasureInput
                  label="Randreserve links/rechts"
                  unit={project.unit}
                  value={project.fabric.reserve}
                  onChange={(reserve) =>
                    commit((p) => ({ ...p, fabric: { ...p.fabric, reserve } }))
                  }
                />
              </div>
              <MeasureInput
                label="Teileabstand"
                unit={project.unit}
                value={project.fabric.gap}
                onChange={(gap) => commit((p) => ({ ...p, fabric: { ...p.fabric, gap } }))}
              />
            </details>
            <p className="help">
              Einzelne Maße auch mit anderer Einheit eingeben, z. B. <strong>1 1/2 inch</strong>.
            </p>
          </section>
          <section className="parts-section">
            <div className="panel-heading">
              <h2>Schnittteile</h2>
              <span className="count-tag">{total}</span>
            </div>
            <div className="add-parts">
              <button
                aria-label="Rechteck hinzufügen"
                title="Rechteck hinzufügen"
                onClick={() => addPart('rectangle')}
              >
                <span>▭</span>Rechteck
              </button>
              <button
                aria-label="Dreieck hinzufügen"
                title="Dreieck hinzufügen"
                onClick={() => addPart('triangle')}
              >
                <span>△</span>Dreieck
              </button>
              <button aria-label="Kreis hinzufügen" onClick={() => addPart('circle')}>
                <span>○</span>Kreis
              </button>
              <button aria-label="Oval hinzufügen" onClick={() => addPart('ellipse')}>
                <span>⬭</span>Oval
              </button>
              <button
                aria-label="Freie Form zeichnen"
                title="Freie Form zeichnen"
                onClick={() => addPart('free')}
              >
                <span>⌁</span>Freie Form
              </button>
            </div>
            {!project.parts.length && (
              <p className="empty-list">Jeder gute Zuschnitt beginnt mit dem ersten Teil.</p>
            )}
            <div className="part-list">
              {project.parts.map((part) => (
                <div
                  className={`part-card ${selectedPartId === part.id ? 'selected' : ''}`}
                  key={part.id}
                >
                  <button
                    className="part-main"
                    onClick={() => {
                      setSelectedPartId(part.id);
                      setSelectedNode(0);
                    }}
                    onDoubleClick={() => setMode('editor')}
                  >
                    <span className="part-icon" style={{ color: part.color }}>
                      <PartIcon part={part} />
                    </span>
                    <span className="part-description">
                      <strong>{part.name || 'Unbenanntes Teil'}</strong>
                      <small>
                        {part.direction === 'straight' ? 'Längs' : 'Quer'}
                        {part.mirrored ? ' · gespiegelt' : ''}
                      </small>
                    </span>
                    <span className="quantity">{part.quantity}×</span>
                  </button>
                  {selectedPartId === part.id && (
                    <div className="part-actions">
                      <button onClick={() => setMode('editor')}>Bearbeiten</button>
                      <button
                        title="Duplizieren"
                        aria-label={`${part.name} duplizieren`}
                        onClick={() => duplicate(part)}
                      >
                        ⧉
                      </button>
                      <button
                        title="Gespiegelte Kopie"
                        aria-label={`${part.name} spiegeln`}
                        disabled={!part.contour.primitive && part.contour.nodes.length < 3}
                        onClick={() => setMirror({ partId: part.id, axis: 'vertical' })}
                      >
                        ⇆
                      </button>
                      <button
                        title="Löschen"
                        aria-label={`${part.name} löschen`}
                        onClick={() => removePart(part)}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
          <div className="local-note">
            <span>●</span> Deine Projekte bleiben auf diesem Computer.
          </div>
        </aside>
        <main className="main-workspace">
          <div className="workspace-toolbar">
            <div className="segmented view-switch">
              <button aria-pressed={mode === 'layout'} onClick={() => setMode('layout')}>
                Zuschnitt
              </button>
              <button
                aria-pressed={mode === 'editor'}
                disabled={!selectedPart}
                onClick={() => setMode('editor')}
              >
                Schnittteil bearbeiten
              </button>
            </div>
            <div className="view-tools">
              <button
                aria-label="Rückgängig"
                title="Rückgängig (Strg+Z)"
                disabled={!history.canUndo}
                onClick={undo}
              >
                ↶
              </button>
              <button
                aria-label="Wiederholen"
                title="Wiederholen (Strg+Umschalt+Z)"
                disabled={!history.canRedo}
                onClick={redo}
              >
                ↷
              </button>
              <span className="toolbar-divider" />
              <label>
                <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
                Raster
              </label>
              <label>
                <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
                Einrasten
              </label>
              <details className="grid-popover">
                <summary title="Rasterweite einstellen">⚙</summary>
                <div>
                  <MeasureInput
                    label="Rasterweite"
                    unit={project.unit}
                    value={gridStep}
                    positive
                    onChange={setGridStep}
                  />
                </div>
              </details>
            </div>
          </div>
          {mode === 'layout' && (
            <>
              <div className="workspace-caption">
                <div>
                  <span className="eyebrow">DEINE STOFFBAHN</span>
                  <h1>Platz für jedes Teil.</h1>
                </div>
                <span className={`status-pill ${report.status}`}>
                  <span /> {previewing ? 'Suchvorschau' : stateLabels[report.status]}
                </span>
              </div>
              <div className="layout-stage">
                <LayoutCanvas
                  project={visibleProject}
                  report={report}
                  grid={grid}
                  gridStep={gridStep}
                  snap={snap}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelectedId(id);
                    const p = visibleProject.placements.find((p) => p.instanceId === id);
                    if (p) setSelectedPartId(p.partId);
                  }}
                  onPreview={setDragPreview}
                  onCommit={(placements) =>
                    commit((p) => ({ ...p, placements, layoutSource: 'manual' }))
                  }
                  preview={previewing || running}
                />
                {!total && (
                  <div className="welcome-card">
                    <span className="eyebrow">WENIGER STOFF. MEHR MÖGLICHKEITEN.</span>
                    <h2>
                      Vom Schnittteil
                      <br />
                      zum Zuschnittplan.
                    </h2>
                    <p>
                      Lege deine Stoffbreite fest und füge die benötigten Formen hinzu. Stoffplan
                      findet eine passende Anordnung.
                    </p>
                    <button className="primary" onClick={() => addPart('rectangle')}>
                      Erstes Schnittteil anlegen <span>→</span>
                    </button>
                    <button
                      className="text-button"
                      onClick={() => openProject(mixedExampleProject())}
                    >
                      Mit einem Beispiel ausprobieren
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {mode === 'editor' && selectedPart && (
            <>
              <div className="workspace-caption">
                <div>
                  <span className="eyebrow">FORM & BEZUGSLINIE</span>
                  <h1>{selectedPart.name || 'Schnittteil bearbeiten'}</h1>
                </div>
                <span className="small-tag">Ohne Nahtzugabe zeichnen</span>
              </div>
              <PartEditor
                key={selectedPart.id}
                part={selectedPart}
                seam={project.fabric.seam}
                unit={project.unit}
                grid={grid}
                gridStep={gridStep}
                snap={snap}
                selectedNode={selectedNode}
                onSelectNode={setSelectedNode}
                onChange={changePart}
              />
            </>
          )}
          {mode === 'editor' && !selectedPart && (
            <div className="empty-editor">Wähle ein Schnittteil aus oder lege ein neues an.</div>
          )}
        </main>
        <aside className="right-panel">
          {mode === 'editor' && selectedPart ? (
            <PartInspector
              part={selectedPart}
              unit={project.unit}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              onChange={changePart}
            />
          ) : (
            <>
              <div className="panel-heading">
                <h2>Dein Zuschnitt</h2>
                <span className="section-number">02</span>
              </div>
              <div className="result-metric">
                <span>Benötigte Stofflänge</span>
                <strong data-testid="required-length">
                  {report.placed ? measureLabel(report.requiredLength, project.unit, true) : '—'}
                </strong>
                <small>Randreserve nur links und rechts</small>
              </div>
              <dl className="result-details">
                <div>
                  <dt>Stoffbreite</dt>
                  <dd>{measureLabel(project.fabric.width, project.unit)}</dd>
                </div>
                <div>
                  <dt>Platzierte Teile</dt>
                  <dd data-testid="placed-count">
                    {report.placed} / {report.required}
                  </dd>
                </div>
                {report.remainingLength !== null && (
                  <div>
                    <dt>Verbleibende Länge</dt>
                    <dd>{measureLabel(report.remainingLength, project.unit)}</dd>
                  </div>
                )}
              </dl>
              <div className="search-controls">
                {running ? (
                  <button className="primary full" onClick={() => stopSearch()}>
                    <span className="spinner" />
                    Suche stoppen · {Math.floor(elapsed)} s
                  </button>
                ) : (
                  <button
                    className="primary full"
                    onClick={startSearch}
                    disabled={!total || !!fabricErrors(project).length}
                  >
                    Automatisch anordnen <span>↗</span>
                  </button>
                )}
                <p className="help">
                  Sucht bis zu 30 Sekunden nach kompakten und geordneten Anordnungen.
                </p>
              </div>
              {running && (
                <p className="help" role="status">
                  {result?.variants.length ?? 0} gültige Varianten gefunden · Auswahl nach Ende oder
                  Stopp
                </p>
              )}
              {!running && (
                <VariantList
                  project={project}
                  variants={variants}
                  selectedId={selectedVariantId}
                  onSelect={(id) => {
                    setResult(null);
                    setSelectedVariantId(id);
                    setSelectedId(null);
                  }}
                />
              )}
              {previewing && (
                <div className="search-result">
                  <strong>
                    {running
                      ? 'Bester Vorschlag bisher'
                      : report.status === 'valid'
                        ? 'Vollständiger Vorschlag gefunden'
                        : 'Keine vollständige Anordnung gefunden'}
                  </strong>
                  <p>
                    {result ? `${result.iterations} Suchdurchläufe · ` : ''}
                    {report.placed} von {report.required} Teilen
                  </p>
                  <button className="primary full" onClick={applyResult} disabled={running}>
                    {report.status === 'valid'
                      ? 'Variante übernehmen'
                      : 'Unvollständigen Stand übernehmen'}
                  </button>
                  <button
                    className="text-button full"
                    onClick={() => {
                      stopSearch();
                      setResult(null);
                      setSelectedVariantId(null);
                    }}
                  >
                    Vorschau verwerfen
                  </button>
                </div>
              )}
              {problemSummary.length > 0 && (
                <div className="issues">
                  <h3>Bitte prüfen</h3>
                  {problemSummary.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </div>
              )}
              {!!report.missing.length && (
                <div className="missing-list">
                  <h3>Noch zu platzieren</h3>
                  {report.missing.map((m) => (
                    <div key={m.partId}>
                      <span>
                        {m.name}
                        <small>
                          {m.count} {m.count === 1 ? 'Exemplar fehlt' : 'Exemplare fehlen'}
                        </small>
                      </span>
                      <button
                        aria-label={`${m.name} manuell platzieren`}
                        title="Ein Exemplar manuell platzieren"
                        disabled={previewing || running}
                        onClick={() => placeMissing(m.partId)}
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {report.status === 'valid' && (
                <p className="valid-note">✓ Alle Teile, Abstände und Stoffgrenzen geprüft.</p>
              )}
              {selectedPlacement && placementPart && !previewing && (
                <>
                  <hr />
                  <div className="panel-heading">
                    <h3>Ausgewähltes Exemplar</h3>
                    <span className="small-tag">
                      {Number(selectedPlacement.instanceId.split(':').at(-1)) + 1}
                    </span>
                  </div>
                  <p className="selected-name">{placementPart.name}</p>
                  <div className="form-row">
                    <MeasureInput
                      label="Position X"
                      unit={project.unit}
                      min={-1e6}
                      value={selectedPlacement.x}
                      onChange={(x) => changePlacement({ x })}
                    />
                    <MeasureInput
                      label="Position Y"
                      unit={project.unit}
                      min={-1e6}
                      value={selectedPlacement.y}
                      onChange={(y) => changePlacement({ y })}
                    />
                  </div>
                  <button
                    className="full"
                    onClick={() => changePlacement({ flipped: !selectedPlacement.flipped })}
                  >
                    Um 180° drehen ↻
                  </button>
                  <button
                    className="text-button full"
                    onClick={() => {
                      commit((p) => ({
                        ...p,
                        layoutSource: 'manual',
                        placements: p.placements.filter((q) => q.instanceId !== selectedId),
                      }));
                      setSelectedId(null);
                    }}
                  >
                    Aus der Anordnung nehmen
                  </button>
                  <p className="help">
                    Position der linken oberen Ecke der Zuschneidekontur. Die Ausrichtung bleibt
                    beim Drehen erhalten.
                  </p>
                </>
              )}
              <div className="workshop-tip">
                <span className="eyebrow">WERKSTATTNOTIZ</span>
                <p>
                  Freie Fläche ist auch eine Möglichkeit. Ein zusammenhängendes Reststück bleibt für
                  dein nächstes Projekt.
                </p>
              </div>
            </>
          )}
        </aside>
      </div>
      <footer className="statusbar">
        <span className={saveState === 'Nicht gesichert' ? 'error-text' : ''}>
          <i /> {saveState}
        </span>
        <span>
          Eine Stofflage · {project.unit === 'mm' ? 'Millimeter' : 'Inch'} · {total} Einzelteile
          {total > 50 ? ' · größere Projekte können länger dauern' : ''}
        </span>
        <span>
          Stoffplan <span className="muted">/</span> Prototyp 0.1
        </span>
      </footer>
      {library && (
        <div className="modal-backdrop" onClick={() => setLibrary(null)}>
          <section
            className="modal library-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Projekte"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <span className="eyebrow">LOKALE WERKSTATT</span>
                <h2>Deine Projekte</h2>
              </div>
              <button aria-label="Projekte schließen" onClick={() => setLibrary(null)}>
                ×
              </button>
            </div>
            <button className="primary" onClick={() => openProject(newProject())}>
              + Neues Projekt
            </button>
            <div className="project-list">
              {library.map((p) => (
                <button key={p.id} onClick={() => openProject(p)}>
                  <span>
                    <strong>{p.name || 'Unbenanntes Projekt'}</strong>
                    <small>
                      {p.parts.reduce((sum, part) => sum + part.quantity, 0)} Teile ·{' '}
                      {new Date(p.updatedAt).toLocaleString('de-DE')}
                    </small>
                  </span>
                  <span>→</span>
                </button>
              ))}
            </div>
            <h3>Zum Ausprobieren</h3>
            <div className="button-row">
              <button onClick={() => openProject(exampleProject())}>Maßprobe · 620 mm</button>
              <button onClick={() => openProject(mixedExampleProject())}>Formen & Rundungen</button>
            </div>
            <p className="help">
              Die lokale Sicherung gehört zu diesem Browser. Mit einer Projektdatei kannst du ein
              Projekt sichern oder auf einen anderen Computer übertragen.
            </p>
          </section>
        </div>
      )}
      {mirror && mirrorCopy && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Gespiegelte Kopie">
            <div className="panel-heading">
              <h2>Gegengleiches Teil erstellen</h2>
              <button aria-label="Spiegelvorschau schließen" onClick={() => setMirror(null)}>
                ×
              </button>
            </div>
            <div className="segmented">
              <button
                aria-pressed={mirror.axis === 'vertical'}
                onClick={() => setMirror({ ...mirror, axis: 'vertical' })}
              >
                Links ↔ rechts
              </button>
              <button
                aria-pressed={mirror.axis === 'horizontal'}
                onClick={() => setMirror({ ...mirror, axis: 'horizontal' })}
              >
                Oben ↔ unten
              </button>
            </div>
            <div className="mirror-preview">
              {[project.parts.find((p) => p.id === mirror.partId)!, mirrorCopy].map((p, i) => {
                const poly = flatten(p.contour),
                  b = bounds([poly]);
                return (
                  <div key={i}>
                    <svg viewBox={`${b.minX - 30} ${b.minY - 30} ${b.width + 60} ${b.height + 60}`}>
                      <path d={polygonPath([poly])} fill={p.color} />
                      <path
                        d={`M${p.grain.start.x},${p.grain.start.y}L${p.grain.end.x},${p.grain.end.y}`}
                        stroke="#254e42"
                        strokeWidth="3"
                        strokeDasharray="10 5"
                      />
                    </svg>
                    <p>{i ? 'Gespiegelte Kopie' : 'Original'}</p>
                  </div>
                );
              })}
            </div>
            <p className="help">
              Die Kopie ist unabhängig bearbeitbar. Ihre Bezugslinie wird mitgespiegelt.
            </p>
            <button
              className="primary full"
              onClick={() => {
                if (total + mirrorCopy!.quantity > 500 || project.parts.length >= 200) {
                  setNotice('Maximal 200 Schnittteile und 500 Exemplare pro Projekt.');
                  setMirror(null);
                  return;
                }
                commit((p) => ({ ...p, parts: [...p.parts, mirrorCopy!] }));
                setSelectedPartId(mirrorCopy!.id);
                setMirror(null);
              }}
            >
              Gespiegelte Kopie erstellen
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
