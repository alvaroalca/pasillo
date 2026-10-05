import { Container, Graphics } from 'pixi.js'
import type { Camara } from './camara'
import { CELDA, puntoEnPoligono, type Vec } from './geometria'
import {
  carasDe,
  celdasDeRect,
  celdaTramo,
  centroCelda,
  claveCelda,
  linealPorArea,
  rectCabecera,
  type ExtremoGondola,
  type Plan,
} from './plan'

/** Un trozo conexo de un área (ciclismo al fondo y un cubo de ciclismo en la entrada son dos manchas). */
export interface Mancha {
  area: number
  celdas: number
  centro: Vec
}

/**
 * Las cuentas de lo pintado y el suelo de las zonas sin venta. El suelo se dibuja en metros dentro
 * de un contenedor que sigue a la cámara, así que mover la vista no lo recalcula; solo los cambios.
 * El mueble pintado lo dibuja el plano, con cada góndola, cabecera y pieza.
 */
export class Pintura {
  readonly vista = new Container()
  /** m² de suelo de cada zona sin venta (solo dentro de la tienda). */
  m2 = new Map<number, number>()
  /** Metros de lineal útil de cada sección. */
  lineal = new Map<number, number>()
  /** Cubos y expos de cada sección. */
  piezas = new Map<number, number>()
  /** Manchas de suelo y de mueble, para poner el nombre encima. */
  manchas: Mancha[] = []

  private g = new Graphics()
  private firma = ''

  constructor() {
    this.vista.addChild(this.g)
  }

  seguir(cam: Camara) {
    this.vista.position.set(cam.x, cam.y)
    this.vista.scale.set(cam.zoom)
  }

  actualizar(plan: Plan) {
    const firma = [plan.version, plan.contorno, plan.gondolas, plan.piezas, plan.muros].map((x) => JSON.stringify(x)).join('|')
    if (firma === this.firma) return
    this.firma = firma

    const c = plan.contorno
    const suelo = new Map<string, number>()
    if (c)
      for (const [k, area] of plan.celdas) {
        const [i, j] = k.split(',').map(Number)
        if (puntoEnPoligono(centroCelda(i, j), c)) suelo.set(k, area)
      }

    this.m2 = new Map()
    for (const area of suelo.values()) this.m2.set(area, (this.m2.get(area) ?? 0) + CELDA * CELDA)

    this.lineal = linealPorArea(plan)
    this.piezas = new Map()
    for (const p of plan.piezas) if (p.area !== null) this.piezas.set(p.area, (this.piezas.get(p.area) ?? 0) + 1)

    this.manchas = [...buscarManchas(suelo), ...buscarManchas(celdasDelMueble(plan))]
    this.dibujar(plan, suelo)
  }

  private dibujar(plan: Plan, validas: Map<string, number>) {
    const g = this.g
    g.clear()
    // Por filas: tramos seguidos de la misma área en un solo rectángulo.
    const filas = new Map<number, { i: number; area: number }[]>()
    for (const [k, area] of validas) {
      const [i, j] = k.split(',').map(Number)
      if (!filas.has(j)) filas.set(j, [])
      filas.get(j)!.push({ i, area })
    }
    const porArea = new Map<number, [number, number, number][]>() // [i, j, largo]
    for (const [j, celdas] of filas) {
      celdas.sort((a, b) => a.i - b.i)
      let inicio = celdas[0]
      let largo = 1
      for (let n = 1; n <= celdas.length; n++) {
        const c = celdas[n]
        if (c && c.area === inicio.area && c.i === inicio.i + largo) {
          largo++
          continue
        }
        if (!porArea.has(inicio.area)) porArea.set(inicio.area, [])
        porArea.get(inicio.area)!.push([inicio.i, j, largo])
        if (c) {
          inicio = c
          largo = 1
        }
      }
    }
    // Un pelo de solape para que no se vean costuras entre filas.
    const e = 0.01
    for (const area of plan.areas) {
      const tramos = porArea.get(area.id)
      if (!tramos) continue
      for (const [i, j, largo] of tramos) g.rect(i * CELDA - e, j * CELDA - e, largo * CELDA + 2 * e, CELDA + 2 * e)
      g.fill({ color: area.color })
    }
  }
}

/** Celda → sección de todo el mueble pintado: tramos de góndola, cabeceras, cubos y expos. */
function celdasDelMueble(plan: Plan): Map<string, number> {
  const celdas = new Map<string, number>()
  for (const g of plan.gondolas) {
    const caras = carasDe(g)
    for (const cara of [0, 1] as const)
      caras[cara].forEach((area, k) => {
        if (area !== null) celdas.set(claveCelda(...celdaTramo(g, cara, k)), area)
      })
    for (const e of ['inicio', 'fin'] as ExtremoGondola[]) {
      const area = g.cabeceras?.[e]?.area
      if (area != null) for (const [i, j] of celdasDeRect(rectCabecera(g, e))) celdas.set(claveCelda(i, j), area)
    }
  }
  for (const p of plan.piezas) if (p.area !== null) for (const [i, j] of celdasDeRect(p)) celdas.set(claveCelda(i, j), p.area)
  return celdas
}

function buscarManchas(celdas: Map<string, number>): Mancha[] {
  const vistas = new Set<string>()
  const manchas: Mancha[] = []
  for (const [k, area] of celdas) {
    if (vistas.has(k)) continue
    vistas.add(k)
    const pila = [k]
    let n = 0
    let sx = 0
    let sy = 0
    while (pila.length) {
      const actual = pila.pop()!
      const [i, j] = actual.split(',').map(Number)
      n++
      sx += i
      sy += j
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const v = claveCelda(i + di, j + dj)
        if (!vistas.has(v) && celdas.get(v) === area) {
          vistas.add(v)
          pila.push(v)
        }
      }
    }
    manchas.push({ area, celdas: n, centro: { x: (sx / n + 0.5) * CELDA, y: (sy / n + 0.5) * CELDA } })
  }
  return manchas
}
