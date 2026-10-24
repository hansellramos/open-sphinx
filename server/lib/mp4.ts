// Lo mínimo de MP4 fragmentado para corregir tiempos: al reanudar una exportación, ffmpeg empieza otra vez en 0
// (no respeta -output_ts_offset con HLS fMP4), así que a cada fragmento nuevo se le suma lo ya hecho en el
// tiempo de decodificación de cada pista (tfdt) y en el sidx si lo hay.

type Caja = { tipo: string; ini: number; fin: number; cuerpo: number }

function* cajas(b: Uint8Array, ini = 0, fin = b.length): Generator<Caja> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let p = ini
  while (p + 8 <= fin) {
    let tam = dv.getUint32(p)
    const tipo = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7])
    let cuerpo = p + 8
    if (tam === 1) {
      tam = Number(dv.getBigUint64(p + 8))
      cuerpo = p + 16
    } else if (tam === 0) tam = fin - p
    if (tam < 8 || p + tam > fin) return
    yield { tipo, ini: p, fin: p + tam, cuerpo }
    p += tam
  }
}

const hijo = (b: Uint8Array, c: Caja, tipo: string) => [...cajas(b, c.cuerpo, c.fin)].find((x) => x.tipo === tipo)

// track_ID → timescale, leído del init.mp4.
export function escalas(init: Uint8Array) {
  const dv = new DataView(init.buffer, init.byteOffset, init.byteLength)
  const out = new Map<number, number>()
  const moov = [...cajas(init)].find((c) => c.tipo === 'moov')
  if (!moov) throw new Error('init.mp4 sin moov')
  for (const trak of cajas(init, moov.cuerpo, moov.fin)) {
    if (trak.tipo !== 'trak') continue
    const tkhd = hijo(init, trak, 'tkhd')
    const mdia = hijo(init, trak, 'mdia')
    const mdhd = mdia && hijo(init, mdia, 'mdhd')
    if (!tkhd || !mdhd) continue
    const vt = init[tkhd.cuerpo], vm = init[mdhd.cuerpo]
    const id = dv.getUint32(tkhd.cuerpo + (vt === 1 ? 20 : 12))
    out.set(id, dv.getUint32(mdhd.cuerpo + (vm === 1 ? 20 : 12)))
  }
  return out
}

// Suma `segundos` a los tiempos de un fragmento (en el lugar). Devuelve cuántos tfdt cambió.
export function desplazar(seg: Uint8Array, segundos: number, ts: Map<number, number>) {
  const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength)
  let n = 0
  for (const c of cajas(seg)) {
    if (c.tipo === 'sidx') {
      const v = seg[c.cuerpo]
      const escala = dv.getUint32(c.cuerpo + 8)
      const d = BigInt(Math.round(segundos * escala))
      if (v === 1) dv.setBigUint64(c.cuerpo + 12, dv.getBigUint64(c.cuerpo + 12) + d)
      else dv.setUint32(c.cuerpo + 12, dv.getUint32(c.cuerpo + 12) + Number(d))
    }
    if (c.tipo !== 'moof') continue
    for (const traf of cajas(seg, c.cuerpo, c.fin)) {
      if (traf.tipo !== 'traf') continue
      const tfhd = hijo(seg, traf, 'tfhd')
      const tfdt = hijo(seg, traf, 'tfdt')
      if (!tfhd || !tfdt) continue
      const escala = ts.get(dv.getUint32(tfhd.cuerpo + 4))
      if (!escala) continue
      const d = BigInt(Math.round(segundos * escala))
      if (seg[tfdt.cuerpo] === 1) dv.setBigUint64(tfdt.cuerpo + 4, dv.getBigUint64(tfdt.cuerpo + 4) + d)
      else {
        const nuevo = BigInt(dv.getUint32(tfdt.cuerpo + 4)) + d
        if (nuevo > 0xffffffffn) throw new Error('tfdt de 32 bits no alcanza') // ffmpeg escribe la versión 1
        dv.setUint32(tfdt.cuerpo + 4, Number(nuevo))
      }
      n++
    }
  }
  return n
}
