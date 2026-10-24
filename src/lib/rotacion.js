// Rotación de un video en su init.mp4 (fMP4): la matriz de la pista de video (tkhd) dice cómo girarlo al
// mostrarlo. El iPhone graba en horizontal y guarda ahí "gíralo 90°"; hls.js/MSE la ignora, por eso el
// reproductor la lee, la pone en cero y gira el <video> con CSS. Ángulos en grados, en sentido horario.
// Matriz (16.16): [a b u; c d v; tx ty w] con a = cos θ, b = sin θ, c = −sin θ, d = cos θ.

const CONTENEDORES = new Set(['moov', 'trak'])

// Posiciones de la matriz de cada tkhd (y si su pista tiene ancho, o sea, es video).
function matrices(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = []
  const recorrer = (ini, fin) => {
    let p = ini
    while (p + 8 <= fin) {
      let tam = dv.getUint32(p)
      const tipo = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
      let cab = 8
      if (tam === 1) {
        if (p + 16 > fin) return
        tam = Number(dv.getBigUint64(p + 8))
        cab = 16
      } else if (tam === 0) tam = fin - p
      if (tam < cab || p + tam > fin) return
      if (CONTENEDORES.has(tipo)) recorrer(p + cab, p + tam)
      else if (tipo === 'tkhd') {
        const version = bytes[p + cab]
        const matriz = p + cab + 4 + (version === 1 ? 32 : 20) + 16
        if (matriz + 44 <= p + tam) out.push({ matriz, ancho: dv.getUint32(matriz + 36) })
      }
      p += tam
    }
  }
  recorrer(0, bytes.length)
  return out
}

const pistaVideo = (bytes) => {
  const ms = matrices(bytes)
  return ms.find((m) => m.ancho > 0) ?? null
}

const normal = (g) => ((Math.round(g / 90) * 90) % 360 + 360) % 360

// 0, 90, 180 o 270 (sentido horario). 0 si no hay pista de video o no se entiende.
export function leerRotacion(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const t = pistaVideo(u8)
  if (!t) return 0
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const a = dv.getInt32(t.matriz) / 65536
  const b = dv.getInt32(t.matriz + 4) / 65536
  return normal((Math.atan2(b, a) * 180) / Math.PI)
}

// Copia del init con la pista de video girada `grados` (sentido horario); 0 = sin girar.
export function conRotacion(bytes, grados) {
  const u8 = new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  const t = pistaVideo(u8)
  if (!t) return u8
  const g = normal(grados)
  const cos = [1, 0, -1, 0][g / 90]
  const sin = [0, 1, 0, -1][g / 90]
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const valores = [cos * 65536, sin * 65536, 0, -sin * 65536, cos * 65536, 0, 0, 0, 0x40000000]
  valores.forEach((v, i) => dv.setInt32(t.matriz + 4 * i, v))
  return u8
}

export const sumarRotacion = (...gs) => normal(gs.reduce((s, g) => s + (Number(g) || 0), 0))
