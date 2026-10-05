import { Eye, EyeOff, Lock, LockOpen, Menu, Redo2, Undo2 } from 'lucide'
import type { Edicion } from './edicion'
import { superficie } from './geometria'
import { boton, el, formatear, lista, type Herramienta } from './herramienta'
import type { Historial } from './historial'
import { CAPAS, metrosLineal, NOMBRE_CAPA, type Plan } from './plan'

export interface Acciones {
  elegir(h: Herramienta): void
  nueva(): void
  abrir(): void
  guardar(): void
  deshacer(): void
  rehacer(): void
  escalar(m2: number): void
  /** Se ha tocado una capa (ojo o candado). */
  capas(): void
}

/**
 * Todo lo que es HTML alrededor del lienzo. Cada parte se reconstruye solo cuando cambia su clave;
 * si no, se refresca, para que los campos no pierdan el foco mientras se escribe.
 */
export class Interfaz {
  private barra = el('header', 'barra')
  private menu = el('div', 'menu')
  private botonDeshacer: HTMLButtonElement
  private botonRehacer: HTMLButtonElement
  private herramientasEl = el('nav', 'herramientas')
  private panel = el('aside', 'panel')
  private cuerpo = el('div', 'propiedades')
  private capasEl = el('div', 'capas')
  private estado = el('footer', 'estado')
  private pista = el('span')
  private m2 = el('strong')
  private resumen = el('p', 'dato')
  private claves = { herramientas: '', panel: '', capas: '' }

  private herramientas: Herramienta[]
  private plan: Plan
  private edicion: Edicion
  private historial: Historial
  private acciones: Acciones

  constructor(herramientas: Herramienta[], plan: Plan, edicion: Edicion, historial: Historial, acciones: Acciones) {
    this.herramientas = herramientas
    this.plan = plan
    this.edicion = edicion
    this.historial = historial
    this.acciones = acciones

    // Barra superior: menú, marca y deshacer/rehacer.
    const hamburguesa = boton('', 'icono', () => this.menu.classList.toggle('abierto'), Menu)
    hamburguesa.ariaLabel = 'Menú'
    hamburguesa.title = 'Menú'
    const opcion = (texto: string, accion: () => void) =>
      boton(texto, 'opcion-menu', () => {
        this.menu.classList.remove('abierto')
        accion()
      })
    this.menu.append(
      opcion('Nueva tienda', () => acciones.nueva()),
      opcion('Abrir archivo…', () => acciones.abrir()),
      opcion('Guardar archivo', () => acciones.guardar()),
    )
    document.addEventListener('pointerdown', (e) => {
      if (!(e.target instanceof Node) || !this.barra.contains(e.target)) this.menu.classList.remove('abierto')
    })
    this.botonDeshacer = boton('', 'icono', () => acciones.deshacer(), Undo2)
    this.botonDeshacer.title = 'Deshacer (Ctrl+Z)'
    this.botonDeshacer.ariaLabel = 'Deshacer'
    this.botonRehacer = boton('', 'icono', () => acciones.rehacer(), Redo2)
    this.botonRehacer.title = 'Rehacer (Ctrl+Y)'
    this.botonRehacer.ariaLabel = 'Rehacer'
    this.barra.append(hamburguesa, el('span', 'marca', 'Planta'), this.botonDeshacer, this.botonRehacer, this.menu)

    this.panel.append(this.cuerpo, el('p', 'subtitulo separado', 'Capas'), this.capasEl)
    this.estado.append(this.pista, el('span', 'suave', 'Rueda: zoom · Clic derecho: mover la vista'))
  }

  montar() {
    document.body.append(this.barra, this.herramientasEl, this.panel, this.estado)
  }

  /** Fuerza a reconstruirlo todo en el próximo `actualizar` (tras cargar o deshacer). */
  invalidar() {
    this.claves = { herramientas: '', panel: '', capas: '' }
  }

