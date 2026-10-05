import {
  ajustarARejilla,
  CELDA,
  cortan,
  distancia,
  escalarASuperficie,
  proyectar,
  puntoEnPoligono,
  segmentoEnRect,
  superficie,
  type Vec,
} from './geometria'

export type TipoPuerta = 'entrada' | 'salida' | 'emergencia' | 'interior'

export interface Puerta {
  id: number
  tipo: TipoPuerta
  /** Punto cualquiera cerca del muro: al pintar se proyecta sobre el muro más cercano. */
  centro: Vec
  ancho: number
  bloqueada?: boolean
}

export type ExtremoGondola = 'inicio' | 'fin'

/** Lo que se pinta de una cara de góndola: un id de sección (o nada) por tramo de 50 cm. */
export type Tramos = (number | null)[]

/**
 * Góndola de dos caras. (x, y) es la esquina superior izquierda, en metros.
 * La cara 0 mira arriba (horizontal) o a la izquierda (vertical); la 1, al lado contrario.
 */
export interface Gondola {
  id: number
  x: number
  y: number
  largo: number
  horizontal: boolean
  bloqueada?: boolean
  /** Sección de cada tramo de cada cara. Se normaliza con `carasDe`. */
  caras?: [Tramos, Tramos]
  /** Cabeceras pegadas a los extremos, con su sección. */
  cabeceras?: Partial<Record<ExtremoGondola, { area: number | null }>>
}

export type TipoPieza = 'cubo' | 'expo'

/** Pieza suelta que ocupa suelo: cubo de stock o expo. Se pinta entera de una sección (o de ninguna). */
export interface Pieza {
  id: number
  tipo: TipoPieza
  x: number
  y: number
  w: number
  h: number
  area: number | null
  bloqueada?: boolean
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Muro levantado dentro de la tienda: una línea abierta de esquinas. */
export interface MuroInterior {
  id: number
  puntos: Vec[]
  bloqueada?: boolean
}

export type TipoArea = 'seccion' | 'cajas' | 'privada' | 'banos' | 'probadores'

/** Lo que se pinta en el suelo: una sección de venta o una zona sin venta. */
export interface Area {
  id: number
  tipo: TipoArea
  nombre: string
  color: number
}

export type Capa = 'muros' | 'puertas' | 'gondolas' | 'pintura'
export const CAPAS: Capa[] = ['muros', 'puertas', 'gondolas', 'pintura']
export const NOMBRE_CAPA: Record<Capa, string> = {
  muros: 'Muros',
  puertas: 'Puertas',
  gondolas: 'Mobiliario',
  pintura: 'Pintura',
}

export interface EstadoCapa {
  visible: boolean
  bloqueada: boolean
}

export interface Plan {
  capas: Record<Capa, EstadoCapa>
  contorno: Vec[] | null
  muros: MuroInterior[]
  puertas: Puerta[]
  gondolas: Gondola[]
  piezas: Pieza[]
  areas: Area[]
  /** Suelo pintado con zonas sin venta: celda ("i,j") → id de su área. Las secciones van en el mueble. */
  celdas: Map<string, number>
  /** Sube con cada cambio de la pintura, para saber cuándo recalcular. */
  version: number
}

export const FONDO_GONDOLA = 1
export const LARGO_MIN_GONDOLA = 1
export const FONDO_CABECERA = 0.5
export const MEDIDA_PIEZA: Record<TipoPieza, number> = { cubo: 1, expo: 2 }
export const NOMBRE_PIEZA: Record<TipoPieza, string> = { cubo: 'Cubo', expo: 'Expo' }
export const ANCHO_PUERTA: Record<TipoPuerta, number> = { entrada: 3, salida: 3, emergencia: 1.5, interior: 1 }
export const TIPOS_PUERTA: TipoPuerta[] = ['entrada', 'salida', 'emergencia', 'interior']
export const NOMBRE_PUERTA: Record<TipoPuerta, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  emergencia: 'Emergencia',
  interior: 'Interior',
}

