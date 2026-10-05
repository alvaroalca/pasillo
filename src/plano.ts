import { Container, Graphics } from 'pixi.js'
import type { Camara } from './camara'
import { CELDA, distancia, type Vec } from './geometria'
import { etiqueta, vaciar } from './herramienta'
import {
  carasDe,
  colocarPuerta,
  gondolaValida,
  NOMBRE_PUERTA,
  piezaValida,
  rectCabecera,
  rectGondola,
  type ExtremoGondola,
  type Gondola,
  type MuroInterior,
  type Pieza,
  type Plan,
  type TipoPuerta,
} from './plan'
import { Pintura } from './pintura'
import { tema } from './tema'

export const GROSOR_MURO = 4 // px
export const GROSOR_MURO_INTERIOR = 3 // px

export const COLOR_PUERTA: Record<TipoPuerta, number> = {
  entrada: tema.acento,
  salida: tema.salida,
  emergencia: tema.emergencia,
  interior: tema.interior,
}

const claveTramo = (muro: MuroInterior | null, i: number) => `${muro?.id ?? 'c'}-${i}`

/**
 * Añade al trazo de `g` los tramos de un muro saltándose los huecos de puerta.
 * Todo va en un solo trazo para que las esquinas se unan bien; cada hueco levanta el lápiz.
 */
function trazarMuro(
  g: Graphics,
  cam: Camara,
  puntos: Vec[],
  cerrado: boolean,
  muro: MuroInterior | null,
  huecos: Map<string, [number, number][]>,
) {
  const n = cerrado ? puntos.length : puntos.length - 1
  let lapiz = false
  for (let i = 0; i < n; i++) {
    const a = puntos[i]
    const b = puntos[(i + 1) % puntos.length]
    const largo = distancia(a, b)
    const en = (t: number) => cam.aPantalla({ x: a.x + ((b.x - a.x) * t) / largo, y: a.y + ((b.y - a.y) * t) / largo })
    if (!lapiz) {
      const p = cam.aPantalla(a)
      g.moveTo(p.x, p.y)
      lapiz = true
    }
    for (const [h0, h1] of (huecos.get(claveTramo(muro, i)) ?? []).sort((x, y) => x[0] - y[0])) {
      const p0 = en(h0)
      const p1 = en(h1)
      g.lineTo(p0.x, p0.y)
      g.moveTo(p1.x, p1.y)
    }
    const pb = cam.aPantalla(b)
    g.lineTo(pb.x, pb.y)
  }
}

/** Lo que es de la tienda en sí: suelo, muros con sus puertas y mueble. Común a todas las herramientas. */
export class Plano {
  readonly vista = new Container()
  readonly pintura = new Pintura()
  private suelo = new Graphics()
  private g = new Graphics()
  private etiquetas = new Container()
  private cam: Camara
  private plan: Plan

  constructor(cam: Camara, plan: Plan) {
    this.cam = cam
    this.plan = plan
    this.vista.addChild(this.suelo, this.pintura.vista, this.g, this.etiquetas)
  }

  dibujar() {
    const g = this.g
    const cam = this.cam
    g.clear()
    this.suelo.clear()
    vaciar(this.etiquetas)
    const c = this.plan.contorno
    const capas = this.plan.capas
    this.pintura.vista.visible = !!c && capas.pintura.visible
    if (!c) return

    const s = c.map((v) => cam.aPantalla(v))
    this.suelo.poly(s.flatMap((v) => [v.x, v.y]), true).fill({ color: tema.suelo })
    this.pintura.actualizar(this.plan)
    this.pintura.seguir(cam)
    // Las puertas abren hueco en su tramo de muro: se guarda dónde, en metros desde el inicio del tramo.
    const puertas = capas.puertas.visible ? this.plan.puertas : []
    const sitios = puertas.map((p) => colocarPuerta(this.plan, p.centro, p.ancho))
    const huecos = new Map<string, [number, number][]>()
    sitios.forEach((sitio, n) => {
      if (!sitio) return
      const k = claveTramo(sitio.tramo.muro, sitio.tramo.i)
      const medio = puertas[n].ancho / 2
      huecos.set(k, [...(huecos.get(k) ?? []), [sitio.desde - medio, sitio.desde + medio]])
    })

    if (capas.muros.visible) {
      trazarMuro(g, cam, c, true, null, huecos)
      g.stroke({ width: GROSOR_MURO, color: tema.muro, join: 'round', cap: 'round' })
      for (const m of this.plan.muros) trazarMuro(g, cam, m.puntos, false, m, huecos)
      g.stroke({ width: GROSOR_MURO_INTERIOR, color: tema.muro, join: 'round', cap: 'round' })
    }

    sitios.forEach((sitio, n) => {
      if (!sitio) return
      const p = puertas[n]
      const a = cam.aPantalla(sitio.a)
      const b = cam.aPantalla(sitio.b)
      // En el hueco, una franja del color del tipo de puerta.
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 3, color: COLOR_PUERTA[p.tipo], cap: 'round' })
      if (p.tipo !== 'interior' && p.ancho * cam.zoom >= 28) {
        const m = cam.aPantalla(sitio.centro)
        this.etiquetas.addChild(etiqueta(NOMBRE_PUERTA[p.tipo], m.x, m.y - 12, COLOR_PUERTA[p.tipo]))
      }
    })

    if (capas.gondolas.visible) {
      for (const gd of this.plan.gondolas) dibujarGondola(g, cam, this.plan, gd, gondolaValida(this.plan, gd))
      for (const pz of this.plan.piezas) dibujarPieza(g, cam, this.plan, pz, piezaValida(this.plan, pz))
    }

    // El nombre de cada mancha, si cabe.
    for (const m of capas.pintura.visible ? this.pintura.manchas : []) {
      const area = this.plan.areas.find((a) => a.id === m.area)
      if (!area || m.celdas * CELDA * CELDA * cam.zoom * cam.zoom < 2500) continue
      const p = cam.aPantalla(m.centro)
      this.etiquetas.addChild(etiqueta(area.nombre, p.x, p.y, oscurecer(area.color), true))
    }
  }
}

