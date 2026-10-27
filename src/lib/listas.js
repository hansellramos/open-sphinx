// Estado de cada lista (filtros, desplazamiento, semanas de «Agregados recientemente») al abrir una foto o video,
// para dejarla igual al volver con «atrás». Por ruta; vive mientras la app esté abierta.
export const memoria = new Map()

// Niveles de zoom de las miniaturas (como en Fotos): de más cerca a más lejos.
export const ZOOMS = ['dia', 'mes', 'anio']
