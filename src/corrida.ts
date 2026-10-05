import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Camara } from './camara'
import type { Plan } from './plan'
import type { Dia, Historico } from './sim/historico'
import { Navegacion } from './sim/navegacion'
import { Simulacion, type Ajustes, type Cliente } from './sim/simulacion'
import { tema } from './tema'

const RADIO = 0.32 // m: una persona vista desde arriba, algo exagerada para que se vea
const RADIO_MIN_PX = 3 // de lejos, que no desaparezcan

/** Calor: de coral claro casi transparente (poco) a rojo intenso (mucho). Un solo tono, que no se confunde con las secciones. */
const CALOR_BAJO = [0xf4, 0x9a, 0x96]
const CALOR_ALTO = [0xc4, 0x26, 0x30]

/** Difuminado por cajas (separable), en el sitio: dos pasadas se parecen a un difuminado gaussiano. */
function difuminar(v: Float32Array, ancho: number, alto: number, radio: number) {
  const tmp = new Float32Array(v.length)
  const n = 2 * radio + 1
  for (let y = 0; y < alto; y++)
    for (let x = 0; x < ancho; x++) {
      let s = 0
      for (let d = -radio; d <= radio; d++) {
        const xx = x + d
        if (xx >= 0 && xx < ancho) s += v[xx + y * ancho]
      }
      tmp[x + y * ancho] = s / n
    }
  for (let y = 0; y < alto; y++)
    for (let x = 0; x < ancho; x++) {
      let s = 0
      for (let d = -radio; d <= radio; d++) {
        const yy = y + d
        if (yy >= 0 && yy < alto) s += tmp[x + yy * ancho]
      }
      v[x + y * ancho] = s / n
    }
}

/**
 * Una tienda simulando: su navegación, su simulación y la capa que pinta clientes, personal, cajas y calor.
 * En la comparación hay dos (versión A y tienda actual) con el mismo día, ajustes y reloj.
 */
export class Corrida {
  readonly vista = new Container()
  readonly plan: Plan
  nav: Navegacion | null = null
  sim: Simulacion | null = null
  private g = new Graphics()
  /** Con qué cajas se construyó la navegación: si cambian, hay que rehacerla. */
  private cajasNav = ''
  /** El mapa de calor se pinta en un lienzo de una celda por píxel y se escala suavizado. */
  private lienzoCalor = document.createElement('canvas')
  private texturaCalor: Texture | null = null
  private spriteCalor = new Sprite()

  constructor(plan: Plan) {
    this.plan = plan
    this.vista.addChild(this.spriteCalor, this.g)
  }

  /** Rehace la navegación si la tienda ha cambiado o las cajas no son las mismas (sus mostradores no se pisan). */
  preparar(ajustes: Ajustes, forzar = false) {
    const clave = `${ajustes.cajas}|${ajustes.autopagos}`
    if (!forzar && clave === this.cajasNav && this.nav) return
    this.nav = new Navegacion(this.plan, { cajas: ajustes.cajas, autopagos: ajustes.autopagos })
    this.cajasNav = clave
  }

  /** Empieza el día y lo adelanta, sin pintar, hasta la hora de inicio. */
  reiniciar(historico: Historico, dia: Dia, ajustes: Ajustes, desdeHora: number) {
    this.preparar(ajustes)
    this.sim = new Simulacion(this.plan, this.nav!, historico, dia, ajustes)
    const adelanto = desdeHora * 3600 - this.sim.tiempo
    if (adelanto > 0) this.sim.avanzar(adelanto)
  }

  limpiar() {
    this.sim = null
    this.g.clear()
    this.spriteCalor.visible = false
  }

