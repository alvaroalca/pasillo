import { CELDA, cortan, distancia, interseccion, proyectar, puntoEnPoligono, type Vec } from '../geometria'
import {
  carasDe,
  celdaDelante,
  celdasDeRect,
  celdasOcupadas,
  centroCelda,
  claveCelda,
  colocarPuerta,
  rectCabecera,
  tramoLibre,
  type ExtremoGondola,
  type Plan,
  type TipoPuerta,
} from '../plan'

/** Comprando, las puertas de Salida están cerradas; saliendo (tras cajas), las de Entrada. */
export type Modo = 'compra' | 'salida'

/** Las 8 direcciones: 4 rectas y 4 diagonales. */
export const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
const DIAGONAL = Math.SQRT2

/** Mapa de distancias (en celdas) hasta un conjunto de celdas destino. Infinity donde no se llega. */
export type Campo = Float32Array

export type TipoPuesto = 'cajero' | 'autopago'

/** Un sitio donde se paga: el cliente se pone en `servicio`; `mueble` no se pisa (mostrador o terminal). */
export interface Puesto {
  tipo: TipoPuesto
  servicio: number
  mueble: number[]
  /** Celda del cajero (solo en las cajas con cajero), para pintarlo. */
  cajero: number | null
  campo: Campo
}

/**
 * Lo que un cliente recorre dentro de una sección. Un frente es un tramo seguido de góndola de la sección
 * mirando a un pasillo: se anda de punta a punta junto a la estantería. Un punto es una cabecera, un cubo
 * o una expo: se va, se mira y se sigue.
 */
export interface Frente {
  area: number
  tipo: 'frente' | 'punto'
  /** Celdas de suelo pegadas a la estantería (o alrededor del punto). */
  celdas: number[]
  /** Eje del frente: 0 si va a lo largo de x, 1 si a lo largo de y. */
  eje: 0 | 1
  /** Coordenada (en celdas) de la línea pegada a la estantería, en el eje perpendicular. */
  linea: number
  /** Extremos del frente a lo largo de su eje (en celdas). */
  desde: number
  hasta: number
  /** Distancias hasta sus celdas. */
  campo: Campo
}

/**
 * La tienda vista por un cliente: una rejilla de 50 cm con las celdas pisables, los pasos que cortan
 * los muros (según el sentido de las puertas) y los mapas de distancias a cada destino.
 */
export class Navegacion {
  readonly i0: number
  readonly j0: number
  readonly ancho: number
  readonly alto: number
  /** 1 si se puede pisar: dentro de la tienda, sin mueble y fuera de la zona privada. */
  readonly pisable: Uint8Array
  /** Por modo, para cada celda, un bit por dirección cortada (muro sin puerta, o puerta en contra). */
  private cortes: Record<Modo, Uint8Array>
  /** Celdas por las que entran los clientes (pegadas a una puerta de Entrada de fachada). */
  readonly entradas: number[]
  /** Celdas por las que salen (pegadas a una puerta de Salida de fachada; si no hay, las de Entrada). */
  readonly salidas: number[]
  /** Puntos de compra de cada sección (id de área → celdas). */
  readonly compra = new Map<number, number[]>()
  readonly cajas: number[]
  /** Mapas de distancias: a cada sección y a cajas en modo compra; a la salida en modo salida. */
  readonly campos = new Map<number | 'cajas' | 'salida' | 'banos' | 'probadores' | 'fila-cajero' | 'fila-autopago', Campo>()
  /** Frentes y puntos de cada sección. */
  readonly frentes = new Map<number, Frente[]>()
  /** Cajas con cajero y autopagos colocados en la zona de Cajas, y las celdas de su fila única (en orden). */
  readonly puestos: Puesto[] = []
  readonly filas: Record<TipoPuesto, number[]> = { cajero: [], autopago: [] }
  /** Cuántas cajas y autopagos se pidieron pero no cabían en la zona. */
  readonly sinSitioCajas = { cajas: 0, autopagos: 0 }

