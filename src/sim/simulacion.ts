import type { Vec } from '../geometria'
import type { Plan } from '../plan'
import { Azar, semillaDe } from './azar'
import type { Dia, Historico } from './historico'
import type { Campo, Frente, Modo, Navegacion, Puesto, TipoPuesto } from './navegacion'

export const PASO = 0.25 // s de simulación por paso

/** Tiempos de compra (segundos). Ajustables. */
export const TIEMPOS = {
  /** Parada larga para coger un producto (una por unidad comprada). */
  compraMin: 40,
  compraMax: 100,
  /** Parada corta para ojear, y su probabilidad en cada paso por un pasillo. */
  ojeoMin: 3,
  ojeoMax: 10,
  ojeoProbabilidad: 0.02,
  /** Parada en una cabecera, un cubo o una expo sin comprar. */
  puntoMin: 6,
  puntoMax: 20,
  /** Cuánto se tarda en cobrar: en caja con cajero y en autopago (cada uno se pasa sus productos). */
  cobroMin: 50,
  cobroMax: 110,
  autopagoMin: 80,
  autopagoMax: 160,
  /** Parte de los que compran que elige autopago cuando hay. */
  prefiereAutopago: 0.35,
  /**
   * Para calcular la hora de entrada a partir de la de pago, solo con la cesta (no con la tienda):
   * base + por sección + por unidad. Ajustado midiendo la tienda demo para que los pagos caigan
   * cerca de la hora del histórico.
   */
  previstoBase: 120,
  previstoSeccion: 180,
  previstoUnidad: 60,
  /** Baños y probadores (segundos dentro). */
  banoMin: 120,
  banoMax: 240,
  probadorMin: 120,
  probadorMax: 300,
  /** Trabajador reponiendo: probabilidad por paso andando su sección y cuánto se queda. */
  reponerProbabilidad: 0.006,
  reponerMin: 30,
  reponerMax: 120,
}

/** Lo que se decide en el panel de la simulación, además del día. */
export interface Ajustes {
  /** Parte de los clientes que pasa por los baños (0-1). */
  banos: number
  /** Parte de los que compran que pasa por los probadores (0-1). */
  probadores: number
  /** De los que se prueban algo, parte que vuelve a la sección a cambiarlo (0-1). */
  vuelven: number
  /** Cajas con cajero y autopagos abiertos. */
  cajas: number
  autopagos: number
  /** Trabajadores reponiendo en cada sección (id de área → cuántos). */
  trabajadores: Record<number, number>
  /** Minutos que aguanta un cliente esperando para pagar antes de dejar la compra e irse. */
  pacienciaCaja: number
}

export function ajustesIniciales(plan: Plan): Ajustes {
  const trabajadores: Record<number, number> = {}
  for (const a of plan.areas) if (a.tipo === 'seccion') trabajadores[a.id] = 1
  return { banos: 0.08, probadores: 0.3, vuelven: 0.4, cajas: 6, autopagos: 4, trabajadores, pacienciaCaja: 15 }
}

/** Frentes como mucho que recorre el que compra en cada sección (los más cercanos primero). */
const MAX_FRENTES_COMPRA = 8
/** Ancho de pasillo (en celdas desde la estantería) por el que se anda y se adelanta. */
const BANDA = 2

type Fase = 'fuera' | 'comprando' | 'zona' | 'a-cajas' | 'en-fila' | 'a-puesto' | 'pagando' | 'saliendo' | 'ido' | 'trabajando'

export interface Cliente {
  compra: boolean
  /** Trabajador de una sección (punto rojo): no compra ni se va, repone. */
  trabajador: boolean
  /** Le queda pasar por los baños / los probadores, y si tras probarse vuelve a la sección. */
  bano: boolean
  probador: boolean
  vuelve: boolean
  /** Secciones ya recorridas (para volver tras el probador). */
  visitadas: number[]
  /** Baños o probadores, cuando va o está en ellos. */
  zona: 'banos' | 'probadores' | null
  enZona: boolean
  /** Fila en la que paga y puesto que le ha tocado. */
  fila: TipoPuesto | null
  puesto: Puesto | null
  /** Segundos esperando en la fila de cajas. */
  esperaCaja: number
  /** Se cansó de esperar y se fue sin pagar. */
  perdido: boolean
  /** Secciones que le faltan: id de área y unidades que compra en ella. */
  pendientes: { area: number; unidades: number }[]
  euros: number
  entrada: number
  salida: number
  fase: Fase
  /** Sección en la que está. */
  area: number | null
  /** Frentes de la sección que le quedan por recorrer. */
  ruta: Frente[]
  /** Dónde se parará a comprar: posición a lo largo de cada frente (o el punto entero). */
  compras: Map<Frente, number[]>
  /** Frente que está recorriendo (o al que va), si lo anda ya, y en qué sentido. */
  frente: Frente | null
  recorriendo: boolean
  sentido: 1 | -1
  /** Segundos que le quedan parado (ojeando, comprando o pagando). */
  pausa: number
  celda: number
  /** Movimiento en curso: de `celda` hacia `destino`, con `progreso` de 0 a 1. */
  destino: number
  progreso: number
  duracion: number
  velocidad: number // celdas por segundo
  bloqueado: number
  esperaTotal: number
}

