// Mete un bloque EXIF (como el de un celular) en un JPEG de prueba: fecha con zona, GPS, equipo y orientación.
type Entrada = { tag: number; type: number; count: number; data: Buffer }

const ascii = (tag: number, s: string): Entrada => ({ tag, type: 2, count: s.length + 1, data: Buffer.from(`${s}\0`, 'latin1') })
const short = (tag: number, n: number): Entrada => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n)
  return { tag, type: 3, count: 1, data: b }
}
const long = (tag: number, n: number): Entrada => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return { tag, type: 4, count: 1, data: b }
}
const byte = (tag: number, n: number): Entrada => ({ tag, type: 1, count: 1, data: Buffer.from([n]) })
const rational = (tag: number, ...vals: number[]): Entrada => {
  const b = Buffer.alloc(8 * vals.length)
  vals.forEach((v, i) => {
    b.writeUInt32BE(Math.round(v * 10000), i * 8)
    b.writeUInt32BE(10000, i * 8 + 4)
  })
  return { tag, type: 5, count: vals.length, data: b }
}

// IFD en `offset` (relativo al inicio del TIFF): entradas + datos que no caben en 4 bytes.
function ifd(entradas: Entrada[], offset: number) {
  const ordenadas = [...entradas].sort((a, b) => a.tag - b.tag)
  const cabeza = Buffer.alloc(2 + 12 * ordenadas.length + 4)
  cabeza.writeUInt16BE(ordenadas.length)
  const extra: Buffer[] = []
  let libre = offset + cabeza.length
  ordenadas.forEach((e, i) => {
    const p = 2 + 12 * i
    cabeza.writeUInt16BE(e.tag, p)
    cabeza.writeUInt16BE(e.type, p + 2)
    cabeza.writeUInt32BE(e.count, p + 4)
    if (e.data.length <= 4) e.data.copy(cabeza, p + 8)
    else {
      cabeza.writeUInt32BE(libre, p + 8)
      const d = e.data.length % 2 ? Buffer.concat([e.data, Buffer.alloc(1)]) : e.data
      extra.push(d)
      libre += d.length
    }
  })
  return Buffer.concat([cabeza, ...extra])
}

export function conExif(jpeg: Buffer, o: { fecha: string; zona: string; lat: number; lon: number; alt: number; make: string; model: string; orientacion?: number }) {
  const dms = (x: number) => {
    const a = Math.abs(x)
    const g = Math.floor(a), m = Math.floor((a - g) * 60)
    return [g, m, +((a - g - m / 60) * 3600).toFixed(4)]
  }
  const exifIfd = [ascii(0x9003, o.fecha), ascii(0x9011, o.zona)]
  const gpsIfd = [ascii(1, o.lat >= 0 ? 'N' : 'S'), rational(2, ...dms(o.lat)), ascii(3, o.lon >= 0 ? 'E' : 'W'), rational(4, ...dms(o.lon)), byte(5, 0), rational(6, o.alt)]
  const ifd0 = (exifOff: number, gpsOff: number) => [ascii(0x010f, o.make), ascii(0x0110, o.model), short(0x0112, o.orientacion ?? 1), long(0x8769, exifOff), long(0x8825, gpsOff)]
  const largo0 = ifd(ifd0(0, 0), 8).length
  const offExif = 8 + largo0
  const bExif = ifd(exifIfd, offExif)
  const offGps = offExif + bExif.length
  const tiff = Buffer.concat([Buffer.from('MM\0\x2a\0\0\0\x08', 'latin1'), ifd(ifd0(offExif, offGps), 8), bExif, ifd(gpsIfd, offGps)])
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const seg = Buffer.alloc(4)
  seg.writeUInt16BE(0xffe1)
  seg.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([jpeg.subarray(0, 2), seg, payload, jpeg.subarray(2)])
}
