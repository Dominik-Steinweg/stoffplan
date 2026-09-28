import { useCallback, useState } from 'react';
import type { Project } from '../domain/types';
import { planningKey } from '../domain/model';

export function useHistory(initial: Project) {
  const [history, setHistory] = useState({
    past: [] as Project[],
    present: initial,
    future: [] as Project[],
    revision: 0,
  });
  const commit = useCallback(
    (next: Project | ((p: Project) => Project)) =>
      setHistory((h) => {
        const value = typeof next === 'function' ? next(h.present) : next;
        if (value === h.present) return h;
        const geometryChanged = planningKey(value) !== planningKey(h.present);
        return {
          past: [...h.past.slice(-99), h.present],
          present: {
            ...value,
            variants: geometryChanged ? [] : value.variants,
            layoutSource: geometryChanged ? 'manual' : value.layoutSource,
            updatedAt: new Date().toISOString(),
          },
          future: [],
          revision: h.revision + 1,
        };
      }),
    [],
  );
  const undo = useCallback(
    () =>
      setHistory((h) =>
        !h.past.length
          ? h
          : {
              past: h.past.slice(0, -1),
              present: { ...h.past.at(-1)!, updatedAt: new Date().toISOString() },
              future: [h.present, ...h.future],
              revision: h.revision + 1,
            },
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setHistory((h) =>
        !h.future.length
          ? h
          : {
              past: [...h.past, h.present],
              present: { ...h.future[0], updatedAt: new Date().toISOString() },
              future: h.future.slice(1),
              revision: h.revision + 1,
            },
      ),
    [],
  );
  const load = useCallback(
    (project: Project) =>
      setHistory((h) => ({ past: [], present: project, future: [], revision: h.revision + 1 })),
    [],
  );
  return {
    project: history.present,
    revision: history.revision,
    canUndo: !!history.past.length,
    canRedo: !!history.future.length,
    commit,
    undo,
    redo,
    load,
  };
}