export interface Resumen {
  dentro: number
  hanComprado: number
  sinComprar: number
  euros: number
  /** Minutos de media en tienda de los que ya han comprado y salido. */
  minutosMedios: number
  /** Minutos de media parados por atascos. */
  minutosAtasco: number
  /** Horas que han pasado parados en atascos (sin contar la fila de caja) todos los que ya se han ido. */
  horasAtasco: number
  /** Minutos de media entre la hora de pago del histórico y la de la simulación (+ = más tarde). */
  desfasePago: number
  /** Minutos de media esperando en la fila de cajas. */
  minutosFila: number
  /** Gente en cada fila ahora mismo. */
  enFila: Record<TipoPuesto, number>
  /** Los que se cansaron de esperar para pagar y se fueron sin comprar, y lo que no se cobró. */
  perdidos: number
  eurosPerdidos: number
  /** Secciones del histórico que no están en el plano (sus clientes se las saltan). */
  sinSitio: string[]
}

/**
 * Reproduce un día del histórico sobre una tienda. Cada ticket es un cliente que compra y entra
 * a una hora calculada solo con su cesta (no con la tienda), así que dos colocaciones distintas
 * reciben los mismos clientes a la misma hora; lo que cambia es lo que les pasa dentro.
 * Dentro de cada sección el cliente la recorre: anda sus frentes junto a la estantería, ojea,
 * se para a coger lo que compra y pasa al siguiente.
 */
export class Simulacion {
  /** Segundos desde medianoche. */
  tiempo: number
  readonly clientes: Cliente[] = []
  readonly cierre: number
  private llegadas: Cliente[] = []
  private siguiente = 0
  private ocupacion: Uint16Array
  private azar: Azar
  private nav: Navegacion
  private sinSitio: string[]
  /** Trabajadores de las secciones (puntos rojos). */
  readonly personal: Cliente[] = []
  /** Filas únicas de cajas y puestos ocupados. */
  private filas: Record<TipoPuesto, Cliente[]> = { cajero: [], autopago: [] }
  private ocupados = new Set<Puesto>()
  private paciencia: number
  /** Hora de pago del histórico de cada cliente que compra, para medir el desfase. */
  private pagoHistorico = new Map<Cliente, number>()
  private pagoSimulado = new Map<Cliente, number>()
  /** Segundos parado acumulados en cada celda: el mapa de atascos. */
  readonly atascos: Float32Array