/** El color del área mezclado con el del muro, para que el texto se lea encima. */
export function oscurecer(color: number, t = 0.6): number {
  const mezcla = (d: number) => {
    const a = (color >> d) & 0xff
    const b = (tema.muro >> d) & 0xff
    return Math.round(a + (b - a) * t) << d
  }
  return mezcla(16) | mezcla(8) | mezcla(0)
}

const colorDe = (plan: Plan, area: number | null | undefined) =>
  area == null ? null : (plan.areas.find((a) => a.id === area)?.color ?? null)

/**
 * Góndola: cuerpo gris carbón y, encima, cada cara pintada por tramos con el color de su sección.
 * La línea central separa las dos caras. Sus cabeceras van pegadas a los extremos.
 */
export function dibujarGondola(g: Graphics, cam: Camara, plan: Plan, gd: Gondola, valida: boolean, alpha = 1) {
  const base = valida ? tema.gondola : tema.error
  const r = rectGondola(gd)
  const p = cam.aPantalla({ x: r.x, y: r.y })
  const w = r.w * cam.zoom
  const h = r.h * cam.zoom
  // Un pelo más estrecha que su celda para que dos góndolas juntas se lean como dos.
  const m = Math.min(1.5, Math.min(w, h) * 0.08)
  g.roundRect(p.x + m, p.y + m, w - 2 * m, h - 2 * m, Math.min(w, h) * 0.3).fill({ color: base, alpha })

  // Caras pintadas: tramos seguidos de la misma sección en un solo rectángulo, a cada lado de la línea central.
  const paso = CELDA * cam.zoom
  const fondo = Math.min(w, h)
  const borde = Math.max(m, fondo * 0.12)
  const caras = carasDe(gd)
  for (const cara of [0, 1] as const) {
    const tramos = caras[cara]
    let k = 0
    while (k < tramos.length) {
      const area = tramos[k]
      let n = 1
      while (k + n < tramos.length && tramos[k + n] === area) n++
      const color = colorDe(plan, area)
      if (color !== null) {
        const largo = n * paso - 2
        const ancho = fondo / 2 - borde - 1
        const a = k * paso + 1
        const b = cara === 0 ? borde : fondo / 2 + 1
        if (gd.horizontal) g.rect(p.x + a, p.y + b, largo, ancho).fill({ color, alpha })
        else g.rect(p.x + b, p.y + a, ancho, largo).fill({ color, alpha })
      }
      k += n
    }
  }

  // Línea central: las dos caras.
  if (Math.min(w, h) >= 8) {
    if (gd.horizontal) g.moveTo(p.x + h * 0.4, p.y + h / 2).lineTo(p.x + w - h * 0.4, p.y + h / 2)
    else g.moveTo(p.x + w / 2, p.y + w * 0.4).lineTo(p.x + w / 2, p.y + h - w * 0.4)
    g.stroke({ width: 1, color: tema.gondolaCara, alpha })
  }

  for (const e of ['inicio', 'fin'] as ExtremoGondola[]) {
    const cab = gd.cabeceras?.[e]
    if (!cab) continue
    const rc = rectCabecera(gd, e)
    const pc = cam.aPantalla({ x: rc.x, y: rc.y })
    const wc = rc.w * cam.zoom
    const hc = rc.h * cam.zoom
    g.roundRect(pc.x + m, pc.y + m, wc - 2 * m, hc - 2 * m, Math.min(wc, hc) * 0.3).fill({ color: base, alpha })
    const color = colorDe(plan, cab.area)
    const b = Math.max(m, Math.min(wc, hc) * 0.22)
    if (color !== null) g.rect(pc.x + b, pc.y + b, wc - 2 * b, hc - 2 * b).fill({ color, alpha })
  }
}

/**
 * Cubo: una cesta vista desde arriba (marco gris y fondo de su sección).
 * Expo: una tarima con su color y un expositor en rombo en el centro.
 */
export function dibujarPieza(g: Graphics, cam: Camara, plan: Plan, pz: Pieza, valida: boolean, alpha = 1) {
  const p = cam.aPantalla({ x: pz.x, y: pz.y })
  const w = pz.w * cam.zoom
  const h = pz.h * cam.zoom
  const m = Math.min(1.5, Math.min(w, h) * 0.06)
  const color = colorDe(plan, pz.area) ?? tema.piezaVacia
  const marco = valida ? tema.gondola : tema.error
  if (pz.tipo === 'cubo') {
    const b = Math.max(2, Math.min(w, h) * 0.16)
    g.roundRect(p.x + m, p.y + m, w - 2 * m, h - 2 * m, Math.min(w, h) * 0.18).fill({ color: marco, alpha })
    g.roundRect(p.x + b, p.y + b, w - 2 * b, h - 2 * b, Math.min(w, h) * 0.08).fill({ color, alpha })
  } else {
    g.roundRect(p.x + m, p.y + m, w - 2 * m, h - 2 * m, Math.min(w, h) * 0.22)
      .fill({ color, alpha })
      .stroke({ width: 2, color: marco, alpha })
    const cx = p.x + w / 2
    const cy = p.y + h / 2
    const d = Math.min(w, h) * 0.2
    g.poly([cx, cy - d, cx + d, cy, cx, cy + d, cx - d, cy], true).fill({ color: marco, alpha })
  }
}
