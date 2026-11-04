/**
 * A stored (uncompressed) zip, enough to hand over a mosaic's tile files in
 * one download. EDIDs are a few hundred bytes; deflate would buy nothing and
 * cost a dependency. Every archiver reads method 0.
 */

let table: Uint32Array | null = null

export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const b of data) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff]
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
  const enc = new TextEncoder()

  const local: number[] = []
  const central: number[] = []
  for (const f of files) {
    const name = [...enc.encode(f.name)]
    const crc = crc32(f.data)
    const offset = local.length
    // version 2.0, no flags, stored, DOS time/date zero (1980-01-01)
    const common = [...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)]
    local.push(...u32(0x04034b50), ...common, ...name, ...f.data)
    central.push(...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name)
  }
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(central.length), ...u32(local.length), ...u16(0)]
  return Uint8Array.from([...local, ...central, ...end])
}