  constructor(plan: Plan, nav: Navegacion, historico: Historico, dia: Dia, ajustes: Ajustes = ajustesIniciales(plan)) {
    this.nav = nav
    this.paciencia = ajustes.pacienciaCaja * 60
    this.tiempo = historico.apertura * 60
    this.cierre = historico.cierre * 60
    this.ocupacion = new Uint16Array(nav.ancho * nav.alto)
    this.atascos = new Float32Array(nav.ancho * nav.alto)
    // Llegadas y cestas con la semilla del día: iguales sea cual sea la tienda.
    const azarDia = new Azar(semillaDe(dia.fecha))
    this.azar = new Azar(semillaDe(dia.fecha + ':movimiento'))

    // Del nombre de sección del histórico al área del plano.
    const areaDe = historico.secciones.map(
      (nombre) => plan.areas.find((a) => a.tipo === 'seccion' && a.nombre.trim().toLowerCase() === nombre.toLowerCase())?.id ?? null,
    )
    const conSitio = (s: number) => areaDe[s] !== null && nav.frentes.has(areaDe[s]!)
    this.sinSitio = historico.secciones.filter((_, s) => !conSitio(s))

    const nuevo = (compra: boolean, entrada: number, pendientes: Cliente['pendientes'], euros: number): Cliente => ({
      compra,
      trabajador: false,
      bano: false,
      probador: false,
      vuelve: false,
      visitadas: [],
      zona: null,
      enZona: false,
      fila: null,
      puesto: null,
      esperaCaja: 0,
      perdido: false,
      pendientes,
      euros,
      entrada,
      salida: 0,
      fase: 'fuera',
      area: null,
      ruta: [],
      compras: new Map(),
      frente: null,
      recorriendo: false,
      sentido: 1,
      pausa: 0,
      celda: -1,
      destino: -1,
      progreso: 0,
      duracion: 0,
      velocidad: Math.max(1.6, (1.2 + 0.2 * azarDia.normal()) / 0.5),
      bloqueado: 0,
      esperaTotal: 0,
    })

    // Los que compran: uno por ticket. Entran antes de pagar lo que "debería" durar su compra.
    for (const [minuto, lineas] of dia.tickets) {
      const pendientes = lineas.filter(([s]) => conSitio(s)).map(([s, u]) => ({ area: areaDe[s]!, unidades: u }))
      const unidades = lineas.reduce((t, l) => t + l[1], 0)
      // Baños y probador se sortean aquí, con el azar del día: iguales en cualquier tienda.
      const bano = azarDia.siguiente() < ajustes.banos
      const probador = azarDia.siguiente() < ajustes.probadores
      const vuelve = probador && azarDia.siguiente() < ajustes.vuelven
      const previsto =
        TIEMPOS.previstoBase +
        TIEMPOS.previstoSeccion * lineas.length +
        TIEMPOS.previstoUnidad * unidades +
        (bano ? (TIEMPOS.banoMin + TIEMPOS.banoMax) / 2 : 0) +
        (probador ? (TIEMPOS.probadorMin + TIEMPOS.probadorMax) / 2 + 30 : 0) +
        (vuelve ? 120 : 0)
      const entrada = Math.max(this.tiempo, minuto * 60 - previsto + 60 * azarDia.normal())
      const euros = lineas.reduce((t, l) => t + l[2], 0) / 100
      const c = nuevo(true, entrada, pendientes, euros)
      c.bano = bano && nav.campos.has('banos')
      c.probador = probador && nav.campos.has('probadores')
      c.vuelve = vuelve
      this.llegadas.push(c)
      this.pagoHistorico.set(c, minuto * 60)
    }

    // Los que no compran: la puerta menos los tickets de cada hora. Rondan lo que más se vende a esa hora.
    dia.frecuentacion.forEach((entran, h) => {
      const inicio = (historico.apertura + 60 * h) * 60
      const deLaHora = dia.tickets.filter(([m]) => m * 60 >= inicio && m * 60 < inicio + 3600)
      const ventas = new Map<number, number>()
      for (const [, ls] of deLaHora) for (const [s, , c] of ls) if (conSitio(s)) ventas.set(s, (ventas.get(s) ?? 0) + c)
      const pesos = [...ventas].map(([s, c]) => [s, c] as [number, number])
      if (!pesos.length) return
      for (let n = 0; n < entran - deLaHora.length; n++) {
        const cuantas = azarDia.siguiente() < 0.7 ? 1 : 2
        const elegidas = new Set<number>()
        while (elegidas.size < Math.min(cuantas, pesos.length)) elegidas.add(azarDia.elegir(pesos))
        const pendientes = [...elegidas].map((s) => ({ area: areaDe[s]!, unidades: 0 }))
        const c = nuevo(false, inicio + azarDia.siguiente() * 3600, pendientes, 0)
        c.bano = azarDia.siguiente() < ajustes.banos && nav.campos.has('banos')
        this.llegadas.push(c)
      }
    })
    this.llegadas.sort((a, b) => a.entrada - b.entrada)

    // Trabajadores: empiezan en un punto al azar de los frentes de su sección.
    for (const [area, cuantos] of Object.entries(ajustes.trabajadores)) {
      const frentes = nav.frentes.get(Number(area))
      if (!frentes?.length) continue
      for (let n = 0; n < cuantos; n++) {
        const libres = frentes.flatMap((f) => f.celdas).filter((k) => this.ocupacion[k] === 0)
        if (!libres.length) break
        const t = nuevo(false, this.tiempo, [], 0)
        t.trabajador = true
        t.fase = 'trabajando'
        t.area = Number(area)
        t.velocidad = 2
        t.celda = libres[Math.floor(this.azar.siguiente() * libres.length)]
        this.ocupacion[t.celda]++
        this.personal.push(t)
      }
    }
  }

