import '@fontsource/nunito/600.css'
import '@fontsource/nunito/800.css'
import { Application, Graphics } from 'pixi.js'
import { abrir, cargarDemo, cargarLocal, descargar, deserializar, guardarLocal } from './archivo'
import { Camara } from './camara'
import { Edicion } from './edicion'
import { caja } from './geometria'
import type { Contexto, Elemento, Herramienta, Mods, Seleccion } from './herramienta'
import { HerramientaCabecera } from './herramienta-cabecera'
import { HerramientaGondola } from './herramienta-gondola'
import { HerramientaMuro } from './herramienta-muro'
import { HerramientaPieza } from './herramienta-pieza'
import { HerramientaPincel, type EstadoPincel } from './herramienta-pincel'
import { HerramientaPuerta } from './herramienta-puerta'
import { HerramientaSeleccionar } from './herramienta-seleccionar'
import { Historial } from './historial'
import { Interfaz } from './interfaz'
import { escalarPlan, planVacio, type Capa, type Plan } from './plan'
import { Plano } from './plano'
import { dibujarRejilla } from './rejilla'
import { tema } from './tema'
import './style.css'

await document.fonts.load('800 12px Nunito')

const app = new Application()
await app.init({
  resizeTo: window,
  antialias: true,
  background: tema.exterior,
  resolution: window.devicePixelRatio,
  autoDensity: true,
})
const lienzo = app.canvas
document.querySelector<HTMLDivElement>('#app')!.appendChild(lienzo)

const cam = new Camara()
cam.x = window.innerWidth / 2
cam.y = window.innerHeight / 2

// La primera vez (nada guardado en este navegador) se abre la tienda demo.
const plan = cargarLocal() ?? (await cargarDemo()) ?? planVacio()
const historial = new Historial(plan)

const ctx: Contexto = {
  cam,
  plan,
  cambio: () => pedirDibujo(),
  seleccionar: (s: Seleccion) => {
    edicion.seleccion = s ? [s] : []
    pedirDibujo()
  },
}

const rejilla = new Graphics()
const plano = new Plano(cam, plan)
const edicion = new Edicion(ctx)
const pincel: EstadoPincel = { forma: 'pincel', tamano: 4, area: null }

const herramientas: Herramienta[] = [
  new HerramientaSeleccionar(edicion),
  new HerramientaMuro(ctx),
  new HerramientaPuerta(ctx),
  new HerramientaGondola(ctx),
  new HerramientaCabecera(ctx),
  new HerramientaPieza(ctx, 'cubo'),
  new HerramientaPieza(ctx, 'expo'),
  new HerramientaPincel(ctx, plano.pintura, pincel, false),
  new HerramientaPincel(ctx, plano.pintura, pincel, true),
]
const herramienta = (id: Herramienta['id']) => herramientas.find((h) => h.id === id)!
let activa = herramienta(plan.contorno ? 'seleccionar' : 'muro')
app.stage.addChild(rejilla, plano.vista, ...herramientas.map((h) => h.vista), edicion.vista)

function elegir(h: Herramienta) {
  if (h === activa || (h.necesitaContorno && !plan.contorno)) return
  activa.salir()
  activa = h
  edicion.sobre = null
  pedirDibujo()
}

function encuadrar() {
  if (plan.contorno) cam.encuadrar(caja(plan.contorno), window.innerWidth, window.innerHeight)
  pedirDibujo()
}

/** Sustituye la tienda en pantalla por otra. El objeto `plan` es el mismo: todos lo tienen referenciado. */
function cargar(nuevo: Plan, { encuadre = true } = {}) {
  for (const h of herramientas) h.salir()
  edicion.seleccion = []
  edicion.sobre = null
  const version = plan.version
  Object.assign(plan, nuevo)
  plan.version = version + 1
  if (!plan.contorno) activa = herramienta('muro')
  interfaz.invalidar()
  if (encuadre) encuadrar()
  else pedirDibujo()
}

function deshacer() {
  const texto = historial.deshacer()
  if (texto) cargar(deserializar(texto), { encuadre: false })
}

