// Numera los fragmentos (mfhd de cada moof) de un segmento fMP4 a partir de `n` y devuelve el siguiente número.
// Al pegar init + fragmentos en un solo MP4, el reproductor de Apple (iPhone, WhatsApp) deja de leer donde el
// número no crece; en las exportaciones reanudadas ffmpeg lo había vuelto a empezar en 1.
export function numerarFragmentos(buf, n) {
  const b = new Uint8Array(buf)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  for (let p = 0; p + 8 <= b.length; ) {
    const tam = dv.getUint32(p)
    if (tam < 8 || p + tam > b.length) break
    // moof → su primer hijo es mfhd: tamaño(4) tipo(4) versión/flags(4) secuencia(4)
    if (b[p + 4] === 0x6d && b[p + 5] === 0x6f && b[p + 6] === 0x6f && b[p + 7] === 0x66 && String.fromCharCode(...b.subarray(p + 12, p + 16)) === 'mfhd') dv.setUint32(p + 20, n++)
    p += tam
  }
  return n
}