  /** Avanza la simulación `segundos` (en pasos fijos). */
  avanzar(segundos: number) {
    const pasos = Math.round(segundos / PASO)
    for (let p = 0; p < pasos; p++) this.paso()
  }

  private paso() {
    this.tiempo += PASO
    // Entran los que les toca, si la celda de la puerta está libre (si no, esperan fuera).
    while (this.siguiente < this.llegadas.length && this.llegadas[this.siguiente].entrada <= this.tiempo) {
      const libre = this.nav.entradas.filter((k) => this.ocupacion[k] === 0)
      if (!libre.length) break
      const c = this.llegadas[this.siguiente++]
      c.celda = libre[Math.floor(this.azar.siguiente() * libre.length)]
      c.entrada = this.tiempo
      this.ocupacion[c.celda]++
      this.clientes.push(c)
      this.siguienteDestino(c)
    }
    this.repartirPuestos()
    for (const c of this.clientes) if (c.fase !== 'ido') this.mover(c)
    for (const t of this.personal) this.mover(t)
  }

  /** Decide adónde va ahora: la sección pendiente más cercana, cajas o la salida. */
  private siguienteDestino(c: Cliente) {
    const nav = this.nav
    if (c.area !== null && c.fase === 'comprando' && !c.visitadas.includes(c.area)) c.visitadas.push(c.area)
    // Las secciones a las que no se puede llegar desde aquí (encerradas tras un muro) se las salta.
    c.pendientes = c.pendientes.filter((p) => nav.campos.get(p.area)![c.celda] !== Infinity)
    // Al baño: entre dos secciones (a veces) o al acabar de comprar.
    if (c.bano && (c.pendientes.length === 0 || (c.visitadas.length > 0 && this.azar.siguiente() < 0.5))) {
      c.bano = false
      this.irAZona(c, 'banos')
      return
    }
    if (c.pendientes.length) {
      let mejor = 0
      c.pendientes.forEach((p, i) => {
        if (nav.campos.get(p.area)![c.celda] < nav.campos.get(c.pendientes[mejor].area)![c.celda]) mejor = i
      })
      const [p] = c.pendientes.splice(mejor, 1)
      this.empezarSeccion(c, p.area, p.unidades)
    } else if (c.probador) {
      c.probador = false
      this.irAZona(c, 'probadores')
    } else if (c.compra && nav.campos.has('cajas') && c.fase !== 'pagando') {
      c.fase = 'a-cajas'
      c.area = null
      // Con cajas colocadas, elige fila: autopago (si hay y le apetece) o caja con cajero.
      const hay = (t: TipoPuesto) => nav.puestos.some((p) => p.tipo === t)
      if (hay('cajero') || hay('autopago'))
        c.fila = hay('autopago') && (!hay('cajero') || this.azar.siguiente() < TIEMPOS.prefiereAutopago) ? 'autopago' : 'cajero'
    } else {
      c.fase = 'saliendo'
      c.area = null
    }
  }

  /** Fila única: en cuanto un puesto queda libre, el primero de la fila va a él (si ya está en la fila, no de camino). */
  private repartirPuestos() {
    for (const tipo of ['cajero', 'autopago'] as const) {
      const fila = this.filas[tipo]
      const campo = this.nav.campos.get(`fila-${tipo}`)
      while (fila.length) {
        const libre = this.nav.puestos.find((p) => p.tipo === tipo && !this.ocupados.has(p))
        if (!libre || !campo || campo[fila[0].celda] > 2) break
        const c = fila.shift()!
        this.ocupados.add(libre)
        c.puesto = libre
        c.fase = 'a-puesto'
      }
    }
  }

  private irAZona(c: Cliente, zona: 'banos' | 'probadores') {
    c.fase = 'zona'
    c.zona = zona
    c.enZona = false
    c.area = null
  }

  /** Tras el probador, algunos vuelven a una de sus secciones a cambiar la talla: un par de frentes y a cajas. */
  private trasZona(c: Cliente) {
    const volvio = c.zona === 'probadores' && c.vuelve && c.visitadas.length > 0
    c.zona = null
    c.enZona = false
    if (volvio) {
      c.vuelve = false
      const area = c.visitadas[Math.floor(this.azar.siguiente() * c.visitadas.length)]
      this.empezarSeccion(c, area, 1, 2)
      return
    }
    this.siguienteDestino(c)
  }