let ultimoId = 0
export const nuevoId = () => ++ultimoId
/** Tras cargar una tienda: que los ids nuevos no choquen con los que trae. */
export const reservarIds = (max: number) => {
  ultimoId = Math.max(ultimoId, max)
}

/** Colores suaves para las secciones: se pintan opacos sobre el suelo. */
export const COLORES_SECCION = [
  0xbcd4f6, // azul
  0xc4e8c8, // verde
  0xd9cbf3, // morado
  0xf6c9da, // rosa
  0xf7e3a1, // amarillo
  0xbde8e4, // turquesa
  0xf6c4bd, // coral
  0xdcebb0, // lima
]

const ZONAS_FIJAS: Omit<Area, 'id'>[] = [
  { tipo: 'cajas', nombre: 'Cajas', color: 0xc9d1d7 },
  { tipo: 'privada', nombre: 'Zona privada', color: 0xb3bcc3 },
  { tipo: 'banos', nombre: 'Baños', color: 0xc7d6e2 },
  { tipo: 'probadores', nombre: 'Probadores', color: 0xd3d6cf },
]

export function planVacio(): Plan {
  return {
    capas: {
      muros: { visible: true, bloqueada: false },
      puertas: { visible: true, bloqueada: false },
      gondolas: { visible: true, bloqueada: false },
      pintura: { visible: true, bloqueada: false },
    },
    contorno: null,
    muros: [],
    puertas: [],
    gondolas: [],
    piezas: [],
    areas: ZONAS_FIJAS.map((z) => ({ ...z, id: nuevoId() })),
    celdas: new Map(),
    version: 0,
  }
}

export const claveCelda = (i: number, j: number) => `${i},${j}`

export function celdaDe(v: Vec) {
  return { i: Math.floor(v.x / CELDA), j: Math.floor(v.y / CELDA) }
}

export function centroCelda(i: number, j: number): Vec {
  return { x: (i + 0.5) * CELDA, y: (j + 0.5) * CELDA }
}

export function celdasDeRect(r: Rect): [number, number][] {
  const celdas: [number, number][] = []
  const i0 = Math.round(r.x / CELDA)
  const j0 = Math.round(r.y / CELDA)
  for (let i = i0; i < i0 + Math.round(r.w / CELDA); i++)
    for (let j = j0; j < j0 + Math.round(r.h / CELDA); j++) celdas.push([i, j])
  return celdas
}

/** Celdas que ocupa el mueble: góndolas con sus cabeceras, cubos y expos. */
export function celdasOcupadas(plan: Plan): Set<string> {
  const ocupadas = new Set<string>()
  const rects = [...plan.gondolas.flatMap(huellaGondola), ...plan.piezas]
  for (const r of rects) for (const [i, j] of celdasDeRect(r)) ocupadas.add(claveCelda(i, j))
  return ocupadas
}

export const modulos = (g: Gondola) => Math.round(g.largo / CELDA)

/** Las caras de la góndola con un tramo por cada 50 cm de largo (rellena o recorta por el final). */
export function carasDe(g: Gondola): [Tramos, Tramos] {
  const n = modulos(g)
  const ajustar = (t: Tramos | undefined): Tramos => {
    const r = (t ?? []).slice(0, n)
    while (r.length < n) r.push(null)
    return r
  }
  g.caras = [ajustar(g.caras?.[0]), ajustar(g.caras?.[1])]
  return g.caras
}

/** Copia independiente (caras y cabeceras no se comparten con el original). */
export function copiarGondola(g: Gondola, id: number): Gondola {
  return {
    ...g,
    id,
    bloqueada: undefined,
    caras: g.caras && [[...g.caras[0]], [...g.caras[1]]],
    cabeceras: g.cabeceras && JSON.parse(JSON.stringify(g.cabeceras)),
  }
}

/** Celda de la góndola que forma el tramo `k` de la cara `cara`. */
export function celdaTramo(g: Gondola, cara: 0 | 1, k: number): [number, number] {
  const i0 = Math.round(g.x / CELDA)
  const j0 = Math.round(g.y / CELDA)
  const lado = cara === 0 ? 0 : Math.round(FONDO_GONDOLA / CELDA) - 1
  return g.horizontal ? [i0 + k, j0 + lado] : [i0 + lado, j0 + k]
}

