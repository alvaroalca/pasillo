import { BrickWall } from 'lucide'
import { Container, Graphics } from 'pixi.js'
import { ajustarARejilla, ajustarDireccion, distancia, interseccion, proyectar, puntoEnPoligono, type Vec } from './geometria'
import { etiqueta, formatear, vaciar, type Contexto, type Herramienta } from './herramienta'
import { nuevoId, tramos } from './plan'
import { GROSOR_MURO, GROSOR_MURO_INTERIOR } from './plano'
import { tema } from './tema'

const RADIO_ENGANCHE = 12 // px: cerrar el contorno o pegarse a una esquina o pared

/**
 * Sin contorno, dibuja el contorno con clics y se cierra en la primera esquina.
 * Con contorno, dibuja muros interiores: líneas abiertas que se terminan con doble clic, Intro o Esc.
 * Con esta herramienta los muros no se cogen al pasar por encima (`sobreMuros`), para poder empezar o acabar encima de ellos.
 */
export class HerramientaMuro implements Herramienta {
  readonly id = 'muro'
  readonly titulo = 'Muro'
  readonly atajo = 'M'
  readonly icono = BrickWall
  readonly vista = new Container()
  readonly pintaEncima = false
  readonly sobreMuros = true
  readonly necesitaContorno = false
  readonly cursorCss = 'crosshair'

  /** Esquinas ya puestas del muro (o del contorno) que se está dibujando. */
  private puntos: Vec[] = []
  private cursor: Vec | null = null
  private cerrando = false
  /** El cursor se ha pegado a una esquina o pared existente. */
  private enganchado = false

  private g = new Graphics()
  private etiquetas = new Container()
  private ctx: Contexto

  constructor(ctx: Contexto) {
    this.ctx = ctx
    this.vista.addChild(this.g, this.etiquetas)
  }

  private get interior() {
    return this.ctx.plan.contorno !== null
  }

  pista() {
    if (!this.interior) return 'Clic para poner cada esquina · Pincha en la primera para cerrar · Ctrl+Z borra la última'
    if (this.puntos.length === 0) return 'Clic para empezar un muro interior · Para mover muros, usa Seleccionar (V)'
    return 'Clic para cada esquina · Doble clic, Intro o Esc para terminar · Ctrl+Z borra la última'
  }

  ocupada() {
    return this.puntos.length > 0
  }

  mover(raton: Vec, pantalla: Vec) {
    const cam = this.ctx.cam
    const paso = cam.pasoAjuste()
    const ultimo = this.puntos[this.puntos.length - 1]
    let cursor = ultimo ? ajustarDireccion(ultimo, raton, paso) : ajustarARejilla(raton, paso)
    this.enganchado = false

    if (!this.interior) {
      const primero = this.puntos[0]
      this.cerrando = this.puntos.length >= 3 && distancia(cam.aPantalla(primero), pantalla) <= RADIO_ENGANCHE
      if (this.cerrando) cursor = primero
    } else {
      const enganche = this.enganchar(raton, pantalla, cursor, ultimo)
      if (enganche) {
        cursor = enganche
        this.enganchado = true
      }
    }
    this.cursor = cursor
    this.ctx.cambio()
  }

  /**
   * Pegar el punto a una esquina cercana o, si no, a la pared más cercana. Con un tramo empezado,
   * se busca dónde corta su dirección a esa pared, para no romper el ángulo de 90° o 45°.
   */
  private enganchar(raton: Vec, pantalla: Vec, cursor: Vec, ultimo: Vec | undefined): Vec | null {
    const cam = this.ctx.cam
    const lista = tramos(this.ctx.plan)
    for (const t of lista) for (const v of [t.a, t.b]) if (distancia(cam.aPantalla(v), pantalla) <= RADIO_ENGANCHE) return v
    let mejor: { punto: Vec; d: number } | null = null
    for (const t of lista) {
      const proy = proyectar(raton, t.a, t.b)
      const d = proy.distancia * cam.zoom
      if (d > RADIO_ENGANCHE || (mejor && d >= mejor.d)) continue
      let punto: Vec | null = proyectar(cursor, t.a, t.b).punto
      if (ultimo && distancia(ultimo, cursor) > 0) {
        const corte = interseccion(ultimo, cursor, t.a, t.b)
        punto = corte && proyectar(corte, t.a, t.b).distancia < 1e-6 ? corte : null
      }
      if (punto) mejor = { punto, d }
    }
    return mejor?.punto ?? null
  }

  pulsar() {
    const plan = this.ctx.plan
    if (this.puntos.length === 0) this.ctx.seleccionar(null)
    if (!this.interior && this.cerrando) {
      plan.contorno = this.puntos
      this.salir()
    } else if (this.cursor) {
      const ultimo = this.puntos[this.puntos.length - 1]
      if (!ultimo || distancia(ultimo, this.cursor) > 0) this.puntos.push(this.cursor)
    }
    this.ctx.cambio()
  }