  /**
   * Prepara la visita a una sección. El que compra la recorre entera (hasta 8 frentes) y reparte sus
   * unidades por los frentes al azar: ahí se parará a cogerlas. El que no compra mira 1-3 frentes.
   */
  private empezarSeccion(c: Cliente, area: number, unidades: number, maxFrentes?: number) {
    const todos = this.nav.frentes.get(area) ?? []
    const cerca = [...todos].sort((a, b) => a.campo[c.celda] - b.campo[c.celda])
    const cuantos = Math.min(
      maxFrentes ?? (c.compra ? MAX_FRENTES_COMPRA : 1 + Math.floor(this.azar.siguiente() * 3)),
      cerca.length,
    )
    c.ruta = cerca.slice(0, cuantos)
    c.compras = new Map()
    for (let u = 0; u < unidades; u++) {
      const f = c.ruta[Math.floor(this.azar.siguiente() * c.ruta.length)]
      const donde = f.desde + this.azar.siguiente() * (f.hasta - f.desde)
      c.compras.set(f, [...(c.compras.get(f) ?? []), donde])
    }
    c.fase = 'comprando'
    c.area = area
    c.frente = null
  }

  private mover(c: Cliente) {
    // En medio de un paso: seguir andando.
    if (c.destino !== -1) {
      c.progreso += PASO / c.duracion
      if (c.progreso >= 1) {
        c.celda = c.destino
        c.destino = -1
        c.progreso = 0
      } else return
    }
    if (c.pausa > 0) {
      c.pausa -= PASO
      if (c.pausa <= 0 && c.fase === 'pagando') {
        if (c.puesto) this.ocupados.delete(c.puesto)
        c.puesto = null
        this.siguienteDestino(c)
      }
      if (c.pausa <= 0 && c.fase === 'zona') this.trasZona(c)
      return
    }

    if (c.fase === 'comprando' || c.fase === 'trabajando') {
      this.comprar(c)
      return
    }
    if (c.fase === 'zona') {
      const campo = this.nav.campos.get(c.zona!)!
      const aqui = campo[c.celda]
      if (aqui === Infinity) this.trasZona(c)
      else if (aqui === 0) {
        c.enZona = true
        c.pausa =
          c.zona === 'banos'
            ? this.azar.entre(TIEMPOS.banoMin, TIEMPOS.banoMax)
            : this.azar.entre(TIEMPOS.probadorMin, TIEMPOS.probadorMax)
      } else this.bajar(c, campo, 'compra', aqui)
      return
    }

    if (c.fila && (c.fase === 'a-cajas' || c.fase === 'en-fila' || c.fase === 'a-puesto')) {
      this.pagarEnCaja(c)
      return
    }

    const salir = c.fase === 'saliendo'
    const campo = this.nav.campos.get(salir ? 'salida' : 'cajas')!
    const aqui = campo[c.celda]
    // Sin camino a la salida (o ya en ella): se va. Sin camino a cajas: sale sin pasar por ellas.
    if (salir && (aqui === 0 || aqui === Infinity)) {
      this.ocupacion[c.celda]--
      c.fase = 'ido'
      c.salida = this.tiempo
      return
    }
    if (c.fase === 'a-cajas') {
      if (aqui === Infinity) {
        c.fase = 'saliendo'
        return
      }
      if (aqui === 0) {
        c.fase = 'pagando'
        c.pausa = this.azar.entre(TIEMPOS.cobroMin, TIEMPOS.cobroMax)
        this.pagoSimulado.set(c, this.tiempo + c.pausa)
        return
      }
    }
    this.bajar(c, campo, salir ? 'salida' : 'compra', aqui)
  }

  /** Si lleva más de la paciencia esperando para pagar, deja la compra y se va. */
  private cansado(c: Cliente): boolean {
    if (c.esperaCaja <= this.paciencia) return false
    const fila = this.filas[c.fila!]
    const i = fila.indexOf(c)
    if (i !== -1) fila.splice(i, 1)
    c.perdido = true
    c.fase = 'saliendo'
    return true
  }

