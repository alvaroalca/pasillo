import { DoorOpen } from 'lucide'
import { Container, Graphics } from 'pixi.js'
import type { Vec } from './geometria'
import { boton, el, type Contexto, type Herramienta } from './herramienta'
import {
  ANCHO_PUERTA,
  colocarPuerta,
  editable,
  NOMBRE_PUERTA,
  nuevoId,
  TIPOS_PUERTA,
  type Puerta,
  type SitioPuerta,
  type TipoPuerta,
} from './plan'
import { COLOR_PUERTA } from './plano'

const RADIO_MURO = 40 // px: más lejos no se ofrece puerta

/** Pone puertas junto a los muros. */
export class HerramientaPuerta implements Herramienta {
  readonly id = 'puerta'
  readonly titulo = 'Puerta'
  readonly atajo = 'P'
  readonly icono = DoorOpen
  readonly vista = new Container()
  readonly pintaEncima = false
  readonly sobreMuros = true
  readonly necesitaContorno = true

  tipo: TipoPuerta = 'entrada'
  private fantasma: SitioPuerta | null = null
  private g = new Graphics()
  private ctx: Contexto

  constructor(ctx: Contexto) {
    this.ctx = ctx
    this.vista.addChild(this.g)
  }

  get cursorCss() {
    return this.fantasma ? 'copy' : 'default'
  }

  pista() {
    if (!editable(this.ctx.plan, 'puertas')) return 'La capa de puertas está oculta o bloqueada'
    return `Clic junto a un muro para poner una puerta de ${NOMBRE_PUERTA[this.tipo].toLowerCase()}`
  }

  ocupada() {
    return false
  }

  mover(raton: Vec) {
    const c = this.ctx.plan.contorno
    const sitio = c && editable(this.ctx.plan, 'puertas') ? colocarPuerta(this.ctx.plan, raton, ANCHO_PUERTA[this.tipo]) : null
    this.fantasma = sitio && sitio.distancia * this.ctx.cam.zoom <= RADIO_MURO ? sitio : null
    this.ctx.cambio()
  }

  pulsar() {
    if (!this.fantasma) {
      this.ctx.seleccionar(null)
      return
    }
    const p: Puerta = { id: nuevoId(), tipo: this.tipo, centro: this.fantasma.centro, ancho: ANCHO_PUERTA[this.tipo] }
    this.ctx.plan.puertas.push(p)
    this.fantasma = null
    this.ctx.seleccionar({ tipo: 'puerta', obj: p })
  }

  soltar() {}

  tecla() {
    return false
  }

  salir() {
    this.fantasma = null
  }

  dibujar() {
    const g = this.g
    g.clear()
    if (!this.fantasma) return
    const a = this.ctx.cam.aPantalla(this.fantasma.a)
    const b = this.ctx.cam.aPantalla(this.fantasma.b)
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 6, color: COLOR_PUERTA[this.tipo], alpha: 0.55, cap: 'round' })
  }

  propiedades = {
    clave: () => this.tipo,
    construir: (raiz: HTMLElement) => {
      raiz.append(el('p', 'subtitulo', 'Tipo de puerta nueva'), selectorTipo(this.tipo, (t) => {
        this.tipo = t
        this.ctx.cambio()
      }))
    },
    refrescar: () => {},
  }
}

export function selectorTipo(actual: TipoPuerta, alElegir: (t: TipoPuerta) => void) {
  const tipos = el('div', 'opciones tipos-puerta')
  for (const t of TIPOS_PUERTA)
    tipos.append(boton(NOMBRE_PUERTA[t], `opcion opcion-${t}${t === actual ? ' activa' : ''}`, () => alElegir(t)))
  return tipos
}