/** Celda de suelo que queda delante del tramo `k` de la cara `cara`. */
export function celdaDelante(g: Gondola, cara: 0 | 1, k: number): [number, number] {
  const [i, j] = celdaTramo(g, cara, k)
  const paso = cara === 0 ? -1 : 1
  return g.horizontal ? [i, j + paso] : [i + paso, j]
}

/**
 * Si delante de ese tramo hay suelo libre: dentro de la tienda, sin mueble y sin muro de por medio.
 * Una cara contra la pared, un muro u otro mueble no se ve desde ningún pasillo.
 */
export function tramoLibre(plan: Plan, ocupadas: Set<string>, g: Gondola, cara: 0 | 1, k: number): boolean {
  const c = plan.contorno
  if (!c) return false
  const [i, j] = celdaDelante(g, cara, k)
  if (ocupadas.has(claveCelda(i, j)) || !puntoEnPoligono(centroCelda(i, j), c)) return false
  return plan.muros.length === 0 || !muroEntre(plan, centroCelda(...celdaTramo(g, cara, k)), centroCelda(i, j))
}

/**
 * Si hay un muro interior entre los centros de dos celdas vecinas. Los muros van por las líneas
 * de la rejilla, así que separan celdas en vez de ocuparlas.
 */
export function muroEntre(plan: Plan, a: Vec, b: Vec): boolean {
  for (const m of plan.muros)
    for (let i = 0; i < m.puntos.length - 1; i++) if (cortan(a, b, m.puntos[i], m.puntos[i + 1])) return true
  return false
}

/** Metros de lineal útil por sección: tramos pintados con suelo libre delante, más 1 m por cabecera pintada. */
export function linealPorArea(plan: Plan): Map<number, number> {
  const lineal = new Map<number, number>()
  const sumar = (area: number | null | undefined, m: number) => {
    if (area != null) lineal.set(area, (lineal.get(area) ?? 0) + m)
  }
  const ocupadas = celdasOcupadas(plan)
  for (const g of plan.gondolas) {
    const caras = carasDe(g)
    for (const cara of [0, 1] as const)
      caras[cara].forEach((area, k) => {
        if (area != null && tramoLibre(plan, ocupadas, g, cara, k)) sumar(area, CELDA)
      })
    for (const cab of Object.values(g.cabeceras ?? {})) sumar(cab?.area, FONDO_GONDOLA)
  }
  return lineal
}

/** Se puede ver y tocar: capa visible y sin candado, y el objeto sin candado. */
export function editable(plan: Plan, capa: Capa, obj?: { bloqueada?: boolean }): boolean {
  const c = plan.capas[capa]
  return c.visible && !c.bloqueada && !obj?.bloqueada
}

export function rectGondola(g: Gondola): Rect {
  return g.horizontal
    ? { x: g.x, y: g.y, w: g.largo, h: FONDO_GONDOLA }
    : { x: g.x, y: g.y, w: FONDO_GONDOLA, h: g.largo }
}

/** La cabecera de un extremo: tan ancha como el fondo de la góndola y en perpendicular a ella. */
export function rectCabecera(g: Gondola, extremo: ExtremoGondola): Rect {
  const f = FONDO_CABECERA
  if (g.horizontal) return { x: extremo === 'inicio' ? g.x - f : g.x + g.largo, y: g.y, w: f, h: FONDO_GONDOLA }
  return { x: g.x, y: extremo === 'inicio' ? g.y - f : g.y + g.largo, w: FONDO_GONDOLA, h: f }
}

/** Todo lo que ocupa la góndola: su cuerpo y sus cabeceras. */
export function huellaGondola(g: Gondola): Rect[] {
  const r = [rectGondola(g)]
  for (const e of ['inicio', 'fin'] as ExtremoGondola[]) if (g.cabeceras?.[e]) r.push(rectCabecera(g, e))
  return r
}