  constructor(plan: Plan, abiertas: { cajas: number; autopagos: number } = { cajas: 0, autopagos: 0 }) {
    const c = plan.contorno
    if (!c) throw new Error('La tienda no tiene contorno.')
    const xs = c.map((v) => v.x)
    const ys = c.map((v) => v.y)
    this.i0 = Math.floor(Math.min(...xs) / CELDA) - 1
    this.j0 = Math.floor(Math.min(...ys) / CELDA) - 1
    this.ancho = Math.ceil(Math.max(...xs) / CELDA) - this.i0 + 2
    this.alto = Math.ceil(Math.max(...ys) / CELDA) - this.j0 + 2
    const n = this.ancho * this.alto

    const ocupadas = celdasOcupadas(plan)
    const privadas = new Set(plan.areas.filter((a) => a.tipo === 'privada').map((a) => a.id))
    this.pisable = new Uint8Array(n)
    for (let k = 0; k < n; k++) {
      const [i, j] = this.ij(k)
      const clave = claveCelda(i, j)
      const zona = plan.celdas.get(clave)
      this.pisable[k] = puntoEnPoligono(centroCelda(i, j), c) && !ocupadas.has(clave) && !(zona !== undefined && privadas.has(zona)) ? 1 : 0
    }

    this.cortes = { compra: new Uint8Array(n), salida: new Uint8Array(n) }
    this.cortarMuros(plan)

    // Puertas de fachada: las celdas de dentro pegadas a ellas.
    const pegadas = (tipo: TipoPuerta) => {
      const celdas = new Set<number>()
      for (const p of plan.puertas) {
        if (p.tipo !== tipo) continue
        const sitio = colocarPuerta(plan, p.centro, p.ancho)
        if (!sitio || sitio.tramo.muro !== null) continue
        for (let k = 0; k < n; k++) {
          if (!this.pisable[k]) continue
          if (proyectar(this.centro(k), sitio.a, sitio.b).distancia <= CELDA * 0.6) celdas.add(k)
        }
      }
      return [...celdas]
    }
    this.entradas = pegadas('entrada')
    const salidas = pegadas('salida')
    this.salidas = salidas.length ? salidas : this.entradas

    this.puntosDeCompra(plan, ocupadas)
    const cajas = new Set(plan.areas.filter((a) => a.tipo === 'cajas').map((a) => a.id))
    this.cajas = []
    for (const [clave, area] of plan.celdas) {
      if (!cajas.has(area)) continue
      const [i, j] = clave.split(',').map(Number)
      const k = this.indice(i, j)
      if (k !== -1 && this.pisable[k]) this.cajas.push(k)
    }

    this.colocarCajas(plan, abiertas.cajas, abiertas.autopagos)
    for (const [area, celdas] of this.compra) this.campos.set(area, this.distancias(celdas, 'compra'))
    this.trazarFrentes(plan, ocupadas)
    for (const p of this.puestos) p.campo = this.distancias([p.servicio], 'compra')
    for (const tipo of ['cajero', 'autopago'] as const)
      if (this.filas[tipo].length) this.campos.set(`fila-${tipo}`, this.distancias(this.filas[tipo], 'compra'))
    if (this.cajas.length) this.campos.set('cajas', this.distancias(this.cajas, 'compra'))
    // Baños y probadores: las celdas pisables de su zona pintada.
    for (const tipo of ['banos', 'probadores'] as const) {
      const ids = new Set(plan.areas.filter((a) => a.tipo === tipo).map((a) => a.id))
      const celdas: number[] = []
      for (const [clave, area] of plan.celdas) {
        if (!ids.has(area)) continue
        const [i, j] = clave.split(',').map(Number)
        const k = this.indice(i, j)
        if (k !== -1 && this.pisable[k]) celdas.push(k)
      }
      if (celdas.length) this.campos.set(tipo, this.distancias(celdas, 'compra'))
    }
    this.campos.set('salida', this.distancias(this.salidas, 'salida'))
  }

  ij(k: number): [number, number] {
    return [(k % this.ancho) + this.i0, Math.floor(k / this.ancho) + this.j0]
  }

  indice(i: number, j: number): number {
    const x = i - this.i0
    const y = j - this.j0
    return x < 0 || y < 0 || x >= this.ancho || y >= this.alto ? -1 : x + y * this.ancho
  }

