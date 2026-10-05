/** Punto en metros, en coordenadas del mundo. */
export interface Vec {
  x: number
  y: number
}

/** Lado de la celda de la simulación, en metros. */
export const CELDA = 0.5

export function superficie(p: Vec[]): number {
  let doble = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    doble += a.x * b.y - b.x * a.y
  }
  return Math.abs(doble) / 2
}

export function ajustarARejilla(v: Vec, paso: number): Vec {
  return { x: Math.round(v.x / paso) * paso, y: Math.round(v.y / paso) * paso }
}

/**
 * Lleva `hacia` a la dirección múltiplo de 45° más cercana vista desde `desde`,
 * avanzando un número entero de pasos por eje. Así una diagonal sigue cayendo en la rejilla.
 */
export function ajustarDireccion(desde: Vec, hacia: Vec, paso: number): Vec {
  const dx = hacia.x - desde.x
  const dy = hacia.y - desde.y
  const octante = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
  const ux = Math.round(Math.cos((octante * Math.PI) / 4))
  const uy = Math.round(Math.sin((octante * Math.PI) / 4))
  const n = Math.max(0, Math.round((dx * ux + dy * uy) / ((ux * ux + uy * uy) * paso)))
  return { x: desde.x + ux * n * paso, y: desde.y + uy * n * paso }
}

/**
 * Escala el contorno para que mida `objetivo` m² y vuelve a ajustar las esquinas
 * a la rejilla de la simulación. La superficie final puede variar un poco por ese ajuste.
 */
export function escalarASuperficie(p: Vec[], objetivo: number): Vec[] {
  const s = Math.sqrt(objetivo / superficie(p))
  const o = p[0]
  const escalado = p.map((v) =>
    ajustarARejilla({ x: o.x + (v.x - o.x) * s, y: o.y + (v.y - o.y) * s }, CELDA),
  )
  return escalado.filter((v, i) => {
    const sig = escalado[(i + 1) % escalado.length]
    return v.x !== sig.x || v.y !== sig.y
  })
}

/** Punto más cercano a `p` dentro del segmento a-b. `t` va de 0 a 1. */
export function proyectar(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  const punto = { x: a.x + dx * t, y: a.y + dy * t }
  return { t, punto, distancia: distancia(p, punto) }
}

export function puntoEnPoligono(p: Vec, poli: Vec[]): boolean {
  let dentro = false
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = poli[i]
    const b = poli[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro
  }
  return dentro
}

export function distancia(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function caja(p: Vec[]) {
  const xs = p.map((v) => v.x)
  const ys = p.map((v) => v.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

const cruz = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

function enSegmento(p: Vec, a: Vec, b: Vec) {
  return Math.min(a.x, b.x) - 1e-9 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-9
}

/** Si los segmentos a-b y c-d se cortan o se tocan (también si se solapan en la misma recta). */
export function cortan(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cruz(c, d, a)
  const d2 = cruz(c, d, b)
  const d3 = cruz(a, b, c)
  const d4 = cruz(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  const e = 1e-9
  return (
    (Math.abs(d1) < e && enSegmento(a, c, d)) ||
    (Math.abs(d2) < e && enSegmento(b, c, d)) ||
    (Math.abs(d3) < e && enSegmento(c, a, b)) ||
    (Math.abs(d4) < e && enSegmento(d, a, b))
  )
}

/** Punto donde se cruzan las rectas (infinitas) que pasan por a-b y c-d, o null si son paralelas. */
export function interseccion(a: Vec, b: Vec, c: Vec, d: Vec): Vec | null {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
  if (Math.abs(den) < 1e-12) return null
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/**
 * Si el segmento a-b entra en el rectángulo. Con `estricto`, tocar el borde no cuenta
 * (una góndola pegada a un muro vale; una que lo atraviesa, no).
 */
export function segmentoEnRect(a: Vec, b: Vec, r: { x: number; y: number; w: number; h: number }, estricto = false): boolean {
  const e = estricto ? 1e-6 : -1e-9
  const [x0, y0, x1, y1] = [r.x + e, r.y + e, r.x + r.w - e, r.y + r.h - e]
  // Recorte de Liang-Barsky: si queda algún trozo del segmento dentro, entra.
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
      if (t0 > t1) return false
    }
  }
  return estricto ? t1 - t0 > 1e-9 : true
}
