import { serializar } from './archivo'
import type { Plan } from './plan'

const MAXIMO = 100

/**
 * Deshacer y rehacer con fotos de la tienda entera (el mismo JSON del archivo).
 * Una tienda grande ocupa decenas de KB, así que cien fotos caben de sobra.
 */
export class Historial {
  private atras: string[] = []
  private adelante: string[] = []
  private actual: string

  constructor(plan: Plan) {
    this.actual = serializar(plan)
  }

  /** Si la tienda ha cambiado desde la última foto, guarda la anterior como paso atrás. */
  confirmar(plan: Plan) {
    const ahora = serializar(plan)
    if (ahora === this.actual) return
    this.atras.push(this.actual)
    if (this.atras.length > MAXIMO) this.atras.shift()
    this.actual = ahora
    this.adelante = []
  }

  /** Devuelve la foto a la que volver, o null si no hay. */
  deshacer(): string | null {
    const previa = this.atras.pop()
    if (previa === undefined) return null
    this.adelante.push(this.actual)
    this.actual = previa
    return previa
  }

  rehacer(): string | null {
    const siguiente = this.adelante.pop()
    if (siguiente === undefined) return null
    this.atras.push(this.actual)
    this.actual = siguiente
    return siguiente
  }

  get puedeDeshacer() {
    return this.atras.length > 0
  }

  get puedeRehacer() {
    return this.adelante.length > 0
  }
}
