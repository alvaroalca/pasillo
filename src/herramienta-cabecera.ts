import { PanelRight } from 'lucide'
import { Container, Graphics } from 'pixi.js'
import type { Vec } from './geometria'
import type { Contexto, Herramienta } from './herramienta'
import { dentroDe, editable, rectCabecera, type ExtremoGondola, type Gondola, type Rect } from './plan'
import { tema } from './tema'

const CERCA = 0.5 // m alrededor del extremo en los que se ofrece la cabecera

/**
 * Cabeceras: solo existen pegadas al extremo de una góndola. Clic en un extremo libre la pone;
 * clic en una cabecera que ya está la quita. Con esta herramienta las góndolas no se cogen.
 */
export class HerramientaCabecera implements Herramienta {
  readonly id = 'cabecera'
  readonly titulo = 'Cabecera'
  readonly atajo = 'C'
  readonly icono = PanelRight
  readonly vista = new Container()
  readonly pintaEncima = false
  readonly sobreGondolas = true
  readonly necesitaContorno = true

  private objetivo: { g: Gondola; extremo: ExtremoGondola; quitar: boolean } | null = null
  private gr = new Graphics()
  private ctx: Contexto

  constructor(ctx: Contexto) {
    this.ctx = ctx
    this.vista.addChild(this.gr)
  }

  get cursorCss() {
    if (!this.objetivo) return 'default'
    return this.objetivo.quitar ? 'pointer' : 'copy'
  }

  pista() {
    if (!editable(this.ctx.plan, 'gondolas')) return 'La capa de mobiliario está oculta o bloqueada'
    return 'Clic en el extremo de una góndola para ponerle cabecera · Clic en una cabecera para quitarla'
  }

  ocupada() {
    return false
  }

  mover(raton: Vec) {
    this.objetivo = null
    const plan = this.ctx.plan
    if (editable(plan, 'gondolas')) {
      let mejor: { g: Gondola; extremo: ExtremoGondola; quitar: boolean; d: number } | null = null
      for (const g of plan.gondolas) {
        if (!editable(plan, 'gondolas', g)) continue
        for (const extremo of ['inicio', 'fin'] as ExtremoGondola[]) {
          const r = rectCabecera(g, extremo)
          const quitar = !!g.cabeceras?.[extremo]
          // Una que ya está se quita pinchándola; un hueco libre se ofrece también un poco alrededor.
          const zona: Rect = quitar ? r : { x: r.x - CERCA, y: r.y - CERCA, w: r.w + 2 * CERCA, h: r.h + 2 * CERCA }
          if (!dentroDe(raton, zona)) continue
          const d = Math.hypot(raton.x - (r.x + r.w / 2), raton.y - (r.y + r.h / 2))
          if (!mejor || d < mejor.d) mejor = { g, extremo, quitar, d }
        }
      }
      this.objetivo = mejor
    }
    this.ctx.cambio()
  }

  pulsar() {
    const o = this.objetivo
    if (!o) {
      this.ctx.seleccionar(null)
      return
    }
    const cab = { ...o.g.cabeceras }
    if (o.quitar) delete cab[o.extremo]
    else cab[o.extremo] = { area: null }
    o.g.cabeceras = cab
    this.objetivo = { ...o, quitar: !o.quitar }
    this.ctx.cambio()
  }

  soltar() {}

  tecla() {
    return false
  }

  salir() {
    this.objetivo = null
  }

  dibujar() {
    const g = this.gr
    g.clear()
    const o = this.objetivo
    if (!o) return
    const r = rectCabecera(o.g, o.extremo)
    const cam = this.ctx.cam
    const p = cam.aPantalla({ x: r.x, y: r.y })
    const w = r.w * cam.zoom
    const h = r.h * cam.zoom
    if (o.quitar) {
      g.roundRect(p.x - 2, p.y - 2, w + 4, h + 4, 3).stroke({ width: 2, color: tema.error })
    } else {
      g.roundRect(p.x, p.y, w, h, Math.min(w, h) * 0.3).fill({ color: tema.gondola, alpha: 0.45 })
      g.roundRect(p.x - 2, p.y - 2, w + 4, h + 4, 3).stroke({ width: 2, color: tema.acento })
    }
  }
}