function rehacer() {
  const texto = historial.rehacer()
  if (texto) cargar(deserializar(texto), { encuadre: false })
}

const interfaz = new Interfaz(herramientas, plan, edicion, historial, {
  elegir,
  nueva: () => {
    const hayAlgo = plan.contorno || plan.celdas.size > 0
    if (hayAlgo && !confirm('Se borrará la tienda actual (se puede deshacer). ¿Seguir?')) return
    cargar(planVacio())
    historial.confirmar(plan)
  },
  demo: async () => {
    const demo = await cargarDemo()
    if (!demo) return alert('No se ha podido cargar la tienda demo.')
    if (plan.contorno && !confirm('Se sustituirá la tienda actual por la demo (se puede deshacer). ¿Seguir?')) return
    cargar(demo)
    historial.confirmar(plan)
  },
  abrir: () =>
    abrir()
      .then((nuevo) => {
        if (!nuevo) return
        cargar(nuevo)
        historial.confirmar(plan)
      })
      .catch((e: Error) => alert(e.message)),
  guardar: () => descargar(plan),
  deshacer,
  rehacer,
  escalar: (m2) => {
    escalarPlan(plan, m2)
    historial.confirmar(plan)
    encuadrar()
  },
  capas: () => {
    // Lo que queda oculto no puede seguir seleccionado.
    const capa = (e: Elemento): Capa => (e.tipo === 'puerta' ? 'puertas' : e.tipo === 'muro' ? 'muros' : 'gondolas')
    edicion.seleccion = edicion.seleccion.filter((e) => plan.capas[capa(e)].visible)
    pedirDibujo()
  },
})
interfaz.montar()

// Se repinta solo cuando algo cambia, una vez por frame como mucho.
let pendiente = false
function pedirDibujo() {
  if (pendiente) return
  pendiente = true
  requestAnimationFrame(() => {
    pendiente = false
    dibujarRejilla(rejilla, cam, window.innerWidth, window.innerHeight)
    plano.dibujar()
    for (const h of herramientas) {
      h.vista.visible = h === activa
      if (h === activa) h.dibujar()
    }
    edicion.dibujar(activa.id === 'seleccionar' || activa.id === 'muro')
    interfaz.actualizar(activa)
    lienzo.style.cursor = moviendo ? 'grabbing' : (edicion.cursorCss ?? activa.cursorCss)
    programarGuardado()
  })
}

// Guardado automático y foto para deshacer, un momento después del último cambio
// (no a mitad de un arrastre: la foto sería de una posición intermedia).
let temporizador = 0
function programarGuardado() {
  clearTimeout(temporizador)
  temporizador = window.setTimeout(() => {
    if (pulsadoEn) return
    historial.confirmar(plan)
    guardarLocal(plan)
    interfaz.actualizar(activa)
  }, 400)
}

// Quién se quedó el clic: la edición de algo existente o la herramienta activa.
let pulsadoEn: 'edicion' | 'herramienta' | null = null
let moviendo = false
let espacio = false
let ultimo = { x: 0, y: 0 }

lienzo.addEventListener('contextmenu', (e) => e.preventDefault())

lienzo.addEventListener('pointerdown', (e) => {
  lienzo.setPointerCapture(e.pointerId)
  if (e.button === 1 || e.button === 2 || (e.button === 0 && espacio)) {
    moviendo = true
    ultimo = { x: e.offsetX, y: e.offsetY }
  } else if (e.button === 0) {
    const mods = modsDe(e)
    if (edicion.sobre) {
      pulsadoEn = 'edicion'
      edicion.pulsar(mods)
    } else {
      pulsadoEn = 'herramienta'
      activa.pulsar(mods)
    }
  }
  pedirDibujo()
})

lienzo.addEventListener('pointermove', (e) => {
  const pantalla = { x: e.offsetX, y: e.offsetY }
  if (moviendo) {
    cam.x += pantalla.x - ultimo.x
    cam.y += pantalla.y - ultimo.y
    ultimo = pantalla
    pedirDibujo()
    return
  }
  apuntar(pantalla, modsDe(e))
})