  soltar() {}

  /** Termina el muro interior que se está dibujando. Con menos de dos esquinas, no queda nada. */
  private terminar() {
    if (this.interior && this.puntos.length >= 2) {
      const muro = { id: nuevoId(), puntos: this.puntos }
      this.ctx.plan.muros.push(muro)
      this.ctx.seleccionar({ tipo: 'muro', obj: muro })
    }
    this.puntos = []
    this.ctx.cambio()
  }

  dobleClic(): boolean {
    if (!this.interior || !this.ocupada()) return false
    this.terminar()
    return true
  }

  tecla(e: KeyboardEvent): boolean {
    if (!this.ocupada()) return false
    const deshacer = e.code === 'Backspace' || (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && !e.shiftKey)
    if (deshacer) {
      this.puntos.pop()
      this.ctx.cambio()
      return true
    }
    if (this.interior && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape')) {
      this.terminar()
      return true
    }
    return false
  }

  salir() {
    this.puntos = []
    this.cursor = null
    this.cerrando = false
    this.enganchado = false
  }

  dibujar() {
    const g = this.g
    const cam = this.ctx.cam
    g.clear()
    vaciar(this.etiquetas)

    if (this.interior) {
      this.dibujarInterior()
      return
    }

    const forma = this.cursor && !this.cerrando ? [...this.puntos, this.cursor] : this.puntos
    if (forma.length === 0) return
    const s = forma.map((v) => cam.aPantalla(v))

    if (this.cerrando && s.length >= 3) {
      g.poly(s.flatMap((v) => [v.x, v.y]), true)
        .fill({ color: tema.suelo })
        .stroke({ width: GROSOR_MURO, color: tema.muro, join: 'round' })
    } else if (s.length >= 2) {
      if (s.length >= 3) g.poly(s.flatMap((v) => [v.x, v.y]), true).fill({ color: tema.suelo, alpha: 0.6 })
      g.moveTo(s[0].x, s[0].y)
      for (const v of s.slice(1)) g.lineTo(v.x, v.y)
      g.stroke({ width: GROSOR_MURO, color: tema.muro, join: 'round', cap: 'round' })
    }
    for (let i = 0; i < s.length; i++) {
      const activa = i === 0 && this.cerrando
      g.circle(s[i].x, s[i].y, activa ? 7 : 4.5)
        .fill({ color: activa ? tema.acento : tema.blanco })
        .stroke({ width: 2, color: activa ? tema.acento : tema.muro })
    }
    const lados = this.cerrando ? forma.length : forma.length - 1
    for (let i = 0; i < lados; i++) this.etiquetarLado(forma[i], forma[(i + 1) % forma.length], s)
  }

  private dibujarInterior() {
    const g = this.g
    const cam = this.ctx.cam
    const c = this.ctx.plan.contorno!

    // Con la herramienta en la mano, las medidas del contorno siguen a la vista.
    const sc = c.map((v) => cam.aPantalla(v))
    for (let i = 0; i < c.length; i++) this.etiquetarLado(c[i], c[(i + 1) % c.length], sc)

    const forma = this.cursor ? [...this.puntos, this.cursor] : this.puntos
    if (forma.length === 0) return
    const s = forma.map((v) => cam.aPantalla(v))
    if (s.length >= 2) {
      g.moveTo(s[0].x, s[0].y)
      for (const v of s.slice(1)) g.lineTo(v.x, v.y)
      g.stroke({ width: GROSOR_MURO_INTERIOR, color: tema.muro, alpha: 0.75, join: 'round', cap: 'round' })
      for (let i = 0; i < forma.length - 1; i++) this.etiquetarLado(forma[i], forma[i + 1], [])
    }
    for (let i = 0; i < s.length; i++) {
      const esCursor = i === s.length - 1 && this.cursor !== null
      const activa = esCursor && this.enganchado
      g.circle(s[i].x, s[i].y, activa ? 6.5 : 4)
        .fill({ color: activa ? tema.acento : tema.blanco })
        .stroke({ width: 2, color: activa ? tema.acento : tema.muro })
    }
  }

  private etiquetarLado(a: Vec, b: Vec, forma: Vec[]) {
    const cam = this.ctx.cam
    const sa = cam.aPantalla(a)
    const sb = cam.aPantalla(b)
    const largo = distancia(sa, sb)
    if (largo < 48) return
    // Hacia fuera de la tienda para no pisar el muro ni el suelo.
    let nx = -(sb.y - sa.y) / largo
    let ny = (sb.x - sa.x) / largo
    const mx = (sa.x + sb.x) / 2
    const my = (sa.y + sb.y) / 2
    if (forma.length >= 3 && puntoEnPoligono({ x: mx + nx * 14, y: my + ny * 14 }, forma)) {
      nx = -nx
      ny = -ny
    }
    this.etiquetas.addChild(etiqueta(`${formatear(distancia(a, b))} m`, mx + nx * 14, my + ny * 14))
  }
}
