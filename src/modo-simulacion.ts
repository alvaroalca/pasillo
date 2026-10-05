import { Pause, Play } from 'lucide'
import { Container, Graphics } from 'pixi.js'
import type { Camara } from './camara'
import { boton, el, formatear } from './herramienta'
import type { Plan } from './plan'
import { cargarHistorico, eurosDia, type Historico } from './sim/historico'
import { Navegacion } from './sim/navegacion'
import { ajustesIniciales, Simulacion, type Ajustes, type Cliente } from './sim/simulacion'
import { tema } from './tema'

/** Minutos de tienda por segundo real: ×1 es un minuto por segundo (una hora en un minuto). */
const VELOCIDADES = [1, 2, 5, 10]
const RADIO = 0.32 // m: una persona vista desde arriba, algo exagerada para que se vea
const RADIO_MIN_PX = 3 // de lejos, que no desaparezcan
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

/**
 * La tienda en marcha: reproduce un día del histórico sobre el plano actual. Mientras dura, no se edita.
 * Los clientes son puntos verdes (más claros los que no van a comprar, más oscuros pagando); el personal,
 * rojos. Las cajas y autopagos los coloca la simulación en la zona de Cajas según los Ajustes.
 */
export class ModoSimulacion {
  readonly vista = new Container()
  readonly panel = el('aside', 'panel panel-sim')
  private g = new Graphics()
  private historico: Historico | null = null
  private sim: Simulacion | null = null
  private nav: Navegacion | null = null
  private dia = 0
  private desde = 10
  private velocidad = 1
  private ajustes: Ajustes | null = null
  /** Con qué cajas se construyó la navegación: si cambian, hay que rehacerla. */
  private cajasNav = ''
  private ajustesAbiertos = false
  private enMarcha = false
  private ultimo = 0
  private datos = el('div', 'datos-sim')
  private reloj = el('div', 'reloj')
  private aviso = el('p', 'aviso')
  private botonPlay: HTMLButtonElement | null = null
  private plan: Plan
  private alCambiar: () => void

  constructor(plan: Plan, alCambiar: () => void) {
    this.plan = plan
    this.alCambiar = alCambiar
    this.vista.addChild(this.g)
  }

  /** Prepara la simulación con la tienda tal como está. Devuelve un mensaje si no se puede. */
  async entrar(): Promise<string | null> {
    this.historico ??= await cargarHistorico()
    if (!this.historico) return 'No se ha podido leer el histórico de ventas.'
    if (!this.plan.contorno) return 'Dibuja primero la tienda.'
    // Los ajustes se conservan entre visitas; las secciones nuevas entran con un trabajador.
    const base = ajustesIniciales(this.plan)
    this.ajustes = this.ajustes
      ? { ...this.ajustes, trabajadores: { ...base.trabajadores, ...this.soloSecciones(this.ajustes.trabajadores) } }
      : base
    this.cajasNav = ''
    this.prepararNavegacion()
    if (!this.nav!.entradas.length) return 'La tienda necesita al menos una puerta de Entrada en la fachada.'
    this.reiniciar()
    this.construirPanel()
    return null
  }

  salir() {
    this.enMarcha = false
    this.sim = null
    this.g.clear()
  }

  /** Quita del reparto de trabajadores las secciones que ya no existen. */
  private soloSecciones(t: Record<number, number>) {
    const ids = new Set(this.plan.areas.filter((a) => a.tipo === 'seccion').map((a) => a.id))
    return Object.fromEntries(Object.entries(t).filter(([id]) => ids.has(Number(id))))
  }

  /** La navegación depende de cuántas cajas hay (sus mostradores no se pisan): se rehace solo si cambian. */
  private prepararNavegacion() {
    const a = this.ajustes!
    const clave = `${a.cajas}|${a.autopagos}`
    if (clave === this.cajasNav && this.nav) return
    this.nav = new Navegacion(this.plan, { cajas: a.cajas, autopagos: a.autopagos })
    this.cajasNav = clave
  }

  /** Vuelve a empezar el día elegido y lo adelanta, sin pintar, hasta la hora de inicio. */
  private reiniciar() {
    const h = this.historico!
    this.prepararNavegacion()
    this.sim = new Simulacion(this.plan, this.nav!, h, h.dias[this.dia], this.ajustes!)
    const adelanto = this.desde * 3600 - this.sim.tiempo
    if (adelanto > 0) this.sim.avanzar(adelanto)
    this.alCambiar()
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
    if (!this.enMarcha || !this.sim) return
    const real = Math.min(0.1, (ahora - this.ultimo) / 1000)
    this.ultimo = ahora
    this.sim.avanzar(Math.min(MAX_POR_FOTOGRAMA, real * this.velocidad * 60))
    if (this.sim.tiempo >= this.sim.cierre + 1800 && this.sim.resumen().dentro === 0) {
      this.enMarcha = false
      this.construirPanel()
    }
    this.alCambiar()
    if (this.enMarcha) requestAnimationFrame((t) => this.bucle(t))
  }

