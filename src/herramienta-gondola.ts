import { Rows3 } from 'lucide'
import { Container, Graphics } from 'pixi.js'
import { ajustarARejilla, CELDA, type Vec } from './geometria'
import { etiqueta, formatear, vaciar, type Contexto, type Herramienta, type Mods } from './herramienta'
import { dibujarGuias, imanar, type Guia } from './iman'
import { editable, FONDO_GONDOLA, gondolaValida, huellaGondola, LARGO_MIN_GONDOLA, nuevoId, rectGondola, type Gondola } from './plan'
import { dibujarGondola } from './plano'

/** Crea góndolas arrastrando sobre el suelo, siempre en la rejilla de 50 cm. */
export class HerramientaGondola implements Herramienta {
  readonly id = 'gondola'
  readonly titulo = 'Góndola'
  readonly atajo = 'G'
  readonly icono = Rows3
  readonly vista = new Container()
  readonly pintaEncima = false
  readonly necesitaContorno = true
  readonly cursorCss = 'crosshair'

  private raton: Vec = { x: 0, y: 0 }
  private creando: { origen: Vec; nueva: Gondola; arrastrada: boolean } | null = null
  private guias: Guia[] = []
  private g = new Graphics()
  private etiquetas = new Container()
  private ctx: Contexto

  constructor(ctx: Contexto) {
    this.ctx = ctx
    this.vista.addChild(this.g, this.etiquetas)
  }

  pista() {
    if (!editable(this.ctx.plan, 'gondolas')) return 'La capa de góndolas está oculta o bloqueada'
    return 'Arrastra sobre el suelo para crear una góndola · Se imanta a sus vecinas (Ctrl lo evita)'
  }

  ocupada() {
    return false
  }

  mover(raton: Vec, _pantalla: Vec, mods: Mods) {
    this.raton = raton
    const a = this.creando
    if (!a) return
    const dx = raton.x - a.origen.x
    const dy = raton.y - a.origen.y
    const horizontal = Math.abs(dx) >= Math.abs(dy)
    const d = horizontal ? dx : dy
    const largo = Math.max(LARGO_MIN_GONDOLA, Math.round(Math.abs(d) / CELDA) * CELDA)
    const inicio = (horizontal ? a.origen.x : a.origen.y) - (d < 0 ? largo : 0)
    a.arrastrada ||= Math.abs(d) >= CELDA
    Object.assign(
      a.nueva,
      horizontal
        ? { horizontal, largo, x: inicio, y: a.origen.y - FONDO_GONDOLA / 2 }
        : { horizontal, largo, x: a.origen.x - FONDO_GONDOLA / 2, y: inicio },
    )
    // Imán: si se empieza un poco desplazada respecto a otra, se alinea sola.
    this.guias = []
    if (!mods.ctrl && a.arrastrada) {
      const plan = this.ctx.plan
      const iman = imanar(rectGondola(a.nueva), [...plan.gondolas.flatMap(huellaGondola), ...plan.piezas], this.ctx.cam.zoom)
      a.nueva.x += iman.dx
      a.nueva.y += iman.dy
      this.guias = iman.guias
    }
    this.ctx.cambio()
  }

  pulsar() {
    this.ctx.seleccionar(null)
    if (!editable(this.ctx.plan, 'gondolas')) return
    const origen = ajustarARejilla(this.raton, CELDA)
    const nueva: Gondola = { id: nuevoId(), x: origen.x, y: origen.y - FONDO_GONDOLA / 2, largo: LARGO_MIN_GONDOLA, horizontal: true }
    this.creando = { origen, nueva, arrastrada: false }
  }

  soltar() {
    const a = this.creando
    this.creando = null
    this.guias = []
    // Un clic suelto solo quita la selección; para crear hay que arrastrar.
    if (a?.arrastrada) {
      this.ctx.plan.gondolas.push(a.nueva)
      this.ctx.seleccionar({ tipo: 'gondola', obj: a.nueva })
    }
    this.ctx.cambio()
  }

  tecla() {
    return false
  }

  salir() {
    this.creando = null
    this.guias = []
  }

  dibujar() {
    const g = this.g
    g.clear()
    vaciar(this.etiquetas)
    const a = this.creando
    if (!a?.arrastrada) return
    const cam = this.ctx.cam
    dibujarGondola(g, cam, this.ctx.plan, a.nueva, gondolaValida(this.ctx.plan, a.nueva), 0.75)
    dibujarGuias(g, cam, this.guias)
    this.etiquetas.addChild(etiquetaLargo(cam, a.nueva))
  }
}

export function etiquetaLargo(cam: Contexto['cam'], gd: Gondola) {
  const r = rectGondola(gd)
  const c = cam.aPantalla({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
  const fuera = (FONDO_GONDOLA / 2) * cam.zoom + 14
  const [x, y] = gd.horizontal ? [c.x, c.y - fuera] : [c.x + fuera + 6, c.y]
  return etiqueta(`${formatear(gd.largo)} m`, x, y)
}
