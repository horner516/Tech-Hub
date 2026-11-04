import { useEffect, useReducer, useState } from 'react'
import type { EdidHost, MosaicApplyResult } from '../host.ts'
import type { MosaicResult } from '../lib/mosaic.ts'
import { Panel } from './ui.tsx'

/**
 * Put a mosaic straight onto the device's inputs — shown only when the host can.
 *
 * The bank (HostPanel) stores tiles; this is the other half: the host groups a
 * run of inputs into one picture and loads each plug with the tile for its
 * place, so a Mac plugged into them joins its outputs into one display.
 *
 * ⚠️ This changes the switcher's input preconfig, possibly mid-show, so it takes
 * two presses — the same rule LivePremier Plus applies to its own preconfig
 * writes.
 */
export function MosaicApply({
  host,
  mosaic,
  cols,
  rows,
}: {
  /** A host with `mosaicTargets` and `applyMosaic` — App only renders this for one. */
  host: EdidHost
  mosaic: MosaicResult
  cols: number
  rows: number
}) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => (host.subscribe ? host.subscribe(bump) : undefined), [host])
  const targets = host.mosaicTargets?.(cols, rows) ?? []
  const firstOk = targets.find((t) => t.ok)
  const [chosen, setChosen] = useState<string>('')
  const target = targets.find((t) => t.id === chosen) ?? firstOk
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MosaicApplyResult | null>(null)

  const apply = async () => {
    if (!target || !host.applyMosaic) return
    setBusy(true)
    setConfirming(false)
    setResult(null)
    try {
      setResult(
        await host.applyMosaic(
          target.id,
          mosaic.tiles.map((t) => ({ col: t.col, row: t.row, label: t.label, bytes: t.bytes })),
        ),
      )
    } catch (e) {
      setResult({ ok: false, steps: [], problems: [e instanceof Error ? e.message : String(e)] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={`Apply to ${host.title}’s inputs`}>
      {targets.length === 0 ? (
        <div className="note">No run of {cols * rows} inputs on {host.title} can be grouped {cols} × {rows}.</div>
      ) : (
        <>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>Group these inputs {cols} × {rows}</span>
              <select
                value={target?.id ?? ''}
                onChange={(e) => { setChosen(e.target.value); setConfirming(false); setResult(null) }}
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id} disabled={!t.ok}>
                    {t.label}{t.ok ? '' : ` — ${t.why}`}
                  </option>
                ))}
              </select>
            </label>
            {confirming ? (
              <>
                <button className="go" style={{ alignSelf: 'flex-end' }} onClick={apply}>
                  Confirm — write to the switcher
                </button>
                <button className="minor" style={{ alignSelf: 'flex-end' }} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="go"
                style={{ alignSelf: 'flex-end' }}
                disabled={busy || !target?.ok}
                onClick={() => setConfirming(true)}
              >
                {busy ? 'Applying…' : 'Apply to inputs'}
              </button>
            )}
          </div>
          {target && !target.ok ? <div className="note bad">{target.why}</div> : null}
          {confirming ? (
            <div className="note warn">
              Changes {host.title}’s input preconfig: {target?.label} becomes one {cols} × {rows} input, and each plug is
              loaded with its tile, replacing the EDID it has now.
            </div>
          ) : (
            <div className="note">
              Groups the inputs into one picture and loads each plug with the tile for its place. Plug the Mac’s outputs
              into them in the same order; it should then show one display, not {cols * rows}.
            </div>
          )}
        </>
      )}

      {result ? (
        <div style={{ marginTop: 8 }}>
          {result.steps.map((s, i) => (
            <div key={`s${i}`} className="note">{s}</div>
          ))}
          {result.problems.map((p, i) => (
            <div key={`p${i}`} className="note bad">{p}</div>
          ))}
          {result.ok ? (
            <div className="note" style={{ color: 'var(--ok)' }}>
              Every plug serves its tile under one topology id. Nothing has proved a Mac bonds through this switcher yet —
              if the Mac lists separate displays, they are not joined.
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}