  /** Ir a la fila, esperar turno, ir al puesto que le toque y pagar. */
  private pagarEnCaja(c: Cliente) {
    const nav = this.nav
    if (c.fase === 'a-cajas') {
      const campo = nav.campos.get(`fila-${c.fila!}`)!
      const aqui = campo[c.celda]
      if (aqui === Infinity) {
        c.fase = 'saliendo'
        return
      }
      if (this.cansado(c)) return
      // Con la fila llena no se acerca: espera donde está (y cuenta como espera de caja), sin taponar pasillos.
      if (this.filas[c.fila!].length >= nav.filas[c.fila!].length) {
        c.esperaCaja += PASO
        this.atascos[c.celda] += PASO
        return
      }
      // Entra en la fila al llegar a 3 m de ella: el orden es el de llegada.
      if (aqui <= 6) {
        c.fase = 'en-fila'
        this.filas[c.fila!].push(c)
        return
      }
      this.bajar(c, campo, 'compra', aqui)
      return
    }
    if (c.fase === 'en-fila') {
      if (this.cansado(c)) return
      c.esperaCaja += PASO
      this.atascos[c.celda] += PASO
      // Avanza hacia su sitio en la fila (el que le toca según cuántos tiene delante).
      const sitios = nav.filas[c.fila!]
      const puesto = Math.min(this.filas[c.fila!].indexOf(c), sitios.length - 1)
      const objetivo = nav.centro(sitios[puesto])
      if (c.celda === sitios[puesto]) return
      const lejos = (k: number) => Math.hypot(nav.centro(k).x - objetivo.x, nav.centro(k).y - objetivo.y)
      let mejor = -1
      let dMejor = lejos(c.celda)
      for (let d = 0; d < 8; d++) {
        const v = nav.vecina(c.celda, d, 'compra')
        if (v === -1 || this.ocupacion[v] > 0) continue
        const dv = lejos(v)
        if (dv < dMejor - 1e-6) {
          dMejor = dv
          mejor = d
        }
      }
      if (mejor !== -1) this.empezarPaso(c, mejor, 'compra')
      // Si no puede acercarse en línea recta (alguien o algo en medio), baja por el mapa de la fila.
      else if (lejos(c.celda) > 1.5) {
        const campo = nav.campos.get(`fila-${c.fila!}`)!
        if (campo[c.celda] > 0) this.bajar(c, campo, 'compra', campo[c.celda])
      }
      return
    }
    // A su puesto.
    const p = c.puesto!
    const aqui = p.campo[c.celda]
    if (aqui === Infinity) {
      this.ocupados.delete(p)
      c.puesto = null
      c.fase = 'saliendo'
      return
    }
    if (aqui === 0) {
      c.fase = 'pagando'
      c.pausa =
        p.tipo === 'cajero'
          ? this.azar.entre(TIEMPOS.cobroMin, TIEMPOS.cobroMax)
          : this.azar.entre(TIEMPOS.autopagoMin, TIEMPOS.autopagoMax)
      this.pagoSimulado.set(c, this.tiempo + c.pausa)
      return
    }
    this.bajar(c, p.campo, 'compra', aqui)
  }

