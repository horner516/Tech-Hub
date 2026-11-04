import type { ReactNode } from 'react'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>
        {label}
        {hint ? <span className="hint"> · {hint}</span> : null}
      </span>
      {children}
    </label>
  )
}

export function Num({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    </Field>
  )
}

export function Text({
  label,
  hint,
  value,
  onChange,
  maxLength,
  placeholder,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  maxLength?: number
  placeholder?: string
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="text" value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

export function Pick<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value
          const hit = options.find((o) => String(o.value) === raw)
          if (hit) onChange(hit.value)
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function Check({
  label,
  checked,
  onChange,
  title,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  title?: string
}) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Panel({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="panel">
      <h2 style={right ? { display: 'flex', alignItems: 'center', gap: 10 } : undefined}>
        {title}
        {right ? <span style={{ marginLeft: 'auto' }}>{right}</span> : null}
      </h2>
      {children}
    </section>
  )
}

export function Stat({ k, v, small }: { k: string; v: string; small?: boolean }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={small ? 'v small' : 'v'}>{v}</div>
    </div>
  )
}
