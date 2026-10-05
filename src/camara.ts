import type { Vec } from './geometria'

const ZOOM_MIN = 2
const ZOOM_MAX = 120

/** Pasa de metros del mundo a píxeles de pantalla y al revés. */
export class Camara {
  /** Posición en pantalla del origen del mundo. */
  x = 0
  y = 0
  /** Píxeles por metro. */
  zoom = 10

  aMundo(sx: number, sy: number): Vec {
    return { x: (sx - this.x) / this.zoom, y: (sy - this.y) / this.zoom }
  }

  aPantalla(v: Vec): Vec {
    return { x: v.x * this.zoom + this.x, y: v.y * this.zoom + this.y }
  }

  /** Zoom manteniendo fijo el punto del mundo que está bajo (sx, sy). */
  zoomEn(sx: number, sy: number, factor: number) {
    const antes = this.aMundo(sx, sy)
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * factor))
    this.x = sx - antes.x * this.zoom
    this.y = sy - antes.y * this.zoom
  }

  encuadrar(c: { minX: number; minY: number; maxX: number; maxY: number }, ancho: number, alto: number) {
    const margen = 0.15
    const zx = (ancho * (1 - 2 * margen)) / Math.max(1, c.maxX - c.minX)
    const zy = (alto * (1 - 2 * margen)) / Math.max(1, c.maxY - c.minY)
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(zx, zy)))
    this.x = ancho / 2 - ((c.minX + c.maxX) / 2) * this.zoom
    this.y = alto / 2 - ((c.minY + c.maxY) / 2) * this.zoom
  }

  /** Paso de ajuste según el zoom: el más fino que deje al menos 10 px entre puntos. */
  pasoAjuste(): number {
    return [0.5, 1, 5, 10].find((p) => p * this.zoom >= 10) ?? 10
  }
}
