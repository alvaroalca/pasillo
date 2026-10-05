import type { Vec } from './geometria'
import {
  carasDe,
  celdaDelante,
  claveCelda,
  nuevoId,
  planVacio,
  reservarIds,
  type Area,
  type Gondola,
  type Plan,
  type TipoArea,
  type TipoPieza,
  type TipoPuerta,
  type Tramos,
} from './plan'

const FORMATO = 'planta'
/** 1: secciones pintadas en el suelo. 2: secciones pintadas en el mueble (góndolas, cabeceras, cubos, expos). */
const VERSION = 2
const CLAVE_LOCAL = 'planta:tienda'

/** Lo que va al archivo. Puertas y góndolas pierden su id (se regenera); las áreas lo conservan porque la pintura lo usa. */
interface Guardado {
  formato: typeof FORMATO
  version: number
  capas?: Plan['capas']
  contorno: [number, number][] | null
  muros?: { puntos: [number, number][]; bloqueada?: boolean }[]
  puertas: { tipo: TipoPuerta; x: number; y: number; ancho: number; bloqueada?: boolean }[]
  gondolas: {
    x: number
    y: number
    largo: number
    horizontal: boolean
    bloqueada?: boolean
    caras?: [Tramos, Tramos]
    cabeceras?: Gondola['cabeceras']
  }[]
  piezas?: { tipo: TipoPieza; x: number; y: number; w: number; h: number; area: number | null; bloqueada?: boolean }[]
  areas: { id: number; tipo: TipoArea; nombre: string; color: string }[]
  /** Pintura por tramos de fila: [j, i inicial, celdas seguidas, id de área]. */
  celdas: [number, number, number, number][]
}

export function serializar(plan: Plan): string {
  const g: Guardado = {
    formato: FORMATO,
    version: VERSION,
    capas: plan.capas,
    contorno: plan.contorno?.map((v) => [v.x, v.y]) ?? null,
    muros: plan.muros.map((m) => ({ puntos: m.puntos.map((v) => [v.x, v.y]), ...(m.bloqueada && { bloqueada: true }) })),
    puertas: plan.puertas.map((p) => ({
      tipo: p.tipo,
      x: p.centro.x,
      y: p.centro.y,
      ancho: p.ancho,
      ...(p.bloqueada && { bloqueada: true }),
    })),
    gondolas: plan.gondolas.map((g) => {
      const caras = carasDe(g)
      const pintada = caras.some((c) => c.some((a) => a !== null))
      return {
        x: g.x,
        y: g.y,
        largo: g.largo,
        horizontal: g.horizontal,
        ...(g.bloqueada && { bloqueada: true }),
        ...(pintada && { caras }),
        ...(g.cabeceras && Object.keys(g.cabeceras).length > 0 && { cabeceras: g.cabeceras }),
      }
    }),
    piezas: plan.piezas.map(({ tipo, x, y, w, h, area, bloqueada }) => ({
      tipo,
      x,
      y,
      w,
      h,
      area,
      ...(bloqueada && { bloqueada: true }),
    })),
    areas: plan.areas.map((a) => ({ ...a, color: `#${a.color.toString(16).padStart(6, '0')}` })),
    celdas: tramos(plan.celdas),
  }
  return JSON.stringify(g)
}

function tramos(celdas: Map<string, number>): [number, number, number, number][] {
  const ordenadas = [...celdas].map(([k, area]) => {
    const [i, j] = k.split(',').map(Number)
    return { i, j, area }
  })
  ordenadas.sort((a, b) => a.j - b.j || a.i - b.i)
  const salida: [number, number, number, number][] = []
  for (const c of ordenadas) {
    const ultimo = salida[salida.length - 1]
    if (ultimo && ultimo[0] === c.j && ultimo[3] === c.area && ultimo[1] + ultimo[2] === c.i) ultimo[2]++
    else salida.push([c.j, c.i, 1, c.area])
  }
  return salida
}

