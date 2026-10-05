import { createElement, type IconNode } from 'lucide'
import { Text, type Container } from 'pixi.js'
import type { Camara } from './camara'
import type { Vec } from './geometria'
import type { Gondola, MuroInterior, Pieza, Plan, Puerta } from './plan'
import { tema } from './tema'

/** Algo que se puede seleccionar. */
export type Elemento =
  | { tipo: 'puerta'; obj: Puerta }
  | { tipo: 'gondola'; obj: Gondola }
  | { tipo: 'muro'; obj: MuroInterior }
  | { tipo: 'pieza'; obj: Pieza }
export type Seleccion = Elemento | null

export interface Contexto {
  cam: Camara
  plan: Plan
  /** Algo ha cambiado: repintar. */
  cambio: () => void
  seleccionar: (s: Seleccion) => void
}

export interface Mods {
  alt: boolean
  shift: boolean
  /** Ctrl (o Cmd): sin imán. */
  ctrl: boolean
}

export type IdHerramienta = 'seleccionar' | 'muro' | 'puerta' | 'gondola' | 'cabecera' | 'cubo' | 'expo' | 'pincel' | 'goma'

/**
 * Una herramienta de la barra. Solo decide qué se crea al pulsar en un sitio vacío:
 * lo que ya existe se edita desde cualquier herramienta (ver `edicion.ts`).
 */
export interface Herramienta {
  readonly id: IdHerramienta
  readonly titulo: string
  readonly atajo: string
  readonly icono: IconNode
  readonly vista: Container
  /** Con pincel y goma manda la pintura: al pasar por encima de un objeto no se coge. */
  readonly pintaEncima: boolean
  /** Trabaja sobre los muros (Muro, Puerta): al pasar por encima de un muro no se coge, para poder actuar sobre él. */
  readonly sobreMuros?: boolean
  /** Trabaja sobre las góndolas (Cabecera): al pasar por encima de una góndola no se coge. */
  readonly sobreGondolas?: boolean
  readonly necesitaContorno: boolean
  readonly cursorCss: string
  /** Texto de la barra de estado. */
  pista(): string
  mover(raton: Vec, pantalla: Vec, mods: Mods): void
  pulsar(mods: Mods): void
  soltar(): void
  /** Devuelve true si ha usado la tecla. */
  tecla(e: KeyboardEvent): boolean
  dibujar(): void
  /** Al cambiar de herramienta: soltar estados a medias. */
  salir(): void
  /** Tiene algo a medias (un muro sin terminar): mientras, no se edita nada más. */
  ocupada(): boolean
  /** Devuelve true si ha usado el doble clic. */
  dobleClic?(): boolean
  /** Panel de propiedades cuando no hay nada seleccionado. Sin él, salen los datos de la tienda. */
  propiedades?: {
    /** Cambia cuando hay que reconstruir el panel (no en cada movimiento, o los campos pierden el foco). */
    clave(): string
    construir(raiz: HTMLElement): void
    refrescar(): void
  }
}

export function icono(nodo: IconNode, tam = 18): SVGElement {
  return createElement(nodo, { width: tam, height: tam, 'stroke-width': 2, 'aria-hidden': 'true' })
}

export function formatear(n: number, decimales = 1): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: decimales })
}

/** Texto en pantalla. Con `halo`, un borde del color del suelo para leerse encima de lo que sea. */
export function etiqueta(texto: string, x: number, y: number, color = tema.muro, halo = false): Text {
  const t = new Text({
    text: texto,
    style: {
      fontFamily: tema.fuente,
      fontWeight: '800',
      fontSize: 12,
      fill: color,
      ...(halo && { stroke: { color: tema.suelo, width: 4, join: 'round' as const } }),
    },
    resolution: window.devicePixelRatio,
  })
  t.anchor.set(0.5)
  t.position.set(x, y)
  return t
}

export function vaciar(c: Container) {
  for (const h of c.removeChildren()) h.destroy()
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, clase = '', texto = '') {
  const e = document.createElement(tag)
  if (clase) e.className = clase
  if (texto) e.textContent = texto
  return e
}

export function lista(items: string[]) {
  const ul = el('ul')
  for (const i of items) ul.append(el('li', '', i))
  return ul
}

export function boton(texto: string, clase: string, alPulsar: () => void, nodo?: IconNode) {
  const b = el('button', clase)
  if (nodo) b.append(icono(nodo, 16))
  if (texto) b.append(texto)
  b.type = 'button'
  // Sin foco tras pulsar: si no, la barra espaciadora (mover la vista) lo volvería a pulsar.
  b.addEventListener('click', () => {
    alPulsar()
    b.blur()
  })
  return b
}

/** Campo numérico con su etiqueta; llama a `alCambiar` con cada valor válido. */
export function campoNumero(
  texto: string,
  id: string,
  valor: number,
  paso: number,
  min: number,
  alCambiar: (v: number) => void,
) {
  const fila = el('div', 'campo')
  const label = el('label', '', texto)
  const input = el('input')
  input.type = 'number'
  input.id = id
  input.step = String(paso)
  input.min = String(min)
  input.value = String(valor)
  label.htmlFor = id
  input.addEventListener('input', () => {
    const v = Number(input.value)
    if (v >= min) alCambiar(v)
  })
  fila.append(label, input)
  return { fila, input }
}
