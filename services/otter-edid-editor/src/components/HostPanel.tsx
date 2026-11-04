import { useEffect, useMemo, useReducer, useState } from 'react'
import type { EdidHost, HostSlot } from '../host.ts'
import { Panel } from './ui.tsx'

/**
 * Save into the host's EDID slots — shown only when the editor is embedded.
 *
 * One EDID goes to one slot. A mosaic goes to as many slots in a row as it has
 * plugs, starting where the operator says, because a tiled set is only useful
 * whole: half of it in the bank bonds nothing.
 *
 * ⚠️ Replacing a slot that holds something is allowed, but never by default —
 * the picker starts on the first empty slot (or the slot the editor was opened
 * from, which is the one the operator means to change) and names what a write
 * would replace.
 */
export function HostPanel({
  host,
  items,
  preferred,
}: {
  host: EdidHost
  /** What would be written: one EDID, or a mosaic's tiles in plug order. */
  items: { label: string; bytes: Uint8Array | null; error?: string | null }[]
  /** The slot the editor was opened from, if any. */
  preferred?: string
}) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => (host.subscribe ? host.subscribe(bump) : undefined), [host])
  const slots = host.slots()

  const firstEmpty = slots.find((s) => s.empty && !s.locked)
  const [start, setStart] = useState<string>(preferred ?? firstEmpty?.id ?? slots[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  const run = useMemo(() => targets(slots, start, items.length), [slots, start, items.length])
  const replacing = run.filter((s) => !s.empty)
  const locked = run.filter((s) => s.locked)
  const broken = items.find((i) => !i.bytes)
  const blocked =
    busy || !!broken || run.length < items.length || locked.length > 0

  const save = async () => {
    setBusy(true)
    setSaid(null)
    try {
      for (let i = 0; i < items.length; i++) {
        await host.save(run[i].id, items[i].bytes!)
      }
      setSaid({
        ok: true,
        text:
          items.length === 1
            ? `Saved to ${run[0].label}.`
            : `Saved ${items.map((it, i) => `${it.label} to ${run[i].label}`).join(', ')}.`,
      })
    } catch (e) {
      setSaid({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={`Save to ${host.title}`}>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          <span>{items.length === 1 ? 'EDID bank slot' : `First of ${items.length} slots in a row`}</span>
          <select value={start} onChange={(e) => { setStart(e.target.value); setSaid(null) }}>
            {slots.map((s) => (
              <option key={s.id} value={s.id} disabled={s.locked}>
                {s.label} — {s.locked ? `${s.name} (protected)` : s.empty ? 'empty' : s.name}
              </option>
            ))}
          </select>
        </label>
        <button className="go" style={{ alignSelf: 'flex-end' }} disabled={blocked} onClick={save}>
          {busy ? 'Saving…' : items.length === 1 ? `Save to ${run[0]?.label ?? '…'}` : `Save ${items.length} tiles`}
        </button>
      </div>

      {broken ? (
        <div className="note bad">{broken.label} cannot be encoded{broken.error ? `: ${broken.error}` : ''}.</div>
      ) : run.length < items.length ? (
        <div className="note bad">
          There are not {items.length} slots from {slots.find((s) => s.id === start)?.label} to the end of the bank.
        </div>
      ) : locked.length ? (
        <div className="note bad">{locked.map((s) => s.label).join(', ')} {locked.length > 1 ? 'are' : 'is'} protected.</div>
      ) : replacing.length ? (
        <div className="note warn">
          Replaces {replacing.map((s) => `${s.label} (${s.name || 'unnamed'})`).join(', ')}.
        </div>
      ) : null}
      {items.length > 1 && !broken ? (
        <div className="note">
          {items.map((it, i) => `${it.label} → ${run[i]?.label ?? '—'}`).join(' · ')}
        </div>
      ) : null}
      {said ? <div className={said.ok ? 'note' : 'note bad'} style={said.ok ? { color: 'var(--ok)' } : undefined}>{said.text}</div> : null}
    </Panel>
  )
}

/** `count` slots in bank order from `start`, or fewer when the bank runs out. */
function targets(slots: HostSlot[], start: string, count: number): HostSlot[] {
  const at = slots.findIndex((s) => s.id === start)
  return at < 0 ? [] : slots.slice(at, at + count)
}