  /** Pinta los clientes. La vista va en metros y sigue a la cámara. */
  dibujar(cam: Camara) {
    this.vista.position.set(cam.x, cam.y)
    this.vista.scale.set(cam.zoom)
    const g = this.g
    g.clear()
    const sim = this.sim
    if (!sim) return
    const nav = this.nav!
    const radio = Math.max(RADIO, RADIO_MIN_PX / cam.zoom)
    const celda = 0.5
    // Mostradores y terminales de autopago, y los cajeros detrás de sus cajas.
    for (const p of nav.puestos) {
      for (const k of p.mueble) {
        const c = nav.centro(k)
        g.roundRect(c.x - celda / 2 + 0.05, c.y - celda / 2 + 0.05, celda - 0.1, celda - 0.1, 0.08).fill({ color: tema.gondola })
        if (p.tipo === 'autopago') g.rect(c.x - 0.12, c.y - 0.12, 0.24, 0.24).fill({ color: tema.acento })
      }
      if (p.cajero !== null) {
        const c = nav.centro(p.cajero)
        g.circle(c.x, c.y, radio).fill({ color: tema.trabajador })
      }
    }
    const color = (c: Cliente) => (!c.compra ? tema.clienteMirando : c.fase === 'pagando' ? tema.clientePagando : tema.cliente)
    for (const c of sim.clientes) {
      if (c.fase === 'ido') continue
      const p = sim.posicion(c)
      g.circle(p.x, p.y, radio).fill({ color: color(c) })
    }
    for (const t of sim.personal) {
      const p = sim.posicion(t)
      g.circle(p.x, p.y, radio).fill({ color: tema.trabajador })
    }
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
    this.botonPlay = boton(this.enMarcha ? 'Pausa' : 'Reproducir', 'primario', () => this.alternar(), this.enMarcha ? Pause : Play)
    controles.append(this.botonPlay)
    const velocidades = el('div', 'opciones')
    for (const v of VELOCIDADES)
      velocidades.append(
        boton(`×${v}`, `opcion${v === this.velocidad ? ' activa' : ''}`, () => {
          this.velocidad = v
          this.construirPanel()
        }),
      )

    this.panel.append(
      el('p', 'subtitulo', 'Simulación'),
      filaDia,
      filaDesde,
      this.reloj,
      controles,
      el('p', 'subtitulo', 'Velocidad (minutos de tienda por segundo)'),
      velocidades,
      this.datos,
      this.aviso,
      this.construirAjustes(),
      el('p', 'atajos', 'Cada ticket del día es un cliente que compra; el resto de la gente que entra solo mira. Mismo día, misma gente: lo que cambia es la tienda.'),
    )
    this.refrescar()
  }

  /** Ajustes de la simulación: baños, probadores, cajas y trabajadores. Cambiar algo vuelve a empezar el día. */
  private construirAjustes() {
    const a = this.ajustes!
    const caja = el('details', 'ajustes-sim')
    caja.open = this.ajustesAbiertos
    caja.addEventListener('toggle', () => (this.ajustesAbiertos = caja.open))
    caja.append(el('summary', '', 'Ajustes'))
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
      el('p', 'subtitulo', 'Trabajadores por sección'),
    )
    for (const area of this.plan.areas.filter((x) => x.tipo === 'seccion'))
      caja.append(numero(area.nombre, `aj-t-${area.id}`, a.trabajadores[area.id] ?? 0, 0, 10, (v) => (a.trabajadores[area.id] = v)))
    return caja
  }

  private refrescar() {
    const sim = this.sim
    if (!sim) return
    this.reloj.textContent = hora(Math.min(sim.tiempo, sim.cierre + 3600))
    const r = sim.resumen()
    const fila = (nombre: string, valor: string) => {
      const f = el('div', 'dato-sim')
      f.append(el('span', '', nombre), el('strong', '', valor))
      return f
    }
    this.datos.replaceChildren(
      fila('Dentro ahora', String(r.dentro)),
      fila('Han comprado', String(r.hanComprado)),
      fila('Han salido sin comprar', String(r.sinComprar)),
      fila('Ventas', `${formatear(r.euros, 0)} €`),
      fila('Tiempo medio en tienda', `${formatear(r.minutosMedios)} min`),
      fila('Parados en atascos', `${formatear(r.minutosAtasco)} min de media`),
      fila('Esperando en caja', `${formatear(r.minutosFila)} min de media`),
      fila('En fila ahora', `${r.enFila.cajero} cajas · ${r.enFila.autopago} autopago`),
    )
    if (sim.enCola > 0) this.datos.append(fila('Esperando para entrar', String(sim.enCola)))
    const avisos: string[] = []
    if (r.sinSitio.length) avisos.push(`Sin sitio en la tienda: ${r.sinSitio.join(', ')}. Sus clientes se la saltan.`)
    const fuera = this.nav!.sinSitioCajas
    if (fuera.cajas || fuera.autopagos)
      avisos.push(`No caben en la zona de Cajas: ${fuera.cajas} cajas y ${fuera.autopagos} autopagos (cada caja ocupa 2 m de ancho y cada autopago 1 m).`)
    this.aviso.hidden = avisos.length === 0
    this.aviso.textContent = avisos.join(' ')
  }
}