/** Lanza un Error con un mensaje legible si el archivo no es una tienda de Planta. */
export function deserializar(texto: string): Plan {
  let g: Guardado
  try {
    g = JSON.parse(texto)
  } catch {
    throw new Error('El archivo no es un JSON válido.')
  }
  if (g?.formato !== FORMATO) throw new Error('El archivo no es una tienda de Planta.')
  if (g.version > VERSION) throw new Error('El archivo es de una versión más nueva de Planta.')

  const plan = planVacio()
  // Los archivos de antes de las capas no las traen: se quedan las de por defecto.
  if (g.capas) plan.capas = { ...plan.capas, ...g.capas }
  plan.contorno = g.contorno?.map(([x, y]): Vec => ({ x, y })) ?? null
  plan.areas = g.areas.map((a): Area => ({ ...a, color: parseInt(a.color.slice(1), 16) }))
  reservarIds(Math.max(0, ...plan.areas.map((a) => a.id)))
  plan.puertas = g.puertas.map((p) => ({
    id: nuevoId(),
    tipo: p.tipo,
    centro: { x: p.x, y: p.y },
    ancho: p.ancho,
    ...(p.bloqueada && { bloqueada: true }),
  }))
  plan.gondolas = g.gondolas.map((gd) => ({ id: nuevoId(), ...gd }))
  plan.piezas = (g.piezas ?? []).map((pz) => ({ id: nuevoId(), ...pz }))
  plan.muros = (g.muros ?? []).map((m) => ({
    id: nuevoId(),
    puntos: m.puntos.map(([x, y]): Vec => ({ x, y })),
    ...(m.bloqueada && { bloqueada: true }),
  }))
  for (const [j, i, n, area] of g.celdas) for (let k = 0; k < n; k++) plan.celdas.set(claveCelda(i + k, j), area)
  if (g.version < 2) migrarSeccionesDelSuelo(plan)
  return plan
}

/**
 * De la versión 1 a la 2: las secciones pasan del suelo al mueble. Cada tramo de góndola se queda
 * con la sección del suelo que tenía delante (lo mismo que ya contaba como su lineal),
 * y en el suelo solo quedan las zonas sin venta.
 */
function migrarSeccionesDelSuelo(plan: Plan) {
  const secciones = new Set(plan.areas.filter((a) => a.tipo === 'seccion').map((a) => a.id))
  for (const g of plan.gondolas) {
    const caras = carasDe(g)
    for (const cara of [0, 1] as const)
      caras[cara].forEach((_, k) => {
        const area = plan.celdas.get(claveCelda(...celdaDelante(g, cara, k)))
        if (area !== undefined && secciones.has(area)) caras[cara][k] = area
      })
  }
  for (const [k, area] of plan.celdas) if (secciones.has(area)) plan.celdas.delete(k)
}

let ultimoGuardado = ''

// El navegador puede negar el almacenamiento (ventana privada, datos bloqueados): entonces no se guarda y ya.
export function guardarLocal(plan: Plan) {
  const texto = serializar(plan)
  if (texto === ultimoGuardado) return
  try {
    localStorage.setItem(CLAVE_LOCAL, texto)
    ultimoGuardado = texto
  } catch {
    // Sin almacenamiento: la tienda vive solo mientras la pestaña esté abierta.
  }
}

export function cargarLocal(): Plan | null {
  try {
    const texto = localStorage.getItem(CLAVE_LOCAL)
    return texto ? deserializar(texto) : null
  } catch {
    return null
  }
}

/** La tienda demo que va con la app (`public/demo.json`). Null si no se puede leer. */
export async function cargarDemo(): Promise<Plan | null> {
  try {
    const r = await fetch('demo.json')
    return r.ok ? deserializar(await r.text()) : null
  } catch {
    return null
  }
}

export function descargar(plan: Plan) {
  const url = URL.createObjectURL(new Blob([serializar(plan)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `planta-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Abre el selector de archivos y devuelve la tienda leída (o null si se cancela). */
export function abrir(): Promise<Plan | null> {
  return new Promise((resolver, rechazar) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.addEventListener('change', async () => {
      const f = input.files?.[0]
      if (!f) return resolver(null)
      try {
        resolver(deserializar(await f.text()))
      } catch (e) {
        rechazar(e)
      }
    })
    input.addEventListener('cancel', () => resolver(null))
    input.click()
  })
}
