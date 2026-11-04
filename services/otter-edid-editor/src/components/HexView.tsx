import { useMemo, useRef, useState } from 'react'
import type { Edid } from '../lib/edid/types.ts'
import { encodeEdid } from '../lib/edid/encode.ts'
import { Panel } from './ui.tsx'

type Format = 'bin' | 'hex' | 'c' | 'xxd'

function render(bytes: Uint8Array, fmt: Format, name: string): string {
  const hex = (b: number) => b.toString(16).padStart(2, '0')
  switch (fmt) {
    case 'hex':
      return [...bytes].map(hex).join('')
    case 'c': {
      const lines: string[] = [`static const unsigned char ${name}[${bytes.length}] = {`]
      for (let i = 0; i < bytes.length; i += 12) {
        lines.push('  ' + [...bytes.slice(i, i + 12)].map((b) => `0x${hex(b)}`).join(', ') + ',')
      }
      lines.push('};')
      return lines.join('\n')
    }
    default: {
      const lines: string[] = []
      for (let i = 0; i < bytes.length; i += 16) {
        const chunk = [...bytes.slice(i, i + 16)]
        lines.push(`${i.toString(16).padStart(8, '0')}: ${chunk.map(hex).join(' ')}`)
      }
      return lines.join('\n')
    }
  }
}

export function saveBytes(bytes: Uint8Array, filename: string, type = 'application/octet-stream') {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const slug = (s: string) =>
  (s || 'edid').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'edid'

export function HexView({
  edid,
  raw,
  name,
  onLoad,
  title,
}: {
  edid?: Edid
  /** Exact bytes to show instead of encoding `edid` — for files that must
   *  not pass through the encoder, like a mosaic tile. */
  raw?: Uint8Array
  name: string
  onLoad?: (data: Uint8Array | string) => void
  title?: string
}) {
  const [fmt, setFmt] = useState<Format>('xxd')
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const built = useMemo(() => {
    if (raw) return { bytes: raw, error: null as string | null }
    if (!edid) return { bytes: null, error: 'nothing to show' }
    try {
      return { bytes: encodeEdid(edid), error: null as string | null }
    } catch (e) {
      return { bytes: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [edid, raw])

  if (built.error || !built.bytes) {
    return (
      <Panel title="EDID bytes">
        <div className="banner bad">
          This EDID cannot be encoded: {built.error}
        </div>
      </Panel>
    )
  }

  const bytes = built.bytes
  const blocks = Math.ceil(bytes.length / 128)
  const text = render(bytes, fmt, slug(name))

  // Binary is the only format any EDID writer actually eats, so it is a real
  // .bin blob rather than a text file with a .bin extension.
  const download = () => saveBytes(bytes, `${slug(name)}.bin`)

  const downloadText = () => {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug(name)}.${fmt === 'c' ? 'h' : 'txt'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Panel title={title ?? `EDID bytes — ${bytes.length} bytes, ${blocks} block${blocks > 1 ? 's' : ''}`}>
      <div className="row" style={{ marginBottom: 10 }}>
        {(['xxd', 'hex', 'c'] as Format[]).map((f) => (
          <button key={f} className="minor" aria-pressed={fmt === f} onClick={() => setFmt(f)}>
            {f === 'xxd' ? 'Offset dump' : f === 'hex' ? 'Flat hex' : 'C array'}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="minor" onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400) }}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="minor" onClick={downloadText}>
          Save text
        </button>
        <button className="go" onClick={download}>
          Download .bin
        </button>
      </div>

      {onLoad ? (
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="minor" onClick={() => fileRef.current?.click()}>
          Open an EDID…
        </button>
        <span className="note" style={{ margin: 0 }}>
          .bin, or a hex dump pasted from anywhere — xrandr, edid-decode, xxd, a C header.
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".bin,.dat,.edid,.txt,.h,.hex"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const buf = new Uint8Array(await f.arrayBuffer())
            // A real EDID always starts 00 FF FF FF; anything else is text.
            const isBinary = buf[0] === 0x00 && buf[1] === 0xff && buf[2] === 0xff
            onLoad?.(isBinary ? buf : new TextDecoder().decode(buf))
            e.target.value = ''
          }}
        />
      </div>
      ) : null}

      <pre className="hex">{text}</pre>
    </Panel>
  )
}