  /** Pinta clientes, personal, cajas y (si toca) el calor. La vista va en metros y sigue a la cámara. */
  dibujar(cam: Camara, calor: boolean) {
    this.vista.position.set(cam.x, cam.y)
    this.vista.scale.set(cam.zoom)
    const g = this.g
    g.clear()
    const sim = this.sim
    const nav = this.nav
    this.spriteCalor.visible = calor && !!sim
    if (!sim || !nav) return
    const radio = Math.max(RADIO, RADIO_MIN_PX / cam.zoom)
    const celda = 0.5
    if (calor) this.dibujarCalor(sim, nav)
    // Mostradores y terminales de autopago, y los cajeros detrás de sus cajas.
    for (const p of nav.puestos) {
      for (const k of p.mueble) {
        const c = nav.centro(k)
        g.roundRect(c.x - celda / 2 + 0.05, c.y - celda / 2 + 0.05, celda - 0.1, celda - 0.1, 0.08).fill({ color: tema.gondola })
        if (p.tipo === 'autopago') g.rect(c.x - 0.12, c.y - 0.12, 0.24, 0.24).fill({ color: tema.acento })
      }
      if (p.cajero !== null) {
        const c = nav.centro(p.cajero)
        g.circle(c.x, c.y, radio).fill({ color: tema.trabajador })
      }
    }
    const color = (c: Cliente) => (!c.compra ? tema.clienteMirando : c.fase === 'pagando' ? tema.clientePagando : tema.cliente)
    for (const c of sim.clientes) {
      if (c.fase === 'ido') continue
      const p = sim.posicion(c)
      g.circle(p.x, p.y, radio).fill({ color: color(c) })
    }
    for (const t of sim.personal) {
      const p = sim.posicion(t)
      g.circle(p.x, p.y, radio).fill({ color: tema.trabajador })
    }
  }

  /**
   * Mapa de calor: tiempo parado sin poder avanzar o esperando en fila en cada celda. Se difumina y se pinta
   * en un lienzo de una celda por píxel que se escala suavizado: salen manchas, no cuadros.
   * Las paradas para coger un producto no cuentan: si no, ardería cualquier estantería.
   */
  private dibujarCalor(sim: Simulacion, nav: Navegacion) {
    const { ancho, alto } = nav
    const v = Float32Array.from(sim.atascos)
    difuminar(v, ancho, alto, 2)
    difuminar(v, ancho, alto, 2)
    // Escala con el percentil 95 de lo que tiene algo: un solo punto muy caliente no apaga el resto.
    const valores = [...v].filter((x) => x > 0).sort((a, b) => a - b)
    const tope = valores.length ? valores[Math.floor(valores.length * 0.95)] || valores[valores.length - 1] : 1

    const lienzo = this.lienzoCalor
    if (lienzo.width !== ancho || lienzo.height !== alto) {
      lienzo.width = ancho
      lienzo.height = alto
      this.texturaCalor?.destroy(true)
      this.texturaCalor = null
    }
    const ctx = lienzo.getContext('2d')!
    const img = ctx.createImageData(ancho, alto)
    for (let k = 0; k < v.length; k++) {
      const t = Math.min(1, v[k] / tope)
      if (t < 0.02) continue
      // Suave al principio, para que lo poco apenas se vea y lo mucho destaque.
      const a = t * t * (3 - 2 * t)
      img.data[4 * k] = CALOR_BAJO[0] + (CALOR_ALTO[0] - CALOR_BAJO[0]) * a
      img.data[4 * k + 1] = CALOR_BAJO[1] + (CALOR_ALTO[1] - CALOR_BAJO[1]) * a
      img.data[4 * k + 2] = CALOR_BAJO[2] + (CALOR_ALTO[2] - CALOR_BAJO[2]) * a
      img.data[4 * k + 3] = Math.round(255 * 0.78 * a)
    }
    ctx.putImageData(img, 0, 0)
    if (!this.texturaCalor) {
      this.texturaCalor = Texture.from(lienzo)
      this.texturaCalor.source.scaleMode = 'linear'
      this.spriteCalor.texture = this.texturaCalor
    } else this.texturaCalor.source.update()
    // Cada píxel es una celda de 50 cm, empezando en la primera celda de la rejilla.
    this.spriteCalor.position.set(nav.i0 * 0.5, nav.j0 * 0.5)
    this.spriteCalor.scale.set(0.5)
  }
}
