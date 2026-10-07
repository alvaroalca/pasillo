import '@fontsource/nunito/600.css'
import '@fontsource/nunito/800.css'
// La CSP del portfolio no admite eval: PixiJS genera sus sombreadores sin él.
import 'pixi.js/unsafe-eval'
import { Application, Container, Graphics } from 'pixi.js'
import {
  abrir,
  cargarDemo,
  cargarLocal,
  cargarVersionA,
  descargar,
  deserializar,
  guardarLocal,
  guardarVersionA,
  serializar,
} from './archivo'
import { Camara } from './camara'
import { Edicion } from './edicion'
import { caja } from './geometria'
import { el, type Contexto, type Elemento, type Herramienta, type Mods, type Seleccion } from './herramienta'
import { HerramientaCabecera } from './herramienta-cabecera'
import { HerramientaGondola } from './herramienta-gondola'
import { HerramientaMuro } from './herramienta-muro'
import { HerramientaPieza } from './herramienta-pieza'
import { HerramientaPincel, type EstadoPincel } from './herramienta-pincel'
import { HerramientaPuerta } from './herramienta-puerta'
import { HerramientaSeleccionar } from './herramienta-seleccionar'
import { Historial } from './historial'
import { Interfaz } from './interfaz'
import { ModoSimulacion } from './modo-simulacion'
import { escalarPlan, planVacio, type Capa, type Plan } from './plan'
import { Plano } from './plano'
import { cargarHistorico, seccionesPorVentas } from './sim/historico'
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

// Versión A: la foto de la tienda con la que se compara en la simulación (pantalla partida, A a la izquierda).
// Tiene su propia cámara, que es la de B desplazada media pantalla.
const guardadaA = cargarVersionA()
const planA = guardadaA ?? planVacio()
let hayVersionA = guardadaA !== null
const camA = new Camara()
const rejillaA = new Graphics()
const planoA = new Plano(camA, planA)
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
// Los nombres de sección posibles son los del histórico: sin él, se escriben a mano.
cargarHistorico().then((h) => {
  if (!h) return
  const catalogo = seccionesPorVentas(h)
  for (const p of herramientas) if (p instanceof HerramientaPincel) p.catalogo = catalogo
  pedirDibujo()
})
let activa = herramienta(plan.contorno ? 'seleccionar' : 'muro')
let comparando = false
const simulacion = new ModoSimulacion(plan, planA, {
  alCambiar: () => pedirDibujo(),
  hayVersionA: () => hayVersionA,
  alComparar: (si) => {
    comparando = si
    encuadrar()
  },
})
let simulando = false

// Dos mitades recortadas: A a la izquierda (solo al comparar) y B, la tienda actual, a la derecha o en toda la pantalla.
const mitadA = new Container()
const mitadB = new Container()
const mascaraA = new Graphics()
const mascaraB = new Graphics()
const separador = new Graphics()
mitadA.addChild(rejillaA, planoA.vista, simulacion.a.vista)
mitadB.addChild(rejilla, plano.vista, simulacion.b.vista)
app.stage.addChild(mitadA, mitadB, mascaraA, mascaraB, separador, ...herramientas.map((h) => h.vista), edicion.vista)
const rotuloA = el('div', 'rotulo-mitad', 'A · versión A')
const rotuloB = el('div', 'rotulo-mitad', 'B · tienda actual')
document.body.append(rotuloA, rotuloB)

/** Ancho de la zona de la tienda a la izquierda del panel de la simulación, y dónde se parte en dos. */
const PANEL = 330
const BARRA = 80
const mitad = () => (window.innerWidth - PANEL) / 2
const partida = () => simulando && comparando

/** La cámara de A es la de B desplazada media pantalla: moverse o hacer zoom afecta a las dos igual. */
function seguirCamaraA() {
  camA.zoom = cam.zoom
  camA.x = cam.x - mitad()
  camA.y = cam.y
}

function elegir(h: Herramienta) {
  if (h === activa || (h.necesitaContorno && !plan.contorno)) return
  activa.salir()
  activa = h
  edicion.sobre = null
  // El panel enseña primero lo seleccionado: si se quedara, la herramienta nueva no enseñaría lo suyo
  // (el pincel, sus secciones) y parecería que no ha cambiado. Con Seleccionar sí se conserva.
  if (h.id !== 'seleccionar') edicion.seleccion = []
  pedirDibujo()
}