  centro(k: number): Vec {
    const [i, j] = this.ij(k)
    return centroCelda(i, j)
  }

  /** La celda vecina en la dirección `d`, o -1 si no se puede ir (no pisable, muro, o diagonal que corta esquina). */
  vecina(k: number, d: number, modo: Modo): number {
    if (this.cortes[modo][k] & (1 << d)) return -1
    const [di, dj] = DIRS[d]
    const x = (k % this.ancho) + di
    const y = Math.floor(k / this.ancho) + dj
    if (x < 0 || y < 0 || x >= this.ancho || y >= this.alto) return -1
    const v = x + y * this.ancho
    if (!this.pisable[v]) return -1
    // En diagonal solo si las dos rectas que la forman también se pueden andar: nada de cortar esquinas.
    if (d >= 4) {
      if (this.vecina(k, di > 0 ? 0 : 1, modo) === -1 || this.vecina(k, dj > 0 ? 2 : 3, modo) === -1) return -1
    }
    return v
  }

  coste(d: number): number {
    return d >= 4 ? DIAGONAL : 1
  }

  /**
   * Corta cada paso entre celdas vecinas que cruce un muro interior, salvo que en ese punto haya una puerta
   * que deje pasar en ese modo: Interior siempre; Entrada solo comprando; Salida solo saliendo; Emergencia nunca.
   */
  private cortarMuros(plan: Plan) {
    const puertas = plan.puertas
      .map((p) => ({ p, sitio: colocarPuerta(plan, p.centro, p.ancho) }))
      .filter((x) => x.sitio && x.sitio.tramo.muro !== null)
    const abre = (tipo: TipoPuerta, modo: Modo) =>
      tipo === 'interior' || (tipo === 'entrada' && modo === 'compra') || (tipo === 'salida' && modo === 'salida')

    for (const m of plan.muros)
      for (let t = 0; t < m.puntos.length - 1; t++) {
        const a = m.puntos[t]
        const b = m.puntos[t + 1]
        const i0 = Math.floor(Math.min(a.x, b.x) / CELDA) - 1
        const i1 = Math.floor(Math.max(a.x, b.x) / CELDA) + 1
        const j0 = Math.floor(Math.min(a.y, b.y) / CELDA) - 1
        const j1 = Math.floor(Math.max(a.y, b.y) / CELDA) + 1
        for (let i = i0; i <= i1; i++)
          for (let j = j0; j <= j1; j++) {
            const k = this.indice(i, j)
            if (k === -1) continue
            const ck = centroCelda(i, j)
            DIRS.forEach(([di, dj], d) => {
              const cv = centroCelda(i + di, j + dj)
              if (!cortan(ck, cv, a, b)) return
              // ¿Hay una puerta justo donde el paso cruza el muro?
              const cruce = interseccion(ck, cv, a, b) ?? ck
              const desde = distancia(a, cruce)
              for (const modo of ['compra', 'salida'] as Modo[]) {
                const pasa = puertas.some(
                  ({ p, sitio }) =>
                    sitio!.tramo.muro === m &&
                    sitio!.tramo.i === t &&
                    Math.abs(desde - sitio!.desde) < p.ancho / 2 &&
                    abre(p.tipo, modo),
                )
                if (!pasa) this.cortes[modo][k] |= 1 << d
              }
            })
          }
      }
  }

