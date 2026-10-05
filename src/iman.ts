import type { Graphics } from 'pixi.js'
import type { Camara } from './camara'
import { tema } from './tema'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Línea guía en el mundo: vertical (`eje: 'x'`, en x = valor) u horizontal. */
export interface Guia {
  eje: 'x' | 'y'
  valor: number
  desde: number
  hasta: number
}

const VECINDAD = 3 // m: solo imantan las góndolas a esta distancia o menos
const UMBRAL_PX = 10
const UMBRAL_MAX = 1.5 // m: de lejos, 10 px serían varios metros y el imán tiraría demasiado

/**
 * Cuánto mover `r` para que sus bordes coincidan con los de las góndolas vecinas: alinear en fila,
 * pegar por el extremo o espalda con espalda. Solo bordes, que caen siempre en la rejilla de 50 cm.
 */
export function imanar(r: Rect, otros: Rect[], zoom: number) {
  const umbral = Math.min(UMBRAL_MAX, UMBRAL_PX / zoom)
  const vecinos = otros.filter((o) => separacion(r, o) <= VECINDAD)

  const mejor = (bordes: (q: Rect) => number[]) => {
    let d = Infinity
    for (const o of vecinos)
      for (const a of bordes(r))
        for (const b of bordes(o)) if (Math.abs(b - a) < Math.abs(d)) d = b - a
    return Math.abs(d) <= umbral ? d : 0
  }
  const bordesX = (q: Rect) => [q.x, q.x + q.w]
  const bordesY = (q: Rect) => [q.y, q.y + q.h]
  const dx = mejor(bordesX)
  const dy = mejor(bordesY)

  // Las guías de todos los bordes que han quedado iguales tras el ajuste.
  const movido = { ...r, x: r.x + dx, y: r.y + dy }
  const guias: Guia[] = []
  const e = 1e-6
  for (const o of vecinos) {
    for (const a of bordesX(movido))
      if (bordesX(o).some((b) => Math.abs(b - a) < e))
        guias.push({ eje: 'x', valor: a, desde: Math.min(movido.y, o.y), hasta: Math.max(movido.y + movido.h, o.y + o.h) })
    for (const a of bordesY(movido))
      if (bordesY(o).some((b) => Math.abs(b - a) < e))
        guias.push({ eje: 'y', valor: a, desde: Math.min(movido.x, o.x), hasta: Math.max(movido.x + movido.w, o.x + o.w) })
  }
  return { dx, dy, guias }
}

/** Distancia entre dos rectángulos (0 si se tocan o se pisan). */
function separacion(a: Rect, b: Rect) {
  const sx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
  const sy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
  return Math.hypot(sx, sy)
}

export function dibujarGuias(g: Graphics, cam: Camara, guias: Guia[]) {
  const extra = 0.75 // m: que la guía sobresalga un poco de las góndolas
  for (const guia of guias) {
    const a = guia.eje === 'x' ? { x: guia.valor, y: guia.desde - extra } : { x: guia.desde - extra, y: guia.valor }
    const b = guia.eje === 'x' ? { x: guia.valor, y: guia.hasta + extra } : { x: guia.hasta + extra, y: guia.valor }
    const pa = cam.aPantalla(a)
    const pb = cam.aPantalla(b)
    g.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y)
  }
  if (guias.length) g.stroke({ width: 1, color: tema.guia, pixelLine: true })
}
