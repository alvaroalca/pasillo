import type { Graphics } from 'pixi.js'
import type { Camara } from './camara'
import { CELDA } from './geometria'
import { tema } from './tema'

const MAYOR = 5 // metros entre líneas gruesas

export function dibujarRejilla(g: Graphics, cam: Camara, ancho: number, alto: number) {
  g.clear()
  const a = cam.aMundo(0, 0)
  const b = cam.aMundo(ancho, alto)

  // La rejilla de 50 cm solo se ve de cerca; de lejos sería ruido.
  if (CELDA * cam.zoom >= 8) lineas(g, cam, a.x, a.y, b.x, b.y, CELDA, ancho, alto)
  g.stroke({ width: 1, color: tema.rejillaFina, alpha: 0.12, pixelLine: true })

  lineas(g, cam, a.x, a.y, b.x, b.y, MAYOR, ancho, alto)
  g.stroke({ width: 1, color: tema.rejillaGruesa, alpha: 0.22, pixelLine: true })
}

function lineas(
  g: Graphics,
  cam: Camara,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  paso: number,
  ancho: number,
  alto: number,
) {
  for (let x = Math.ceil(x0 / paso) * paso; x <= x1; x += paso) {
    const sx = Math.round(x * cam.zoom + cam.x)
    g.moveTo(sx, 0).lineTo(sx, alto)
  }
  for (let y = Math.ceil(y0 / paso) * paso; y <= y1; y += paso) {
    const sy = Math.round(y * cam.zoom + cam.y)
    g.moveTo(0, sy).lineTo(ancho, sy)
  }
}