  /**
   * Dónde se compra cada sección: delante de sus tramos de góndola pintados, delante de sus cabeceras
   * y alrededor de sus cubos y expos.
   */
  private puntosDeCompra(plan: Plan, ocupadas: Set<string>) {
    const anadir = (area: number | null | undefined, i: number, j: number) => {
      if (area == null) return
      const k = this.indice(i, j)
      if (k === -1 || !this.pisable[k]) return
      if (!this.compra.has(area)) this.compra.set(area, [])
      this.compra.get(area)!.push(k)
    }
    for (const g of plan.gondolas) {
      const caras = carasDe(g)
      for (const cara of [0, 1] as const)
        caras[cara].forEach((area, k) => {
          if (area !== null && tramoLibre(plan, ocupadas, g, cara, k)) anadir(area, ...celdaDelante(g, cara, k))
        })
      for (const e of ['inicio', 'fin'] as ExtremoGondola[]) {
        const cab = g.cabeceras?.[e]
        if (!cab) continue
        // La cara de la cabecera mira hacia fuera de la góndola, a lo largo de su eje.
        const r = rectCabecera(g, e)
        for (const [i, j] of celdasDeRect(r)) {
          const fuera = e === 'inicio' ? -1 : 1
          anadir(cab.area, g.horizontal ? i + fuera : i, g.horizontal ? j : j + fuera)
        }
      }
    }
    for (const p of plan.piezas) {
      if (p.area === null) continue
      const dentro = new Set(celdasDeRect(p).map(([i, j]) => claveCelda(i, j)))
      for (const [i, j] of celdasDeRect(p))
        for (const [di, dj] of DIRS.slice(0, 4)) if (!dentro.has(claveCelda(i + di, j + dj))) anadir(p.area, i + di, j + dj)
    }
    for (const [area, celdas] of this.compra) this.compra.set(area, [...new Set(celdas)])
  }

  /**
   * Reparte cajas y autopagos por la zona de Cajas, a lo largo de su lado largo. Cada caja con cajero
   * ocupa 2 m: cajero, mostrador en perpendicular a la fachada y carril por el que se paga y se sale.
   * Cada autopago ocupa 1 m: terminal y el cliente al lado. Las filas únicas quedan del lado de la tienda
   * (el contrario a la puerta de salida), justo fuera de la zona.
   */
  private colocarCajas(plan: Plan, cajas: number, autopagos: number) {
    const zona = new Set(this.cajas)
    if (!zona.size || cajas + autopagos === 0) {
      this.sinSitioCajas.cajas = zona.size ? 0 : cajas
      this.sinSitioCajas.autopagos = zona.size ? 0 : autopagos
      return
    }
    const ijs = this.cajas.map((k) => this.ij(k))
    const [ia, ib] = [Math.min(...ijs.map((c) => c[0])), Math.max(...ijs.map((c) => c[0]))]
    const [ja, jb] = [Math.min(...ijs.map((c) => c[1])), Math.max(...ijs.map((c) => c[1]))]
    // u: a lo largo de la zona; v: a lo ancho. `celda(u, v)` vuelve a i, j.
    const largoEnX = ib - ia >= jb - ja
    const [u0, u1, v0, v1] = largoEnX ? [ia, ib, ja, jb] : [ja, jb, ia, ib]
    const celda = (u: number, v: number) => (largoEnX ? this.indice(u, v) : this.indice(v, u))

    // Lado de la salida: el borde de la zona más cerca de las puertas de Salida de fachada (o de Entrada).
    const puertas = plan.puertas
      .filter((p) => p.tipo === 'salida' || p.tipo === 'entrada')
      .map((p) => ({ p, sitio: colocarPuerta(plan, p.centro, p.ancho) }))
      .filter((x) => x.sitio && x.sitio.tramo.muro === null)
    const salidas = puertas.some((x) => x.p.tipo === 'salida') ? puertas.filter((x) => x.p.tipo === 'salida') : puertas
    const centroBorde = (v: number) => this.centro(celda(Math.round((u0 + u1) / 2), v)!)
    const cerca = (v: number) => Math.min(...salidas.map((x) => distancia(x.sitio!.centro, centroBorde(v))), Infinity)
    const salidaEnV1 = cerca(v1) <= cerca(v0)
    const vTienda = salidaEnV1 ? v0 : v1 // fila de la zona del lado de la tienda
    const vSalida = salidaEnV1 ? v1 : v0
    const haciaTienda = salidaEnV1 ? -1 : 1
    const vMedio = Math.round((vTienda + vSalida) / 2)

    const ancho = u1 - u0 + 1
    let quedan = ancho
    const colocadas = Math.min(cajas, Math.floor(quedan / 4))
    quedan -= colocadas * 4
    const autos = Math.min(autopagos, Math.floor(quedan / 2))
    this.sinSitioCajas.cajas = cajas - colocadas
    this.sinSitioCajas.autopagos = autopagos - autos

    const bloquear = (k: number) => {
      if (k !== -1) this.pisable[k] = 0
    }
    let u = u0
    const rangos: Record<TipoPuesto, [number, number]> = { cajero: [u0, u0 - 1], autopago: [0, -1] }
    // Mostrador desde la segunda fila del lado de la tienda hasta la penúltima del de la salida.
    const vDesde = Math.min(vTienda - haciaTienda, vSalida + haciaTienda)
    const vHasta = Math.max(vTienda - haciaTienda, vSalida + haciaTienda)
    for (let n = 0; n < colocadas; n++, u += 4) {
      const mueble: number[] = []
      for (let v = vDesde; v <= vHasta; v++) mueble.push(celda(u + 1, v))
      const cajero = celda(u, vMedio)
      for (const k of [...mueble, cajero]) bloquear(k)
      this.puestos.push({ tipo: 'cajero', servicio: celda(u + 2, vMedio), mueble, cajero, campo: new Float32Array(0) })
      rangos.cajero[1] = u + 3
    }
    rangos.autopago = [u, u - 1]
    for (let n = 0; n < autos; n++, u += 2) {
      const vTerminal = vTienda - haciaTienda
      const mueble = [celda(u, vTerminal)]
      bloquear(mueble[0])
      this.puestos.push({ tipo: 'autopago', servicio: celda(u + 1, vTerminal), mueble, cajero: null, campo: new Float32Array(0) })
      rangos.autopago[1] = u + 1
    }

    // Filas únicas: hasta 6 filas de celdas justo fuera de la zona, del lado de la tienda, frente a sus puestos
    // (y algo más anchas, para que con pocas cajas haya sitio para la cola). La cabeza es la celda más
    // cercana al centro de sus puestos. Las dos filas no se pisan: cada una se queda con su lado.
    const mitad = rangos.autopago[1] >= rangos.autopago[0] ? rangos.autopago[0] : u1 + 1
    for (const tipo of ['cajero', 'autopago'] as const) {
      const [a, b] = rangos[tipo]
      if (b < a) continue
      const centro = (a + b) / 2
      const [desde, hasta] = tipo === 'cajero' ? [Math.max(u0, a - 6), Math.min(mitad - 1, b + 6)] : [Math.max(mitad, a - 6), Math.min(u1, b + 6)]
      const celdas: [number, number, number][] = []
      for (let fila = 1; fila <= 6; fila++)
        for (let uu = desde; uu <= hasta; uu++) {
          const k = celda(uu, vTienda + haciaTienda * fila)
          if (k !== -1 && this.pisable[k] && !zona.has(k)) celdas.push([k, fila, Math.abs(uu - centro)])
        }
      celdas.sort((x, y) => x[1] - y[1] || x[2] - y[2])
      this.filas[tipo] = celdas.map((c) => c[0])
    }
  }

