/**
 * The Line calc view's small building blocks. Class names carry an `lc-` prefix because
 * the designer already owns `.field`, `.stat` and `.hint` — `.hint` is absolutely
 * positioned over the canvas — and the two layouts want different things from them.
 */

import type { ReactNode } from 'react';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="lc-field">
      <span className="lc-field__label">{label}</span>
      {children}
    </label>
  );
}

/**
 * A number input that keeps the user's keystrokes while they type.
 *
 * Committing on every change means clearing the box to retype sends NaN downstream and
 * the layout jumps to "—" mid-edit; committing only on blur loses the last edit when the
 * user clicks straight onto another control. This commits valid numbers immediately and
 * simply ignores the transient invalid states, which is what both of those want.
 */
export function Num({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <span className="lc-num">
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = e.currentTarget.valueAsNumber;
          if (!Number.isFinite(n)) return;
          onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
        }}
      />
      {suffix && <span className="lc-num__suffix">{suffix}</span>}
    </span>
  );
}

export function Stat({
  label,
  value,
  note,
  tone = 'plain',
  big = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'plain' | 'data' | 'power';
  big?: boolean;
}) {
  return (
    <div className={`lc-stat lc-stat--${tone}${big ? ' lc-stat--big' : ''}`}>
      <span className="lc-stat__label">{label}</span>
      <span className="lc-stat__value">{value}</span>
      {note && <span className="lc-stat__note">{note}</span>}
    </div>
  );
}

export function Bar({ fraction, tone }: { fraction: number; tone: 'data' | 'power' }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className={`lc-bar lc-bar--${tone}`} role="presentation">
      <span className="lc-bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
