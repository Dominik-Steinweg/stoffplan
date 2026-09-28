import { useEffect, useRef, useState } from 'react';
import { formatMeasure, parseMeasure } from '../domain/units';
import type { Unit } from '../domain/types';

export function MeasureInput({
  label,
  value,
  unit,
  onChange,
  min = 0,
  positive = false,
}: {
  label: string;
  value: number;
  unit: Unit;
  onChange: (value: number) => void;
  min?: number;
  positive?: boolean;
}) {
  const [text, setText] = useState(formatMeasure(value, unit)),
    [error, setError] = useState('');
  const dirty = useRef(false);
  useEffect(() => {
    setText(formatMeasure(value, unit));
    dirty.current = false;
    setError('');
  }, [value, unit]);
  function commit() {
    if (!dirty.current) return;
    try {
      const next = parseMeasure(text, unit);
      if (next < min || (positive && next <= 0))
        throw new Error(
          positive
            ? 'Das Maß muss größer als 0 sein.'
            : `Das Maß muss mindestens ${min} mm betragen.`,
        );
      dirty.current = false;
      setError('');
      setText(formatMeasure(next, unit));
      if (next !== value) onChange(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <label className="field">
      <span>{label}</span>
      <div className={`measure-input ${error ? 'has-error' : ''}`}>
        <input
          aria-label={label}
          value={text}
          inputMode="decimal"
          aria-invalid={!!error}
          onChange={(e) => {
            dirty.current = true;
            setText(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              dirty.current = false;
              setText(formatMeasure(value, unit));
              setError('');
              e.currentTarget.blur();
            }
          }}
        />
        <span>{unit}</span>
      </div>
      {error && (
        <small role="alert" className="field-error">
          {error}
        </small>
      )}
    </label>
  );
}