  /** Coordenada de una celda a lo largo del eje de un frente, y en perpendicular. */
  aLoLargo(k: number, eje: 0 | 1): number {
    return this.ij(k)[eje]
  }

  aLoAncho(k: number, eje: 0 | 1): number {
    return this.ij(k)[1 - eje]
  }

  private trazarFrentes(plan: Plan, ocupadas: Set<string>) {
    const anadir = (area: number, tipo: Frente['tipo'], ijs: [number, number][], eje: 0 | 1) => {
      const celdas = [...new Set(ijs.map(([i, j]) => this.indice(i, j)))].filter((k) => k !== -1 && this.pisable[k])
      if (!celdas.length) return
      const largo = celdas.map((k) => this.aLoLargo(k, eje))
      const f: Frente = {
        area,
        tipo,
        celdas,
        eje,
        linea: this.aLoAncho(celdas[0], eje),
        desde: Math.min(...largo),
        hasta: Math.max(...largo),
        campo: this.distancias(celdas, 'compra'),
      }
      if (!this.frentes.has(area)) this.frentes.set(area, [])
      this.frentes.get(area)!.push(f)
    }
    for (const g of plan.gondolas) {
      const caras = carasDe(g)
      const eje: 0 | 1 = g.horizontal ? 0 : 1
      for (const cara of [0, 1] as const) {
        // Tramos seguidos de la misma sección con pasillo delante: un frente cada uno.
        let k = 0
        while (k < caras[cara].length) {
          const area = caras[cara][k]
          if (area === null || !tramoLibre(plan, ocupadas, g, cara, k)) {
            k++
            continue
          }
          const ijs: [number, number][] = []
          while (k < caras[cara].length && caras[cara][k] === area && tramoLibre(plan, ocupadas, g, cara, k)) {
            ijs.push(celdaDelante(g, cara, k))
            k++
          }
          anadir(area, 'frente', ijs, eje)
        }
      }
      for (const e of ['inicio', 'fin'] as ExtremoGondola[]) {
        const cab = g.cabeceras?.[e]
        if (cab?.area == null) continue
        const fuera = e === 'inicio' ? -1 : 1
        const ijs = celdasDeRect(rectCabecera(g, e)).map(([i, j]): [number, number] => (g.horizontal ? [i + fuera, j] : [i, j + fuera]))
        anadir(cab.area, 'punto', ijs, eje)
      }
    }
    for (const p of plan.piezas) {
      if (p.area === null) continue
      const dentro = new Set(celdasDeRect(p).map(([i, j]) => claveCelda(i, j)))
      const ijs: [number, number][] = []
      for (const [i, j] of celdasDeRect(p))
        for (const [di, dj] of DIRS.slice(0, 4)) if (!dentro.has(claveCelda(i + di, j + dj))) ijs.push([i + di, j + dj])
      anadir(p.area, 'punto', ijs, 0)
    }
  }