  actualizar(activa: Herramienta) {
    this.botonDeshacer.disabled = !this.historial.puedeDeshacer
    this.botonRehacer.disabled = !this.historial.puedeRehacer
    this.pista.textContent = activa.pista()

    const claveH = `${activa.id}|${!!this.plan.contorno}`
    if (claveH !== this.claves.herramientas) {
      this.claves.herramientas = claveH
      this.construirHerramientas(activa)
    }

    const claveC = JSON.stringify(this.plan.capas)
    if (claveC !== this.claves.capas) {
      this.claves.capas = claveC
      this.construirCapas()
    }

    // Manda la selección; si no hay, lo de la herramienta; si no tiene, los datos de la tienda.
    const sel = this.edicion.seleccion.length > 0
    const props = activa.propiedades
    const claveP = sel
      ? `sel|${this.edicion.clavePropiedades()}`
      : props
        ? `${activa.id}|${props.clave()}`
        : `tienda|${!!this.plan.contorno}`
    if (claveP !== this.claves.panel) {
      this.claves.panel = claveP
      // Si el foco estaba en un campo, se le devuelve tras reconstruir.
      const foco = document.activeElement instanceof HTMLInputElement ? document.activeElement.id : ''
      this.cuerpo.replaceChildren()
      if (sel) this.edicion.construirPropiedades(this.cuerpo)
      else if (props) props.construir(this.cuerpo)
      else this.construirTienda()
      if (foco) document.getElementById(foco)?.focus()
    }
    if (sel) this.edicion.refrescarPropiedades()
    else if (props) props.refrescar()
    else this.refrescarTienda()
  }

  private construirHerramientas(activa: Herramienta) {
    this.herramientasEl.replaceChildren()
    for (const h of this.herramientas) {
      const b = boton('', `icono${h === activa ? ' activa' : ''}`, () => this.acciones.elegir(h), h.icono)
      b.title = `${h.titulo} (${h.atajo})`
      b.ariaLabel = h.titulo
      b.disabled = h.necesitaContorno && !this.plan.contorno
      this.herramientasEl.append(b)
    }
  }

  private construirCapas() {
    this.capasEl.replaceChildren()
    for (const c of CAPAS) {
      const estado = this.plan.capas[c]
      const fila = el('div', 'capa')
      const ojo = boton('', `icono pequeno${estado.visible ? '' : ' apagado'}`, () => {
        estado.visible = !estado.visible
        this.acciones.capas()
      }, estado.visible ? Eye : EyeOff)
      ojo.title = estado.visible ? 'Ocultar' : 'Mostrar'
      const candado = boton('', `icono pequeno${estado.bloqueada ? ' encendido' : ''}`, () => {
        estado.bloqueada = !estado.bloqueada
        this.acciones.capas()
      }, estado.bloqueada ? Lock : LockOpen)
      candado.title = estado.bloqueada ? 'Desbloquear' : 'Bloquear'
      fila.append(el('span', 'nombre', NOMBRE_CAPA[c]), ojo, candado)
      this.capasEl.append(fila)
    }
  }

  private construirTienda() {
    const raiz = this.cuerpo
    raiz.append(el('p', 'subtitulo', 'Tienda'))
    if (!this.plan.contorno) {
      raiz.append(
        lista(['Dibuja el contorno con la herramienta Muro.', 'Clic para cada esquina y pincha en la primera para cerrar.']),
      )
      return
    }
    const sup = el('p', 'dato', 'Superficie ')
    sup.append(this.m2)
    raiz.append(sup, this.resumen)

    const form = el('form', 'escala')
    const label = el('label', '', 'm² reales de la tienda')
    const input = el('input')
    input.type = 'number'
    input.min = '1'
    input.step = '1'
    input.placeholder = 'p. ej. 3200'
    input.id = 'm2-reales'
    label.htmlFor = input.id
    form.append(label, input, el('button', 'primario', 'Ajustar escala'))
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      this.acciones.escalar(Number(input.value))
    })
    raiz.append(form)
  }

  private refrescarTienda() {
    const c = this.plan.contorno
    if (!c) return
    this.m2.textContent = `${formatear(superficie(c), 0)} m²`
    const n = this.plan.gondolas.length
    this.resumen.textContent = `${n} ${n === 1 ? 'góndola' : 'góndolas'} · ${formatear(metrosLineal(this.plan))} m de lineal`
  }
}
