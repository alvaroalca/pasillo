import { Columns2, Flame, Pause, Play, Trophy } from 'lucide'
import type { Camara } from './camara'
import { Corrida } from './corrida'
import { boton, el, formatear } from './herramienta'
import type { Plan } from './plan'
import { cargarHistorico, eurosDia, type Historico } from './sim/historico'
import { ajustesIniciales, type Ajustes, type Resumen } from './sim/simulacion'

/** Minutos de tienda por segundo real: ×1 es un minuto por segundo (una hora en un minuto). */
const VELOCIDADES = [1, 2, 5, 10]
const MAX_POR_FOTOGRAMA = 20 // s de simulación como mucho por fotograma, para no congelar la pantalla

const hora = (segundos: number) => {
  const m = Math.floor(segundos / 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const fechaCorta = (f: string) => {
  const d = new Date(f + 'T12:00:00Z')
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`
}

export interface OpcionesSimulacion {
  /** Algo ha cambiado: repintar. */
  alCambiar: () => void
  /** Si hay una versión A fijada con la que comparar. */
  hayVersionA: () => boolean
  /** Empieza o deja de compararse: la pantalla se parte o se junta. */
  alComparar: (comparando: boolean) => void
}

/**
 * La tienda en marcha: reproduce un día del histórico sobre el plano actual (B) y, si se compara,
 * a la vez sobre la versión A, con el mismo día, ajustes y reloj. Mientras dura, no se edita.
 * Los clientes son puntos verdes (más claros los que no van a comprar, más oscuros pagando); el personal,
 * rojos. Las cajas y autopagos los coloca la simulación en la zona de Cajas según los Ajustes.
 */
export class ModoSimulacion {
  readonly panel = el('aside', 'panel panel-sim')
  /** B: la tienda que se está editando. A: la versión fijada para comparar. */
  readonly b: Corrida
  readonly a: Corrida
  comparando = false
  private historico: Historico | null = null
  private dia = 0
  private desde = 10
  private velocidad = 1
  private ajustes: Ajustes | null = null
  private ajustesAbiertos = false
  /** Mapa de calor encendido, y si ya se ha pedido el resultado del día. */
  private calor = false
  private conResultado = false
  private resultado = el('div', 'resultado-sim')
  private enMarcha = false
  private ultimo = 0
  private datos = el('div', 'datos-sim')
  private reloj = el('div', 'reloj')
  private aviso = el('p', 'aviso')
  private op: OpcionesSimulacion

  constructor(planB: Plan, planA: Plan, op: OpcionesSimulacion) {
    this.b = new Corrida(planB)
    this.a = new Corrida(planA)
    this.op = op
  }

  private get corridas(): Corrida[] {
    return this.comparando ? [this.a, this.b] : [this.b]
  }

  /** Prepara la simulación con la tienda tal como está. Devuelve un mensaje si no se puede. */
  async entrar(): Promise<string | null> {
    this.historico ??= await cargarHistorico()
    if (!this.historico) return 'No se ha podido leer el histórico de ventas.'
    const plan = this.b.plan
    if (!plan.contorno) return 'Dibuja primero la tienda.'
    // Los ajustes se conservan entre visitas; las secciones nuevas entran con un trabajador.
    const base = ajustesIniciales(plan)
    this.ajustes = this.ajustes
      ? { ...this.ajustes, trabajadores: { ...base.trabajadores, ...this.soloSecciones(this.ajustes.trabajadores) } }
      : base
    // La tienda puede haber cambiado desde la última vez: navegación nueva.
    this.b.preparar(this.ajustes, true)
    if (!this.b.nav!.entradas.length) return 'La tienda necesita al menos una puerta de Entrada en la fachada.'
    if (this.comparando && this.prepararA()) {
      this.comparando = false
      this.op.alComparar(false)
    }
    this.reiniciar()
    this.construirPanel()
    return null
  }

  salir() {
    this.enMarcha = false
    this.a.limpiar()
    this.b.limpiar()
  }

  /** Quita del reparto de trabajadores las secciones que ya no existen. */
  private soloSecciones(t: Record<number, number>) {
    const ids = new Set(this.b.plan.areas.filter((a) => a.tipo === 'seccion').map((a) => a.id))
    return Object.fromEntries(Object.entries(t).filter(([id]) => ids.has(Number(id))))
  }

  /** Los ajustes valen para las dos tiendas; los trabajadores van por sección, que en A se busca por nombre. */
  private ajustesDeA(): Ajustes {
    const a = this.ajustes!
    const nombre = (id: number) => this.b.plan.areas.find((x) => x.id === id)?.nombre.trim().toLowerCase()
    const trabajadores: Record<number, number> = {}
    for (const area of this.a.plan.areas.filter((x) => x.tipo === 'seccion')) {
      const enB = Object.entries(a.trabajadores).find(([id]) => nombre(Number(id)) === area.nombre.trim().toLowerCase())
      trabajadores[area.id] = enB ? enB[1] : 1
    }
    return { ...a, trabajadores }
  }

  /** Navegación de la versión A. Devuelve un mensaje si no se puede simular. */
  private prepararA(): string | null {
    const plan = this.a.plan
    if (!this.op.hayVersionA() || !plan.contorno) return 'Fija primero una versión A desde el menú (☰ → Fijar como versión A).'
    this.a.preparar(this.ajustesDeA(), true)
    if (!this.a.nav!.entradas.length) return 'La versión A no tiene puerta de Entrada en la fachada.'
    return null
  }

  private alternarComparacion() {
    if (!this.comparando) {
      const problema = this.prepararA()
      if (problema) return alert(problema)
    }
    this.comparando = !this.comparando
    if (!this.comparando) this.a.limpiar()
    this.op.alComparar(this.comparando)
    this.reiniciar()
    this.construirPanel()
  }

  /** Vuelve a empezar el día elegido en todas las tiendas y las adelanta hasta la hora de inicio. */
  private reiniciar() {
    const h = this.historico!
    this.b.reiniciar(h, h.dias[this.dia], this.ajustes!, this.desde)
    if (this.comparando) this.a.reiniciar(h, h.dias[this.dia], this.ajustesDeA(), this.desde)
    this.conResultado = false
    this.resultado.replaceChildren()
    this.op.alCambiar()
  }

  private alternar() {
    this.enMarcha = !this.enMarcha
    if (this.enMarcha) {
      this.ultimo = performance.now()
      requestAnimationFrame((t) => this.bucle(t))
    }
    this.construirPanel()
  }

  private bucle(ahora: number) {
    if (!this.enMarcha || !this.b.sim) return
    const real = Math.min(0.1, (ahora - this.ultimo) / 1000)
    this.ultimo = ahora
    const paso = Math.min(MAX_POR_FOTOGRAMA, real * this.velocidad * 60)
    for (const c of this.corridas) c.sim?.avanzar(paso)
    if (this.corridas.every((c) => c.sim!.terminado)) {
      this.enMarcha = false
      this.construirPanel()
    }
    this.op.alCambiar()
    if (this.enMarcha) requestAnimationFrame((t) => this.bucle(t))
  }

  /** Pinta cada tienda con su cámara: A a la izquierda y B a la derecha cuando se compara. */
  dibujar(camA: Camara, camB: Camara) {
    // Al comparar, una sola escala de calor para las dos (la mayor): así se comparan de verdad.
    const tope = this.calor && this.comparando ? Math.max(this.a.escalaCalor(), this.b.escalaCalor()) : 0
    this.b.dibujar(camB, this.calor, tope)
    if (this.comparando) this.a.dibujar(camA, this.calor, tope)
    this.refrescar()
  }

  private construirPanel() {
    const h = this.historico
    if (!h) return
    this.panel.replaceChildren()

    const select = el('select')
    select.id = 'dia-sim'
    h.dias.forEach((d, i) => {
      const op = el('option', '', `${fechaCorta(d.fecha)} · ${formatear(eurosDia(d), 0)} €`)
      op.value = String(i)
      op.selected = i === this.dia
      select.append(op)
    })
    select.addEventListener('change', () => {
      this.dia = Number(select.value)
      this.reiniciar()
    })
    const filaDia = el('div', 'campo')
    const lDia = el('label', '', 'Día')
    lDia.htmlFor = select.id
    filaDia.append(lDia, select)

    const desde = el('select')
    desde.id = 'desde-sim'
    for (let hh = Math.floor(h.apertura / 60); hh < Math.ceil(h.cierre / 60); hh++) {
      const op = el('option', '', `${hh}:00`)
      op.value = String(hh)
      op.selected = hh === this.desde
      desde.append(op)
    }
    desde.addEventListener('change', () => {
      this.desde = Number(desde.value)
      this.reiniciar()
    })
    const filaDesde = el('div', 'campo')
    const lDesde = el('label', '', 'Empezar a las')
    lDesde.htmlFor = desde.id
    filaDesde.append(lDesde, desde)

    const controles = el('div', 'controles-sim')
    controles.append(boton(this.enMarcha ? 'Pausa' : 'Reproducir', 'primario', () => this.alternar(), this.enMarcha ? Pause : Play))
    const velocidades = el('div', 'opciones')
    for (const v of VELOCIDADES)
      velocidades.append(
        boton(`×${v}`, `opcion${v === this.velocidad ? ' activa' : ''}`, () => {
          this.velocidad = v
          this.construirPanel()
        }),
      )
    velocidades.append(boton('Resultado', 'opcion resultado', () => this.verResultado(), Trophy))

    const comparar = boton(
      this.comparando ? 'Dejar de comparar' : 'Comparar con la versión A',
      `secundario${this.comparando ? ' activo' : ''}`,
      () => this.alternarComparacion(),
      Columns2,
    )
    comparar.disabled = !this.op.hayVersionA()
    comparar.title = this.op.hayVersionA() ? 'Pantalla partida: versión A a la izquierda, tienda actual a la derecha' : 'Fija primero una versión A desde el menú (☰)'

    this.panel.append(
      el('p', 'subtitulo', 'Simulación'),
      filaDia,
      filaDesde,
      this.reloj,
      controles,
      el('p', 'subtitulo', 'Velocidad (minutos de tienda por segundo)'),
      velocidades,
      comparar,
      this.resultado,
      this.datos,
      this.aviso,
      this.construirAjustes(),
      el('p', 'atajos', 'Cada ticket del día es un cliente que compra; el resto de la gente que entra solo mira. Mismo día, misma gente: lo que cambia es la tienda.'),
    )
    if (this.conResultado) this.pintarResultado()
    this.refrescar()
  }

  /**
   * Termina el día de golpe en todas las tiendas y enseña cómo ha ido: cuánto más (o menos) ha tardado
   * cada cliente en pagar que en el histórico, y cuántos se fueron sin pagar. Enciende el mapa de calor.
   */
  private verResultado() {
    if (!this.b.sim) return
    this.enMarcha = false
    this.construirPanel()
    // Con pocas cajas, terminar el día cuesta unos segundos: primero se avisa, luego se calcula.
    this.resultado.replaceChildren(el('p', 'subtitulo', 'Calculando el resto del día…'))
    setTimeout(() => {
      for (const c of this.corridas) if (!c.sim!.terminado) c.sim!.terminar()
      this.conResultado = true
      this.calor = true
      this.pintarResultado()
      this.op.alCambiar()
    }, 30)
  }

  private pintarResultado() {
    const bloque = (titulo: string, valor: string, clase: string, detalle: string) => {
      const b = el('div', `cifra ${clase}`)
      b.append(el('span', 'titulo', titulo), el('strong', '', valor), el('span', 'detalle', detalle))
      return b
    }
    const tono = (malo: boolean, bueno: boolean) => (malo ? 'mal' : bueno ? 'bien' : '')
    const minutos = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${formatear(Math.abs(d))} min`
    const eficiencia = (r: Resumen, detalle: boolean) =>
      bloque(
        'Eficiencia',
        minutos(r.desfasePago),
        tono(r.desfasePago > 0.25, r.desfasePago < -0.25),
        !detalle
          ? 'por cliente'
          : r.desfasePago > 0.25
            ? 'Cada cliente tarda de media más en pagar que en el histórico.'
            : r.desfasePago < -0.25
              ? 'Cada cliente tarda de media menos en pagar que en el histórico.'
              : 'Igual que en el histórico.',
      )
    const perdidos = (r: Resumen, detalle: boolean) =>
      bloque(
        'Clientes perdidos',
        String(r.perdidos),
        tono(r.perdidos > 0, false),
        !detalle
          ? `${formatear(r.eurosPerdidos, 0)} € sin cobrar`
          : r.perdidos
            ? `${formatear(r.eurosPerdidos, 0)} € sin cobrar: se cansaron de esperar en caja.`
            : 'Nadie dejó la compra en la fila.',
      )
    const atascos = (r: Resumen, detalle: boolean) =>
      bloque(
        'Parados en atascos',
        `${formatear(r.horasAtasco, 0)} h`,
        '',
        detalle ? `Entre todos los clientes del día: ${formatear(r.minutosAtasco)} min por cliente que compra.` : `${formatear(r.minutosAtasco)} min por cliente`,
      )
    const calor = boton(this.calor ? 'Ocultar mapa de calor' : 'Ver mapa de calor', 'secundario', () => {
      this.calor = !this.calor
      this.pintarResultado()
      this.op.alCambiar()
    }, Flame)

    const rB = this.b.sim!.resumen()
    if (!this.comparando) {
      this.resultado.replaceChildren(
        el('p', 'subtitulo', 'Resultado del día'),
        eficiencia(rB, true),
        perdidos(rB, true),
        atascos(rB, true),
        this.leyendaCalor(),
        calor,
      )
      return
    }
    const rA = this.a.sim!.resumen()
    const columnas = el('div', 'columnas-resultado')
    const col = (letra: string, r: Resumen) => {
      const c = el('div', 'columna-resultado')
      c.append(el('p', 'subtitulo', letra), eficiencia(r, false), perdidos(r, false), atascos(r, false))
      return c
    }
    columnas.append(col('A · versión A', rA), col('B · tienda actual', rB))
    this.resultado.replaceChildren(el('p', 'subtitulo', 'Resultado del día'), columnas, this.diferencia(rA, rB), this.leyendaCalor(), calor)
  }

  /** La frase que resume la comparación: qué gana (o pierde) B frente a A. */
  private diferencia(rA: Resumen, rB: Resumen) {
    const dMin = rB.desfasePago - rA.desfasePago
    const dPerdidos = rB.perdidos - rA.perdidos
    const dEuros = rB.eurosPerdidos - rA.eurosPerdidos
    const partes: string[] = []
    // Atascos: como proporción, que es como se entiende ("el doble", "4 veces").
    const veces = rA.horasAtasco > 0 ? rB.horasAtasco / rA.horasAtasco : 1
    if (veces >= 1.5) partes.push(`${formatear(veces)} veces más tiempo parado en atascos`)
    else if (veces <= 1 / 1.5 && rB.horasAtasco > 0) partes.push(`${formatear(1 / veces)} veces menos tiempo parado en atascos`)
    if (Math.abs(dMin) >= 0.1) partes.push(`${formatear(Math.abs(dMin))} min ${dMin < 0 ? 'menos' : 'más'} por cliente`)
    if (dPerdidos !== 0)
      partes.push(
        `${Math.abs(dPerdidos)} ${Math.abs(dPerdidos) === 1 ? 'cliente perdido' : 'clientes perdidos'} ${dPerdidos < 0 ? 'menos' : 'más'} (${formatear(Math.abs(dEuros), 0)} € ${dEuros < 0 ? 'más cobrados' : 'menos cobrados'})`,
      )
    const mejor = dMin < -0.1 || dPerdidos < 0 || veces <= 1 / 1.5
    const peor = dMin > 0.1 || dPerdidos > 0 || veces >= 1.5
    const p = el('p', `diferencia ${mejor && !peor ? 'bien' : peor && !mejor ? 'mal' : ''}`)
    p.textContent = partes.length ? `B frente a A: ${partes.join(' y ')}.` : 'B y A funcionan igual con este día.'
    return p
  }

  private leyendaCalor() {
    const l = el('div', 'leyenda-calor')
    l.hidden = !this.calor
    l.append(el('span', '', 'Poca espera'), el('span', 'degradado'), el('span', '', 'Mucha'))
    return l
  }

  /** Ajustes de la simulación: baños, probadores, cajas y trabajadores. Cambiar algo vuelve a empezar el día. */
  private construirAjustes() {
    const a = this.ajustes!
    const caja = el('details', 'ajustes-sim')
    caja.open = this.ajustesAbiertos
    caja.addEventListener('toggle', () => (this.ajustesAbiertos = caja.open))
    caja.append(el('summary', '', this.comparando ? 'Ajustes (los mismos para A y B)' : 'Ajustes'))
    const numero = (texto: string, id: string, valor: number, min: number, max: number, alCambiar: (v: number) => void) => {
      const fila = el('div', 'campo')
      const label = el('label', '', texto)
      const input = el('input')
      input.type = 'number'
      input.id = id
      input.min = String(min)
      input.max = String(max)
      input.step = '1'
      input.value = String(valor)
      label.htmlFor = id
      // Al confirmar (no a cada tecla): rehacer la simulación cuesta un momento.
      input.addEventListener('change', () => {
        const v = Math.min(max, Math.max(min, Math.round(Number(input.value) || 0)))
        input.value = String(v)
        alCambiar(v)
        this.reiniciar()
        this.refrescar()
      })
      fila.append(label, input)
      return fila
    }
    const pct = (x: number) => Math.round(x * 100)
    caja.append(
      el('p', 'subtitulo', 'Clientes'),
      numero('Usan los baños (%)', 'aj-banos', pct(a.banos), 0, 100, (v) => (a.banos = v / 100)),
      numero('Se prueban algo (%)', 'aj-probadores', pct(a.probadores), 0, 100, (v) => (a.probadores = v / 100)),
      numero('Vuelven a cambiarlo (%)', 'aj-vuelven', pct(a.vuelven), 0, 100, (v) => (a.vuelven = v / 100)),
      el('p', 'subtitulo', 'Cajas'),
      numero('Cajas con cajero', 'aj-cajas', a.cajas, 0, 30, (v) => (a.cajas = v)),
      numero('Autopagos', 'aj-autopagos', a.autopagos, 0, 30, (v) => (a.autopagos = v)),
      numero('Paciencia en caja (min)', 'aj-paciencia', a.pacienciaCaja, 1, 120, (v) => (a.pacienciaCaja = v)),
      el('p', 'subtitulo', 'Trabajadores por sección'),
    )
    for (const area of this.b.plan.areas.filter((x) => x.tipo === 'seccion'))
      caja.append(numero(area.nombre, `aj-t-${area.id}`, a.trabajadores[area.id] ?? 0, 0, 10, (v) => (a.trabajadores[area.id] = v)))
    return caja
  }

  private refrescar() {
    const sim = this.b.sim
    if (!sim) return
    this.reloj.textContent = hora(Math.min(sim.tiempo, sim.cierre + 3600))
    const rB = sim.resumen()
    const rA = this.comparando ? this.a.sim?.resumen() : undefined
    const fila = (nombre: string, valor: (r: Resumen) => string) => {
      const f = el('div', rA ? 'dato-sim doble' : 'dato-sim')
      f.append(el('span', '', nombre))
      if (rA) f.append(el('strong', '', valor(rA)))
      f.append(el('strong', '', valor(rB)))
      return f
    }
    const filas = [
      fila('Dentro ahora', (r) => String(r.dentro)),
      fila('Han comprado', (r) => String(r.hanComprado)),
      fila('Han salido sin comprar', (r) => String(r.sinComprar)),
      fila('Ventas', (r) => `${formatear(r.euros, 0)} €`),
      fila('Tiempo medio en tienda', (r) => `${formatear(r.minutosMedios)} min`),
      fila('Parados en atascos', (r) => `${formatear(r.minutosAtasco)} min`),
      fila('Esperando en caja', (r) => `${formatear(r.minutosFila)} min`),
      fila('En fila ahora', (r) => `${r.enFila.cajero} + ${r.enFila.autopago}`),
    ]
    if (rA) {
      const cabecera = el('div', 'dato-sim doble cabecera')
      cabecera.append(el('span', ''), el('strong', '', 'A'), el('strong', '', 'B'))
      filas.unshift(cabecera)
    }
    this.datos.replaceChildren(...filas)
    if (sim.enCola > 0) this.datos.append(fila('Esperando para entrar', () => String(sim.enCola)))

    const avisos: string[] = []
    if (rB.sinSitio.length) avisos.push(`Sin sitio en la tienda: ${rB.sinSitio.join(', ')}. Sus clientes se la saltan.`)
    if (rA?.sinSitio.length) avisos.push(`Sin sitio en la versión A: ${rA.sinSitio.join(', ')}.`)
    const fuera = this.b.nav!.sinSitioCajas
    if (fuera.cajas || fuera.autopagos)
      avisos.push(`No caben en la zona de Cajas: ${fuera.cajas} cajas y ${fuera.autopagos} autopagos (cada caja ocupa 2 m de ancho y cada autopago 1 m).`)
    this.aviso.hidden = avisos.length === 0
    this.aviso.textContent = avisos.join(' ')
  }
}
