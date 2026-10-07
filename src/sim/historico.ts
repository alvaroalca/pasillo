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

let cargado: Promise<Historico | null> | null = null

/** Se lee una vez: lo piden el editor (los nombres de sección) y la simulación. */
export function cargarHistorico(): Promise<Historico | null> {
  cargado ??= fetch('historico.json')
    .then(async (r) => (r.ok ? leerHistorico(await r.text()) : null))
    .catch(() => null)
    .then((h) => {
      if (!h) cargado = null // se reintenta la próxima vez
      return h
    })
  return cargado
}

export function leerHistorico(texto: string): Historico {
  const h = JSON.parse(texto)
  if (h?.formato !== 'planta-historico') throw new Error('El archivo no es un histórico de Pasillo.')
  return { secciones: h.secciones, apertura: aMinutos(h.apertura), cierre: aMinutos(h.cierre), dias: h.dias }
}

/** Las secciones del histórico, de la que más factura a la que menos: las únicas que tienen clientes. */
export function seccionesPorVentas(h: Historico): string[] {
  const ventas = h.secciones.map(() => 0)
  for (const d of h.dias) for (const [, ls] of d.tickets) for (const [s, , c] of ls) ventas[s] += c
  return h.secciones.map((nombre, s) => ({ nombre, v: ventas[s] })).sort((a, b) => b.v - a.v).map((x) => x.nombre)
}

export function eurosDia(d: Dia): number {
  return d.tickets.reduce((t, [, ls]) => t + ls.reduce((s, l) => s + l[2], 0), 0) / 100
}