  /** Dijkstra desde varias celdas a la vez: distancia de cada celda al destino más cercano. */
  distancias(destinos: number[], modo: Modo): Campo {
    const n = this.ancho * this.alto
    // En doble precisión mientras se calcula: con Float32 el redondeo hacía descartar celdas buenas al sacarlas de la cola.
    const dist = new Float64Array(n).fill(Infinity)
    const monton = new Monton()
    for (const k of destinos) {
      dist[k] = 0
      monton.meter(k, 0)
    }
    while (monton.tamano) {
      const [k, dk] = monton.sacar()
      if (dk > dist[k]) continue
      // Se recorre al revés (de destino a origen): el paso v→k tiene que estar abierto en ese sentido.
      for (let d = 0; d < 8; d++) {
        const [di, dj] = DIRS[d]
        const x = (k % this.ancho) - di
        const y = Math.floor(k / this.ancho) - dj
        if (x < 0 || y < 0 || x >= this.ancho || y >= this.alto) continue
        const v = x + y * this.ancho
        if (!this.pisable[v] || this.vecina(v, d, modo) !== k) continue
        const nd = dk + this.coste(d)
        if (nd < dist[v]) {
          dist[v] = nd
          monton.meter(v, nd)
        }
      }
    }
    return Float32Array.from(dist)
  }
}

/** Cola de prioridad mínima (montón binario) para Dijkstra. */
class Monton {
  private k: number[] = []
  private p: number[] = []

  get tamano() {
    return this.k.length
  }

  meter(k: number, p: number) {
    this.k.push(k)
    this.p.push(p)
    let i = this.k.length - 1
    while (i > 0) {
      const padre = (i - 1) >> 1
      if (this.p[padre] <= this.p[i]) break
      this.cambiar(i, padre)
      i = padre
    }
  }

  sacar(): [number, number] {
    const arriba: [number, number] = [this.k[0], this.p[0]]
    const k = this.k.pop()!
    const p = this.p.pop()!
    if (this.k.length) {
      this.k[0] = k
      this.p[0] = p
      let i = 0
      for (;;) {
        const a = 2 * i + 1
        const b = a + 1
        let m = i
        if (a < this.k.length && this.p[a] < this.p[m]) m = a
        if (b < this.k.length && this.p[b] < this.p[m]) m = b
        if (m === i) break
        this.cambiar(i, m)
        i = m
      }
    }
    return arriba
  }

  private cambiar(a: number, b: number) {
    ;[this.k[a], this.k[b]] = [this.k[b], this.k[a]]
    ;[this.p[a], this.p[b]] = [this.p[b], this.p[a]]
  }
}