export const dentroDe = (p: Vec, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

/** Si dos rectángulos se pisan (tocarse no cuenta). */
export function sePisan(a: Rect, b: Rect): boolean {
  const e = 0.01
  return !(a.x >= b.x + b.w - e || b.x >= a.x + a.w - e || a.y >= b.y + b.h - e || b.y >= a.y + a.h - e)
}

/** Dentro de la tienda, sin atravesar muros y sin pisar otro mueble. `rects` es lo que ocupa `obj`. */
function sitioLibre(plan: Plan, rects: Rect[], obj: Gondola | Pieza): boolean {
  const c = plan.contorno
  if (!c) return false
  const e = 0.01
  for (const r of rects) {
    const muestras = [
      { x: r.x + e, y: r.y + e },
      { x: r.x + r.w - e, y: r.y + e },
      { x: r.x + e, y: r.y + r.h - e },
      { x: r.x + r.w - e, y: r.y + r.h - e },
      { x: r.x + r.w / 2, y: r.y + r.h / 2 },
    ]
    if (!muestras.every((m) => puntoEnPoligono(m, c))) return false
    for (const m of plan.muros)
      for (let i = 0; i < m.puntos.length - 1; i++) if (segmentoEnRect(m.puntos[i], m.puntos[i + 1], r, true)) return false
  }
  const otros = [
    ...plan.gondolas.filter((g) => g.id !== obj.id).flatMap(huellaGondola),
    ...plan.piezas.filter((pz) => pz.id !== obj.id),
  ]
  return rects.every((r) => otros.every((o) => !sePisan(r, o)))
}

export function piezaValida(plan: Plan, p: Pieza): boolean {
  return sitioLibre(plan, [p], p)
}

export function piezaEn(plan: Plan, p: Vec): Pieza | null {
  for (let i = plan.piezas.length - 1; i >= 0; i--) if (dentroDe(p, plan.piezas[i])) return plan.piezas[i]
  return null
}

/** La góndola bajo `p`, contando sus cabeceras. Al revés para coger la que se pinta encima. */
export function gondolaEn(plan: Plan, p: Vec): Gondola | null {
  for (let i = plan.gondolas.length - 1; i >= 0; i--)
    if (huellaGondola(plan.gondolas[i]).some((r) => dentroDe(p, r))) return plan.gondolas[i]
  return null
}

/** Dentro de la tienda, sin atravesar un muro y sin pisar otro mueble (cabeceras incluidas). Tocarlos vale. */
export function gondolaValida(plan: Plan, g: Gondola): boolean {
  return sitioLibre(plan, huellaGondola(g), g)
}

/** Un tramo recto de muro: del contorno (`muro` null) o de un muro interior. */
export interface Tramo {
  a: Vec
  b: Vec
  muro: MuroInterior | null
  /** Índice del tramo dentro de su muro. */
  i: number
}

export function tramos(plan: Plan): Tramo[] {
  const t: Tramo[] = []
  const c = plan.contorno
  if (c) for (let i = 0; i < c.length; i++) t.push({ a: c[i], b: c[(i + 1) % c.length], muro: null, i })
  for (const m of plan.muros) for (let i = 0; i < m.puntos.length - 1; i++) t.push({ a: m.puntos[i], b: m.puntos[i + 1], muro: m, i })
  return t
}

export interface SitioPuerta {
  /** Extremos del hueco en el muro. */
  a: Vec
  b: Vec
  centro: Vec
  /** Dirección del muro (unitaria) y su largo. */
  u: Vec
  largoMuro: number
  /** Tramo en el que está y a cuántos metros de su inicio queda el centro. */
  tramo: Tramo
  desde: number
}

/**
 * Coloca una puerta en el tramo de muro más cercano a `p` (contorno o interior): ajustada a la rejilla
 * a lo largo del muro y sin salirse de él. Null si ningún tramo es lo bastante largo.
 */
export function colocarPuerta(plan: Plan, p: Vec, ancho: number): (SitioPuerta & { distancia: number }) | null {
  let mejor: (SitioPuerta & { distancia: number }) | null = null
  for (const tramo of tramos(plan)) {
    const { a, b } = tramo
    const largo = distancia(a, b)
    if (largo < ancho) continue
    const proy = proyectar(p, a, b)
    if (mejor && proy.distancia >= mejor.distancia) continue
    const ux = (b.x - a.x) / largo
    const uy = (b.y - a.y) / largo
    const desde = Math.min(largo - ancho / 2, Math.max(ancho / 2, Math.round((proy.t * largo) / CELDA) * CELDA))
    const centro = { x: a.x + ux * desde, y: a.y + uy * desde }
    mejor = {
      a: { x: centro.x - (ux * ancho) / 2, y: centro.y - (uy * ancho) / 2 },
      b: { x: centro.x + (ux * ancho) / 2, y: centro.y + (uy * ancho) / 2 },
      centro,
      u: { x: ux, y: uy },
      largoMuro: largo,
      tramo,
      desde,
      distancia: proy.distancia,
    }
  }
  return mejor
}

/** Escala la tienda entera a `m2`: contorno y muros, y la posición (no el tamaño) de puertas y góndolas. */
export function escalarPlan(plan: Plan, m2: number) {
  const c = plan.contorno
  if (!c || !(m2 > 0)) return
  const s = Math.sqrt(m2 / superficie(c))
  const o = c[0]
  const llevar = (v: Vec) => ({ x: o.x + (v.x - o.x) * s, y: o.y + (v.y - o.y) * s })
  plan.contorno = escalarASuperficie(c, m2)
  plan.celdas = escalarCeldas(plan.celdas, o, s)
  plan.version++
  for (const m of plan.muros) m.puntos = m.puntos.map((v) => ajustarARejilla(llevar(v), CELDA))
  for (const p of plan.puertas) p.centro = llevar(p.centro)
  const objetos = [...plan.gondolas.map((g) => ({ obj: g, r: rectGondola(g) })), ...plan.piezas.map((pz) => ({ obj: pz, r: pz as Rect }))]
  for (const { obj, r } of objetos) {
    const centro = llevar({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
    const esquina = ajustarARejilla({ x: centro.x - r.w / 2, y: centro.y - r.h / 2 }, CELDA)
    obj.x = esquina.x
    obj.y = esquina.y
  }
}

/** Cada celda nueva toma el área de la celda vieja que cae bajo su centro. */
function escalarCeldas(celdas: Map<string, number>, o: Vec, s: number): Map<string, number> {
  if (celdas.size === 0) return celdas
  let [minI, minJ, maxI, maxJ] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const k of celdas.keys()) {
    const [i, j] = k.split(',').map(Number)
    minI = Math.min(minI, i)
    minJ = Math.min(minJ, j)
    maxI = Math.max(maxI, i + 1)
    maxJ = Math.max(maxJ, j + 1)
  }
  const nuevo = (v: number, o: number) => o + (v * CELDA - o) * s
  const nuevas = new Map<string, number>()
  for (let i = Math.floor(nuevo(minI, o.x) / CELDA) - 1; i <= Math.ceil(nuevo(maxI, o.x) / CELDA); i++) {
    for (let j = Math.floor(nuevo(minJ, o.y) / CELDA) - 1; j <= Math.ceil(nuevo(maxJ, o.y) / CELDA); j++) {
      const ctr = centroCelda(i, j)
      const viejo = celdaDe({ x: o.x + (ctr.x - o.x) / s, y: o.y + (ctr.y - o.y) / s })
      const area = celdas.get(claveCelda(viejo.i, viejo.j))
      if (area !== undefined) nuevas.set(claveCelda(i, j), area)
    }
  }
  return nuevas
}

/** Metros de estantería útil, pintados o no: tramos de góndola con suelo libre delante, más las cabeceras. */
export function metrosLineal(plan: Plan): number {
  const ocupadas = celdasOcupadas(plan)
  let total = 0
  for (const g of plan.gondolas) {
    for (const cara of [0, 1] as const)
      for (let k = 0; k < modulos(g); k++) if (tramoLibre(plan, ocupadas, g, cara, k)) total += CELDA
    total += Object.keys(g.cabeceras ?? {}).length * FONDO_GONDOLA
  }
  return total
}