  /** Dentro de la sección: ir al frente más cercano que falte, recorrerlo y pasar al siguiente. */
  private comprar(c: Cliente) {
    if (!c.frente) {
      // El trabajador no acaba nunca: cuando ha recorrido su sección, vuelve a empezar en otro orden.
      if (c.trabajador && !c.ruta.length) c.ruta = [...(this.nav.frentes.get(c.area!) ?? [])]
      c.ruta = c.ruta.filter((f) => f.campo[c.celda] !== Infinity)
      if (!c.ruta.length) {
        if (!c.trabajador) this.siguienteDestino(c)
        return
      }
      let mejor = 0
      c.ruta.forEach((f, i) => {
        if (f.campo[c.celda] < c.ruta[mejor].campo[c.celda]) mejor = i
      })
      // El trabajador va a un frente al azar de su sección, no al más cercano.
      if (c.trabajador) mejor = Math.floor(this.azar.siguiente() * c.ruta.length)
      c.frente = c.ruta.splice(mejor, 1)[0]
      c.recorriendo = false
    }
    const f = c.frente
    const nav = this.nav

    if (!c.recorriendo) {
      const aqui = f.campo[c.celda]
      // Llega a un punto al tocarlo; a un frente, al entrar en su pasillo (a un metro de la estantería como mucho).
      const enPasillo =
        f.tipo === 'frente' &&
        aqui <= BANDA &&
        Math.abs(nav.aLoAncho(c.celda, f.eje) - f.linea) <= BANDA &&
        nav.aLoLargo(c.celda, f.eje) >= f.desde - 1 &&
        nav.aLoLargo(c.celda, f.eje) <= f.hasta + 1
      if (!enPasillo && aqui > (f.tipo === 'punto' ? 1 : 0)) {
        // Un frente lleno no se espera eternamente: tras 20 s parado, se pasa al siguiente.
        if (c.bloqueado > 20) {
          c.frente = null
          c.bloqueado = 0
          return
        }
        this.bajar(c, f.campo, 'compra', aqui)
        return
      }
      // Ya está delante de la estantería.
      if (f.tipo === 'punto') {
        const compra = c.compras.has(f)
        c.pausa = compra
          ? this.azar.entre(TIEMPOS.compraMin, TIEMPOS.compraMax)
          : this.azar.entre(TIEMPOS.puntoMin, TIEMPOS.puntoMax)
        c.frente = null
        return
      }
      // Se anda hacia el extremo más lejano: así se recorre el frente entero.
      const a = nav.aLoLargo(c.celda, f.eje)
      c.sentido = a - f.desde < f.hasta - a ? 1 : -1
      c.recorriendo = true
    }

    const a = nav.aLoLargo(c.celda, f.eje)
    // ¿Ha llegado a donde coge un producto?
    const paradas = c.compras.get(f)
    if (paradas?.length) {
      const i = paradas.findIndex((p) => (c.sentido > 0 ? a >= p : a <= p))
      if (i !== -1) {
        paradas.splice(i, 1)
        c.pausa = this.azar.entre(TIEMPOS.compraMin, TIEMPOS.compraMax)
        return
      }
    }
    // Final del frente: si se dejó algo sin coger (lo adelantó por el lado), lo coge aquí.
    if (c.sentido > 0 ? a >= f.hasta : a <= f.desde) {
      const pendientes = c.compras.get(f)?.length ?? 0
      c.compras.delete(f)
      c.frente = null
      if (pendientes) c.pausa = pendientes * this.azar.entre(TIEMPOS.compraMin, TIEMPOS.compraMax)
      return
    }
    if (c.trabajador) {
      if (this.azar.siguiente() < TIEMPOS.reponerProbabilidad) {
        c.pausa = this.azar.entre(TIEMPOS.reponerMin, TIEMPOS.reponerMax)
        return
      }
    } else if (this.azar.siguiente() < TIEMPOS.ojeoProbabilidad) {
      c.pausa = this.azar.entre(TIEMPOS.ojeoMin, TIEMPOS.ojeoMax)
      return
    }
    this.avanzarPorFrente(c, f, a)
  }

  /**
   * Un paso a lo largo del frente, por el pasillo pegado a la estantería. Si el de delante está parado,
   * adelanta por el lado si hay hueco; si no, espera (y eso es un atasco). Tras 30 s atascado, lo deja.
   */
  private avanzarPorFrente(c: Cliente, f: Frente, a: number) {
    const nav = this.nav
    const anchoAqui = Math.abs(nav.aLoAncho(c.celda, f.eje) - f.linea)
    let mejor = -1
    let puntos = -Infinity
    for (let d = 0; d < 8; d++) {
      const v = nav.vecina(c.celda, d, 'compra')
      if (v === -1 || this.ocupacion[v] > 0) continue
      const ancho = Math.abs(nav.aLoAncho(v, f.eje) - f.linea)
      if (ancho > BANDA) continue
      const avance = (nav.aLoLargo(v, f.eje) - a) * c.sentido
      let p: number
      // Avanzar, cuanto más pegado a la estantería mejor; de lado, solo acercándose a ella
      // (o, si lleva rato parado, apartándose para adelantar). Hacia atrás, nunca.
      if (avance > 0) p = 10 * avance - 3 * ancho
      else if (avance === 0 && ancho < anchoAqui) p = 5 - ancho
      else if (avance === 0 && c.bloqueado > 1.5) p = 1 - ancho
      else continue
      p += this.azar.siguiente()
      if (p > puntos) {
        puntos = p
        mejor = d
      }
    }
    if (mejor === -1) {
      c.bloqueado += PASO
      c.esperaTotal += PASO
      this.atascos[c.celda] += PASO
      if (c.bloqueado > 30) {
        c.frente = null
        c.bloqueado = 0
      }
      return
    }
    this.empezarPaso(c, mejor, 'compra')
  }