function modsDe(e: MouseEvent | KeyboardEvent): Mods {
  return { alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }
}

/** El ratón está en `pantalla` (o la vista se ha movido bajo él): a quién le toca. */
function apuntar(pantalla: { x: number; y: number }, mods: Mods) {
  const raton = cam.aMundo(pantalla.x, pantalla.y)
  if (pulsadoEn === 'edicion') {
    edicion.mover(raton, mods)
  } else if (pulsadoEn === 'herramienta' || activa.ocupada() || activa.pintaEncima) {
    // La herramienta tiene el control: nada de coger objetos por el camino.
    edicion.sobre = null
    activa.mover(raton, pantalla, mods)
  } else {
    edicion.apuntar(raton)
    const antes = edicion.sobre
    edicion.sobre = edicion.buscar(raton, pantalla, activa.id === 'seleccionar', !!activa.sobreMuros, !!activa.sobreGondolas)
    if (edicion.sobre) activa.salir()
    else activa.mover(raton, pantalla, mods)
    if (antes !== edicion.sobre) pedirDibujo()
  }
}

lienzo.addEventListener('pointerup', () => {
  moviendo = false
  if (pulsadoEn === 'edicion') edicion.soltar()
  if (pulsadoEn === 'herramienta') activa.soltar()
  pulsadoEn = null
  historial.confirmar(plan)
  pedirDibujo()
})

// Doble clic: termina el muro que se está dibujando o, sobre un muro, le añade una esquina.
lienzo.addEventListener('dblclick', (e) => {
  if (activa.dobleClic?.()) {
    pedirDibujo()
    return
  }
  if (activa.pintaEncima || activa.sobreMuros) return
  if (edicion.anadirEsquina(cam.aMundo(e.offsetX, e.offsetY), { x: e.offsetX, y: e.offsetY })) {
    historial.confirmar(plan)
    pedirDibujo()
  }
})

lienzo.addEventListener('pointerleave', () => {
  if (pulsadoEn || moviendo) return
  edicion.sobre = null
  activa.salir()
  pedirDibujo()
})

lienzo.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    cam.zoomEn(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015))
    apuntar({ x: e.offsetX, y: e.offsetY }, modsDe(e))
    pedirDibujo()
  },
  { passive: false },
)

/** Las teclas que no son de la herramienta activa. Devuelve true si ha usado la tecla. */
function teclaGeneral(e: KeyboardEvent): boolean {
  const ctrl = e.ctrlKey || e.metaKey
  // Esc suelta la herramienta y vuelve a Seleccionar, que es la de por defecto; ya en Seleccionar, quita la selección.
  if (e.code === 'Escape' && activa.id !== 'seleccionar' && plan.contorno) elegir(herramienta('seleccionar'))
  else if (ctrl && e.code === 'KeyZ') (e.shiftKey ? rehacer : deshacer)()
  else if (ctrl && e.code === 'KeyY') rehacer()
  // Ctrl+D también evita que el navegador abra "añadir a marcadores".
  else if (ctrl && e.code === 'KeyD') edicion.duplicar()
  else if (!ctrl && !e.altKey && ATAJOS[e.code]) elegir(herramienta(ATAJOS[e.code]))
  else return !ctrl && edicion.tecla(e)
  return true
}

const ATAJOS: Record<string, Herramienta['id']> = {
  KeyV: 'seleccionar',
  KeyM: 'muro',
  KeyP: 'puerta',
  KeyG: 'gondola',
  KeyC: 'cabecera',
  KeyU: 'cubo',
  KeyX: 'expo',
  KeyB: 'pincel',
  KeyE: 'goma',
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  if (e.code === 'Space') {
    espacio = true
    e.preventDefault()
    return
  }
  // Alt suelto enfoca la barra de menús en algunos navegadores; aquí sirve para duplicar.
  if (e.key === 'Alt') e.preventDefault()

  if (activa.tecla(e) || teclaGeneral(e)) {
    e.preventDefault()
    pedirDibujo()
  }
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') espacio = false
})
window.addEventListener('resize', () => pedirDibujo())

if (plan.contorno) encuadrar()
pedirDibujo()
