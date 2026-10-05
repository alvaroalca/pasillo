import { Box, Presentation, type IconNode } from 'lucide'
import { Container, Graphics } from 'pixi.js'
import { ajustarARejilla, CELDA, type Vec } from './geometria'
import { etiqueta, formatear, vaciar, type Contexto, type Herramienta, type Mods } from './herramienta'
import { dibujarGuias, imanar, type Guia } from './iman'
import { editable, huellaGondola, MEDIDA_PIEZA, NOMBRE_PIEZA, nuevoId, piezaValida, type Pieza, type TipoPieza } from './plan'
import { dibujarPieza } from './plano'

/** Coloca cubos o expos con un clic, centrados en el ratón e imantados al resto del mueble. */
export class HerramientaPieza implements Herramienta {
  readonly id: 'cubo' | 'expo'
  readonly titulo: string
  readonly atajo: string
  readonly icono: IconNode
  readonly vista = new Container()
  readonly pintaEncima = false
  readonly necesitaContorno = true
  readonly cursorCss = 'copy'

  private fantasma: Pieza | null = null
  private guias: Guia[] = []
  private g = new Graphics()
  private etiquetas = new Container()
  private ctx: Contexto
  private tipo: TipoPieza

  constructor(ctx: Contexto, tipo: TipoPieza) {
    this.ctx = ctx
    this.tipo = tipo
    this.id = tipo
    this.titulo = NOMBRE_PIEZA[tipo]
    this.atajo = tipo === 'cubo' ? 'U' : 'X'
    this.icono = tipo === 'cubo' ? Box : Presentation
    this.vista.addChild(this.g, this.etiquetas)
  }

  pista() {
    if (!editable(this.ctx.plan, 'gondolas')) return 'La capa de mobiliario está oculta o bloqueada'
    const que = this.tipo === 'cubo' ? 'un cubo' : 'una expo'
    return `Clic para poner ${que} · Se imanta al mueble cercano (Ctrl lo evita) · La sección se le da con el pincel`
  }

  ocupada() {
    return false
  }

  mover(raton: Vec, _pantalla: Vec, mods: Mods) {
    if (!editable(this.ctx.plan, 'gondolas')) return
    const m = MEDIDA_PIEZA[this.tipo]
    const esquina = ajustarARejilla({ x: raton.x - m / 2, y: raton.y - m / 2 }, CELDA)
    const p: Pieza = { id: 0, tipo: this.tipo, x: esquina.x, y: esquina.y, w: m, h: m, area: null }
    this.guias = []
    if (!mods.ctrl) {
      const plan = this.ctx.plan
      const iman = imanar(p, [...plan.gondolas.flatMap(huellaGondola), ...plan.piezas], this.ctx.cam.zoom)
      p.x += iman.dx
      p.y += iman.dy
      this.guias = iman.guias
    }
    this.fantasma = p
    this.ctx.cambio()
  }

  pulsar() {
    const f = this.fantasma
    if (!f) return
    const pieza = { ...f, id: nuevoId() }
    this.ctx.plan.piezas.push(pieza)
    this.ctx.seleccionar({ tipo: 'pieza', obj: pieza })
  }

  soltar() {}

  tecla() {
    return false
  }

  salir() {
    this.fantasma = null
    this.guias = []
  }

  dibujar() {
    const g = this.g
    g.clear()
    vaciar(this.etiquetas)
    const f = this.fantasma
    if (!f) return
    const cam = this.ctx.cam
    dibujarPieza(g, cam, this.ctx.plan, f, piezaValida(this.ctx.plan, f), 0.6)
    dibujarGuias(g, cam, this.guias)
    const p = cam.aPantalla({ x: f.x + f.w / 2, y: f.y })
    this.etiquetas.addChild(etiqueta(`${formatear(f.w)} × ${formatear(f.h)} m`, p.x, p.y - 12))
  }
}