  /**
   * Un paso cuesta abajo en el mapa de distancias, a la celda libre que más acerque (con un poco de azar
   * para que no vayan todos en fila). Si no hay ninguna, espera; tras 3 s acepta pasos que no acercan
   * (rodear al de delante); tras 10 s, pasar pegado a otro (dos en una celda).
   */
  private bajar(c: Cliente, campo: Campo, modo: Modo, aqui: number) {
    const nav = this.nav
    const holgura = c.bloqueado > 3 ? 0.6 : 0
    const apretarse = c.bloqueado > 10
    // Quien va a su caja o sale de ella pide paso: tras 2 s bloqueado, pasa entre la gente.
    const pasar = (c.fase === 'a-puesto' || c.fase === 'saliendo') && c.bloqueado > 2
    let mejor = -1
    let valorMejor = Infinity
    for (let d = 0; d < 8; d++) {
      const v = nav.vecina(c.celda, d, modo)
      if (v === -1 || campo[v] >= aqui + holgura) continue
      if (!pasar && this.ocupacion[v] > (apretarse ? 1 : 0)) continue
      const valor = campo[v] + this.azar.siguiente() * 0.3
      if (valor < valorMejor) {
        valorMejor = valor
        mejor = d
      }
    }
    if (mejor === -1) {
      c.bloqueado += PASO
      c.esperaTotal += PASO
      this.atascos[c.celda] += PASO
      return
    }
    this.empezarPaso(c, mejor, modo)
  }

  private empezarPaso(c: Cliente, d: number, modo: Modo) {
    const v = this.nav.vecina(c.celda, d, modo)
    this.ocupacion[c.celda]--
    this.ocupacion[v]++
    c.destino = v
    c.progreso = 0
    c.duracion = this.nav.coste(d) / c.velocidad
    c.bloqueado = 0
  }

  /** Posición en metros para pintarlo (a medio camino entre celdas si está andando). */
  posicion(c: Cliente): Vec {
    const a = this.nav.centro(c.celda)
    if (c.destino === -1) return a
    const b = this.nav.centro(c.destino)
    return { x: a.x + (b.x - a.x) * c.progreso, y: a.y + (b.y - a.y) * c.progreso }
  }

  resumen(): Resumen {
    let dentro = 0
    let hanComprado = 0
    let sinComprar = 0
    let euros = 0
    let minutos = 0
    let atasco = 0
    let salidos = 0
    let desfase = 0
    let fila = 0
    let horasAtasco = 0
    let perdidos = 0
    let eurosPerdidos = 0
    for (const c of this.clientes) {
      if (c.perdido) {
        perdidos++
        eurosPerdidos += c.euros
      }
      if (c.fase === 'ido') horasAtasco += c.esperaTotal / 3600
      if (c.fase !== 'ido') dentro++
      else if (c.compra && !c.perdido) {
        hanComprado++
        euros += c.euros
        minutos += (c.salida - c.entrada) / 60
        atasco += c.esperaTotal / 60
        fila += c.esperaCaja / 60
        salidos++
        const pagado = this.pagoSimulado.get(c)
        if (pagado !== undefined) desfase += (pagado - this.pagoHistorico.get(c)!) / 60
      } else sinComprar++
    }
    return {
      dentro,
      hanComprado,
      sinComprar,
      euros,
      minutosMedios: salidos ? minutos / salidos : 0,
      minutosAtasco: salidos ? atasco / salidos : 0,
      horasAtasco,
      desfasePago: salidos ? desfase / salidos : 0,
      minutosFila: salidos ? fila / salidos : 0,
      enFila: { cajero: this.filas.cajero.length, autopago: this.filas.autopago.length },
      perdidos,
      eurosPerdidos,
      sinSitio: this.sinSitio,
    }
  }

  get terminado() {
    return this.tiempo >= this.cierre && this.siguiente >= this.llegadas.length && this.clientes.every((c) => c.fase === 'ido')
  }

  /** Termina el día de golpe: hasta que cierra y se va el último (con un tope de 3 h tras el cierre). */
  terminar() {
    while (this.tiempo < this.cierre + 3 * 3600 && !this.terminado) this.avanzar(60)
  }

  /** Esperando fuera porque la entrada estaba llena. */
  get enCola() {
    let n = 0
    for (let i = this.siguiente; i < this.llegadas.length && this.llegadas[i].entrada <= this.tiempo; i++) n++
    return n
  }
}
