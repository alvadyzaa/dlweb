/** ZIP store-only builder — port ringan dari zipfile.ZipFile(ZIP_STORED).
 *  Tidak ada kompresi (JPEG/WebP sudah terkompresi), hanya CRC32 + header.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

interface Entry {
  name: string
  data: Uint8Array
  crc: number
  offset: number
}

/** Buka satu entry dalam arsip: local file header + nama + data. */
function writeLocalHeader(enc: TextEncoder, entry: Entry, time: number, date: number): Uint8Array {
  const nameBytes = enc.encode(entry.name)
  const header = new DataView(new ArrayBuffer(30))
  header.setUint32(0, 0x04034b50, true)
  header.setUint16(4, 20, true) // version needed
  header.setUint16(6, 0x0800, true) // UTF-8 names
  header.setUint16(8, 0, true) // method: store
  header.setUint16(10, time, true)
  header.setUint16(12, date, true)
  header.setUint32(14, entry.crc, true)
  header.setUint32(18, entry.data.length, true)
  header.setUint32(22, entry.data.length, true)
  header.setUint16(26, nameBytes.length, true)
  header.setUint16(28, 0, true)
  const out = new Uint8Array(30 + nameBytes.length + entry.data.length)
  out.set(new Uint8Array(header.buffer), 0)
  out.set(nameBytes, 30)
  out.set(entry.data, 30 + nameBytes.length)
  return out
}

function writeCentralHeader(enc: TextEncoder, entry: Entry, time: number, date: number): Uint8Array {
  const nameBytes = enc.encode(entry.name)
  const h = new DataView(new ArrayBuffer(46))
  h.setUint32(0, 0x02014b50, true)
  h.setUint16(4, 20, true)
  h.setUint16(6, 20, true)
  h.setUint16(8, 0x0800, true)
  h.setUint16(10, 0, true)
  h.setUint16(12, time, true)
  h.setUint16(14, date, true)
  h.setUint32(16, entry.crc, true)
  h.setUint32(20, entry.data.length, true)
  h.setUint32(24, entry.data.length, true)
  h.setUint16(28, nameBytes.length, true)
  h.setUint32(42, entry.offset, true)
  const out = new Uint8Array(46 + nameBytes.length)
  out.set(new Uint8Array(h.buffer), 0)
  out.set(nameBytes, 46)
  return out
}

/** Buat arsip ZIP dari daftar (nama file, bytes). */
export function makeZip(items: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder()
  const { time, date } = dosDateTime(new Date())
  const entries: Entry[] = []
  let offset = 0

  const chunks: Uint8Array[] = []
  for (const item of items) {
    const crc = crc32(item.data)
    const entry: Entry = { name: item.name, data: item.data, crc, offset }
    const local = writeLocalHeader(enc, entry, time, date)
    chunks.push(local)
    offset += local.length
    entries.push(entry)
  }
  const centralStart = offset
  for (const entry of entries) {
    const central = writeCentralHeader(enc, entry, time, date)
    chunks.push(central)
    offset += central.length
  }
  const eocd = new DataView(new ArrayBuffer(22))
  eocd.setUint32(0, 0x06054b50, true)
  eocd.setUint16(8, entries.length, true)
  eocd.setUint16(10, entries.length, true)
  eocd.setUint32(12, offset - centralStart, true)
  eocd.setUint32(16, centralStart, true)
  chunks.push(new Uint8Array(eocd.buffer))

  const total = chunks.reduce((a, c) => a + c.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}
