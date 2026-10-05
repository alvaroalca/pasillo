/** Azar con semilla (mulberry32): la misma semilla da la misma simulación. */
export class Azar {
  private a: number

  constructor(semilla: number) {
    this.a = semilla | 0
  }

  /** Número entre 0 y 1. */
  siguiente(): number {
    this.a = (this.a + 0x6d2b79f5) | 0
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  entre(min: number, max: number): number {
    return min + (max - min) * this.siguiente()
  }

  /** Normal de media 0 y desviación 1. */
  normal(): number {
    return Math.sqrt(-2 * Math.log(1 - this.siguiente())) * Math.cos(2 * Math.PI * this.siguiente())
  }

  /** Uno de los valores, con probabilidad proporcional a su peso. */
  elegir<T>(pesos: [T, number][]): T {
    const total = pesos.reduce((s, [, p]) => s + p, 0)
    let r = this.siguiente() * total
    for (const [v, p] of pesos) if ((r -= p) <= 0) return v
    return pesos[pesos.length - 1][0]
  }
}

/** Semilla a partir de un texto (la fecha del día), para que cada día tenga la suya. */
export function semillaDe(texto: string): number {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619)
  return h >>> 0
}
