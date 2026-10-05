/**
 * El histórico de ventas de la tienda: tickets con su hora de pago y sus líneas, y el contador de la puerta.
 * Hoy se lee de `public/historico.json` (inventado con `scripts/generar-historico.ts`); la simulación
 * solo conoce esta interfaz, así que mañana podría venir de una base de datos.
 */

/** [sección (índice en `secciones`), unidades, céntimos] */
export type Linea = [number, number, number]
/** [minuto del día en que se pagó, líneas] */
export type Ticket = [number, Linea[]]

export interface Dia {
  fecha: string
  /** Personas que entraron cada hora, desde la apertura. */
  frecuentacion: number[]
  tickets: Ticket[]
}

export interface Historico {
  secciones: string[]
  /** Hora de apertura y de cierre, en minutos del día. */
  apertura: number
  cierre: number
  dias: Dia[]
}

const aMinutos = (hora: string) => {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

export async function cargarHistorico(url = 'historico.json'): Promise<Historico | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return leerHistorico(await r.text())
  } catch {
    return null
  }
}

export function leerHistorico(texto: string): Historico {
  const h = JSON.parse(texto)
  if (h?.formato !== 'planta-historico') throw new Error('El archivo no es un histórico de Pasillo.')
  return { secciones: h.secciones, apertura: aMinutos(h.apertura), cierre: aMinutos(h.cierre), dias: h.dias }
}

export function eurosDia(d: Dia): number {
  return d.tickets.reduce((t, [, ls]) => t + ls.reduce((s, l) => s + l[2], 0), 0) / 100
}
