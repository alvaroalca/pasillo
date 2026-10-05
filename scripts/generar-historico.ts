// Genera un histórico de ventas inventado pero creíble para la tienda demo: public/historico.json.
// Ticket a ticket (hora de pago y líneas por sección) más el contador de la puerta por hora.
// Uso: node scripts/generar-historico.ts   (Node 24 ejecuta TypeScript directamente)
//
// Cifras de partida (Álvaro, Decathlon de costa de 2.000 m²): 8 M€ al año, unos 4 M€ en verano
// y 1-2 M€ en la campaña de Navidad. Ticket medio ~38 €. Entra ~1 de cada 3 que compra.
import { writeFileSync } from 'node:fs'

// Azar con semilla: el mismo histórico cada vez.
function mulberry32(semilla: number) {
  let a = semilla
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const azar = mulberry32(20251005)
const normal = () => Math.sqrt(-2 * Math.log(1 - azar())) * Math.cos(2 * Math.PI * azar())
const elegir = <T>(pesos: [T, number][]): T => {
  const total = pesos.reduce((s, [, p]) => s + p, 0)
  let r = azar() * total
  for (const [v, p] of pesos) if ((r -= p) <= 0) return v
  return pesos[pesos.length - 1][0]
}

const SECCIONES = ['Fitness', 'Montaña', 'Deportes colectivos', 'Agua', 'Ciclismo', 'Running', 'Raqueta', 'Naturaleza']
// Peso en facturación anual, en el orden que dio Álvaro.
const CUOTA = [0.19, 0.17, 0.15, 0.13, 0.11, 0.1, 0.09, 0.06]
// Precio medio por unidad (€): fija cuántas unidades hacen falta para cada euro.
const PRECIO = [11, 18, 13, 10, 25, 16, 12, 14]
// Cuánto sube o baja cada sección según la época.
const ESTACION: Record<string, number[]> = {
  verano: [0.8, 0.8, 1, 2.2, 1.1, 1, 1, 1.1],
  enero: [1.4, 1.3, 1, 0.3, 0.8, 1.1, 0.9, 0.8],
}
// Facturación media diaria de la época, y peso de cada día de la semana (lunes a domingo, media 1).
const EUROS_DIA: Record<string, number> = { verano: 43500, enero: 10600 * 1.2 } // enero con rebajas
const DIA_SEMANA = [0.85, 0.85, 0.9, 0.95, 1.15, 1.6, 0.7]
// Reparto de las ventas por hora, de 10:00 a 21:00 (abre de 10 a 22).
const HORAS: Record<string, number[]> = {
  verano: [0.05, 0.07, 0.09, 0.1, 0.07, 0.05, 0.06, 0.09, 0.11, 0.12, 0.11, 0.08], // costa: mediodía y tarde-noche
  enero: [0.06, 0.08, 0.1, 0.1, 0.07, 0.06, 0.08, 0.11, 0.12, 0.11, 0.07, 0.04],
}
// Agua en verano: pico a mediodía (antes y después de la playa) y menos por la noche.
const AGUA_HORA_VERANO = [0.9, 1, 1.2, 1.3, 1.3, 1.1, 1, 0.9, 0.9, 0.8, 0.8, 0.8]
const SECCIONES_POR_TICKET: [number, number][] = [[1, 0.62], [2, 0.28], [3, 0.1]]
const UNIDADES: [number, number][] = [[1, 0.45], [2, 0.3], [3, 0.15], [4, 0.1]]
const ENTRAN_POR_COMPRA = 3

type Linea = [number, number, number] // [sección, unidades, céntimos]
type Ticket = [number, Linea[]] // [minuto del día del pago, líneas]

function generarDia(fecha: Date, epoca: 'verano' | 'enero') {
  const dow = (fecha.getUTCDay() + 6) % 7 // 0 = lunes
  const objetivo = EUROS_DIA[epoca] * DIA_SEMANA[dow] * (1 + 0.08 * normal())
  const tickets: Ticket[] = []
  const frecuentacion: number[] = []

  HORAS[epoca].forEach((parte, h) => {
    const meta = objetivo * parte
    // Probabilidad de que una línea sea de cada sección: cuota de facturación ÷ precio (más unidades donde es barato).
    const pesos = SECCIONES.map((_, s) => {
      let p = CUOTA[s] * ESTACION[epoca][s]
      if (epoca === 'verano' && SECCIONES[s] === 'Agua') p *= AGUA_HORA_VERANO[h]
      return [s, p / PRECIO[s]] as [number, number]
    })
    let euros = 0
    let n = 0
    while (euros < meta) {
      const cuantas = elegir(SECCIONES_POR_TICKET)
      const usadas = new Set<number>()
      const lineas: Linea[] = []
      while (lineas.length < cuantas) {
        const s = elegir(pesos.filter(([x]) => !usadas.has(x)))
        usadas.add(s)
        const u = elegir(UNIDADES)
        const precio = PRECIO[s] * Math.exp(0.35 * normal())
        lineas.push([s, u, Math.round(u * precio * 100)])
      }
      const minuto = (10 + h) * 60 + Math.floor(azar() * 60)
      tickets.push([minuto, lineas])
      euros += lineas.reduce((t, l) => t + l[2], 0) / 100
      n++
    }
    frecuentacion.push(Math.round(n * ENTRAN_POR_COMPRA * (1 + 0.12 * normal())))
  })
  tickets.sort((a, b) => a[0] - b[0])
  return { fecha: fecha.toISOString().slice(0, 10), frecuentacion, tickets }
}

const dias = []
const periodos: [string, string, 'verano' | 'enero'][] = [
  ['2025-07-28', '2025-08-10', 'verano'],
  ['2026-01-12', '2026-01-25', 'enero'],
]
for (const [desde, hasta, epoca] of periodos)
  for (let d = new Date(desde + 'T00:00:00Z'); d <= new Date(hasta + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1))
    dias.push(generarDia(new Date(d), epoca))

const historico = { formato: 'planta-historico', version: 1, apertura: '10:00', cierre: '22:00', secciones: SECCIONES, dias }
writeFileSync(new URL('../public/historico.json', import.meta.url), JSON.stringify(historico))

// Resumen para comprobar que las cifras cuadran.
for (const d of dias) {
  const euros = d.tickets.reduce((t, [, ls]) => t + ls.reduce((s, l) => s + l[2], 0), 0) / 100
  const agua = d.tickets.reduce((t, [, ls]) => t + ls.filter((l) => l[0] === 3).reduce((s, l) => s + l[2], 0), 0) / 100
  const entran = d.frecuentacion.reduce((a, b) => a + b, 0)
  console.log(
    d.fecha,
    `${Math.round(euros).toLocaleString('es-ES')} €`.padStart(10),
    `${d.tickets.length} tickets`.padStart(13),
    `medio ${(euros / d.tickets.length).toFixed(1)} €`,
    `· entran ${entran}`,
    `· Agua ${Math.round(agua).toLocaleString('es-ES')} €`,
  )
}