function encuadrar() {
  if (partida()) {
    // Las dos tiendas en su mitad, a la misma escala: la caja que abarca a las dos, en media pantalla.
    const puntos = [...(plan.contorno ?? []), ...(planA.contorno ?? [])]
    if (puntos.length) cam.encuadrar(caja(puntos), mitad(), window.innerHeight, 0, 0.06)
    cam.x += mitad()
  } else if (plan.contorno) {
    // La tienda entera a la vista, sin quedar debajo de los paneles: el de la derecha siempre y,
    // en el editor, también la barra de herramientas de la izquierda.
    const izquierda = simulando ? 0 : BARRA
    cam.encuadrar(caja(plan.contorno), window.innerWidth - izquierda - PANEL, window.innerHeight, izquierda, 0.08)
  }
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
  fijarA: () => {
    fijarVersionA(deserializar(serializar(plan)))
    alert('Versión A fijada. Cambia la tienda y, en Simular, compárala con esta versión.')
  },
  abrirA: () =>
    abrir()
      .then((nuevo) => {
        if (!nuevo) return
        fijarVersionA(nuevo)
        alert('Archivo abierto como versión A. En Simular puedes compararlo con la tienda actual.')
      })
      .catch((e: Error) => alert(e.message)),
  deshacer,
  rehacer,
  escalar: (m2) => {
    escalarPlan(plan, m2)
    historial.confirmar(plan)
    encuadrar()
  },
  simular: async () => {
    if (simulando) {
      simulacion.salir()
      simulando = false
    } else {
      activa.salir()
      edicion.seleccion = []
      edicion.sobre = null
      const problema = await simulacion.entrar()
      if (problema) return alert(problema)
      simulando = true
    }
    interfaz.modoSimulacion(simulando)
    encuadrar()
  },
  capas: () => {
    // Lo que queda oculto no puede seguir seleccionado.
    const capa = (e: Elemento): Capa => (e.tipo === 'puerta' ? 'puertas' : e.tipo === 'muro' ? 'muros' : 'gondolas')
    edicion.seleccion = edicion.seleccion.filter((e) => plan.capas[capa(e)].visible)
    pedirDibujo()
  },
})
interfaz.montar(simulacion.panel)

/** Guarda la versión A en el navegador y la pone en su plano (el objeto `planA` es el mismo: todos lo tienen). */
function fijarVersionA(nuevo: Plan) {
  const version = planA.version
  Object.assign(planA, nuevo)
  planA.version = version + 1
  hayVersionA = true
  guardarVersionA(planA)
}

/** Recorta las dos mitades y coloca separador y rótulos (o lo quita todo si no se compara). */
function colocarMitades() {
  const ancho = window.innerWidth
  const alto = window.innerHeight
  const m = mitad()
  const si = partida()
  mitadA.visible = si
  separador.clear()
  rotuloA.hidden = !si
  rotuloB.hidden = !si
  mascaraA.clear()
  mascaraB.clear()
  if (!si) {
    mitadB.mask = null
    return
  }
  mascaraA.rect(0, 0, m, alto).fill({ color: 0xffffff })
  mascaraB.rect(m, 0, ancho - m, alto).fill({ color: 0xffffff })
  mitadA.mask = mascaraA
  mitadB.mask = mascaraB
  separador.moveTo(m, 0).lineTo(m, alto).stroke({ width: 2, color: tema.muro, alpha: 0.35 })
  rotuloA.style.left = `${m / 2}px`
  rotuloB.style.left = `${m * 1.5}px`
}

// Se repinta solo cuando algo cambia, una vez por frame como mucho.
let pendiente = false
function pedirDibujo() {
  if (pendiente) return
  pendiente = true
  requestAnimationFrame(() => {
    pendiente = false
    dibujarRejilla(rejilla, cam, window.innerWidth, window.innerHeight)
    plano.dibujar()
    colocarMitades()
    if (partida()) {
      seguirCamaraA()
      dibujarRejilla(rejillaA, camA, window.innerWidth, window.innerHeight)
      planoA.dibujar()
    }
    if (simulando) {
      // Simulando no se edita: fuera herramientas y selección, dentro los clientes.
      for (const h of herramientas) h.vista.visible = false
      edicion.vista.visible = false
      simulacion.dibujar(camA, cam)
      lienzo.style.cursor = moviendo ? 'grabbing' : 'grab'
      return
    }
    edicion.vista.visible = true
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
  // Simulando, el clic izquierdo también arrastra la vista: no hay nada que editar.
  if (e.button === 1 || e.button === 2 || (e.button === 0 && (espacio || simulando))) {
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
  if (simulando) return
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
  if (simulando) return
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
    // En la mitad de A, el punto bajo el ratón es el de la cámara de B desplazado media pantalla.
    const x = partida() && e.offsetX < mitad() ? e.offsetX + mitad() : e.offsetX
    cam.zoomEn(x, e.offsetY, Math.exp(-e.deltaY * 0.0015))
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
  if (simulando) return

  if (activa.tecla(e) || teclaGeneral(e)) {
    e.preventDefault()
    pedirDibujo()
  }
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') espacio = false
})
window.addEventListener('resize', () => (partida() ? encuadrar() : pedirDibujo()))

if (plan.contorno) encuadrar()
pedirDibujo()
