import { Copy, Lock, LockOpen, RotateCw, Trash2 } from 'lucide'
import { Container, Graphics } from 'pixi.js'
import { ajustarARejilla, CELDA, distancia, proyectar, segmentoEnRect, type Vec } from './geometria'
import { etiquetaLargo } from './herramienta-gondola'
import { selectorTipo } from './herramienta-puerta'
import { boton, campoNumero, el, formatear, vaciar, type Contexto, type Elemento, type Mods } from './herramienta'
import { dibujarGuias, imanar, type Guia } from './iman'
import {
  carasDe,
  colocarPuerta,
  copiarGondola,
  editable,
  gondolaEn,
  gondolaValida,
  huellaGondola,
  LARGO_MIN_GONDOLA,
  NOMBRE_PIEZA,
  nuevoId,
  piezaEn,
  piezaValida,
  rectGondola,
  tramos,
  type Capa,
  type ExtremoGondola,
  type Gondola,
  type MuroInterior,
  type Pieza,
  type Plan,
  type Puerta,
  type Rect,
} from './plan'
import { COLOR_PUERTA } from './plano'
import { tema } from './tema'

const RADIO = 10 // px para coger una esquina, un extremo, una puerta o un muro
const PASILLO = 2 // m entre el original y la copia de Ctrl+D

type Extremo = ExtremoGondola
type Objeto = Gondola | Puerta | MuroInterior | Pieza

/** Lo que hay bajo el ratón y se puede coger. */
export type Objetivo =
  /** Esquina del contorno (`muro` null) o de un muro interior. */
  | { tipo: 'esquina'; muro: MuroInterior | null; i: number }
  | { tipo: 'puerta'; obj: Puerta; extremo?: 'a' | 'b' }
  | { tipo: 'gondola'; obj: Gondola; extremo?: Extremo }
  | { tipo: 'muro'; obj: MuroInterior }
  | { tipo: 'pieza'; obj: Pieza }

type Arrastre =
  | { tipo: 'esquina'; muro: MuroInterior | null; i: number }
  | { tipo: 'ancho'; obj: Puerta; fijo: Vec; u: Vec; largoMuro: number }
  | { tipo: 'estirar'; obj: Gondola; extremo: Extremo; fijo: number }
  /** Mover lo seleccionado. El ancla es lo que se cogió: manda el ajuste y el imán. Origen: posiciones de partida. */
  | { tipo: 'grupo'; ancla: Elemento; inicio: Vec; origenes: Map<Objeto, Vec[]> }

const capaDe = (e: Elemento): Capa => (e.tipo === 'puerta' ? 'puertas' : e.tipo === 'muro' ? 'muros' : 'gondolas')
const esGondola = (o: Objeto): o is Gondola => 'largo' in o
const esMuro = (o: Objeto): o is MuroInterior => 'puntos' in o
const esPieza = (o: Objeto): o is Pieza => 'w' in o

function elementoDe(o: Exclude<Objetivo, { tipo: 'esquina' }>): Elemento {
  if (o.tipo === 'puerta') return { tipo: 'puerta', obj: o.obj }
  if (o.tipo === 'gondola') return { tipo: 'gondola', obj: o.obj }
  if (o.tipo === 'pieza') return { tipo: 'pieza', obj: o.obj }
  return { tipo: 'muro', obj: o.obj }
}

/** Todo el mueble salvo lo que se está moviendo: contra eso se imanta. */
function mueblesQuietos(plan: Plan, moviendo: (o: Objeto) => boolean): Rect[] {
  return [...plan.gondolas.filter((g) => !moviendo(g)).flatMap(huellaGondola), ...plan.piezas.filter((p) => !moviendo(p))]
}

/**
 * Edición de lo que ya existe, sea cual sea la herramienta: pasar por encima, seleccionar (uno o varios),
 * mover, estirar, girar, duplicar, bloquear y borrar. Lo bloqueado solo se puede seleccionar
 * (con la herramienta Seleccionar) para desbloquearlo.
 */
export class Edicion {
  seleccion: Elemento[] = []
  sobre: Objetivo | null = null
  readonly vista = new Container()

  private arrastre: Arrastre | null = null
  private recuadro: { origen: Vec; fin: Vec; sumar: boolean } | null = null
  private guias: Guia[] = []
  private raton: Vec = { x: 0, y: 0 }
  private g = new Graphics()
  private etiquetas = new Container()
  private aviso = el('p', 'aviso', 'Se sale de la tienda, atraviesa un muro o pisa otro mueble.')
  private inputLargo: HTMLInputElement | null = null
  private ctx: Contexto

  constructor(ctx: Contexto) {
    this.ctx = ctx
    this.vista.addChild(this.g, this.etiquetas)
  }

  get arrastrando() {
    return this.arrastre !== null
  }

  /** El único seleccionado, o null si hay cero o varios. */
  get unico(): Elemento | null {
    return this.seleccion.length === 1 ? this.seleccion[0] : null
  }

  private seleccionado(obj: Objeto) {
    return this.seleccion.some((e) => e.obj === obj)
  }

  private libre(e: Elemento) {
    return editable(this.ctx.plan, capaDe(e), e.obj)
  }

  /**
   * Qué hay bajo el ratón. Con `incluirBloqueados` también lo que tiene candado (para poder quitárselo).
   * Con `sinMuros` los muros y sus esquinas no se cogen (Muro y Puerta trabajan sobre ellos);
   * con `sinGondolas`, las góndolas (Cabecera trabaja sobre ellas).
   */
  buscar(raton: Vec, pantalla: Vec, incluirBloqueados: boolean, sinMuros: boolean, sinGondolas = false): Objetivo | null {
    const plan = this.ctx.plan
    const cam = this.ctx.cam
    const cerca = (v: Vec) => distancia(cam.aPantalla(v), pantalla) <= RADIO
    const tocable = (capa: Capa, obj?: { bloqueada?: boolean }) =>
      editable(plan, capa, obj) || (incluirBloqueados && plan.capas[capa].visible)

    // Primero los extremos de lo seleccionado (solo con uno): son lo más pequeño y lo que se quiere coger.
    const sel = this.unico
    if (sel?.tipo === 'gondola' && this.libre(sel)) {
      const asas = asasGondola(sel.obj)
      for (const e of ['inicio', 'fin'] as Extremo[]) if (cerca(asas[e])) return { tipo: 'gondola', obj: sel.obj, extremo: e }
    }
    if (sel?.tipo === 'puerta' && this.libre(sel)) {
      const sitio = colocarPuerta(plan, sel.obj.centro, sel.obj.ancho)
      if (sitio && cerca(sitio.a)) return { tipo: 'puerta', obj: sel.obj, extremo: 'a' }
      if (sitio && cerca(sitio.b)) return { tipo: 'puerta', obj: sel.obj, extremo: 'b' }
    }

    const c = plan.contorno
    if (!c) return null
    if (!sinMuros && editable(plan, 'muros')) {
      const i = c.findIndex(cerca)
      if (i !== -1) return { tipo: 'esquina', muro: null, i }
      for (const m of plan.muros) {
        if (!editable(plan, 'muros', m)) continue
        const j = m.puntos.findIndex(cerca)
        if (j !== -1) return { tipo: 'esquina', muro: m, i: j }
      }
    }
    for (const p of plan.puertas) {
      if (!tocable('puertas', p)) continue
      const sitio = colocarPuerta(plan, p.centro, p.ancho)
      if (sitio && proyectar(pantalla, cam.aPantalla(sitio.a), cam.aPantalla(sitio.b)).distancia <= RADIO)
        return { tipo: 'puerta', obj: p }
    }
    if (!sinMuros)
      for (const m of plan.muros) {
        if (!tocable('muros', m)) continue
        for (let i = 0; i < m.puntos.length - 1; i++)
          if (proyectar(pantalla, cam.aPantalla(m.puntos[i]), cam.aPantalla(m.puntos[i + 1])).distancia <= RADIO)
            return { tipo: 'muro', obj: m }
      }
    const pz = piezaEn(plan, raton)
    if (pz && tocable('gondolas', pz)) return { tipo: 'pieza', obj: pz }
    const g = sinGondolas ? null : gondolaEn(plan, raton)
    if (g && tocable('gondolas', g)) return { tipo: 'gondola', obj: g }
    return null
  }

  /** Para que `pulsar` sepa dónde se cogió el objeto. */
  apuntar(raton: Vec) {
    this.raton = raton
  }

  /** Pulsar sobre `this.sobre`: seleccionar y, si se puede, empezar a arrastrar. */
  pulsar(mods: Mods) {
    const o = this.sobre
    const plan = this.ctx.plan
    if (!o) return

    if (o.tipo === 'esquina') {
      this.arrastre = { tipo: 'esquina', muro: o.muro, i: o.i }
      return
    }
    const elemento = elementoDe(o)

    // Mayús + clic: añadir o quitar de la selección, sin arrastrar.
    if (mods.shift) {
      this.seleccion = this.seleccionado(o.obj)
        ? this.seleccion.filter((e) => e.obj !== o.obj)
        : [...this.seleccion, elemento]
      this.ctx.cambio()
      return
    }

    if ((o.tipo === 'gondola' || o.tipo === 'puerta') && o.extremo && this.libre(elemento)) {
      this.seleccion = [elemento]
      if (o.tipo === 'gondola') {
        const g = o.obj
        const inicio = g.horizontal ? g.x : g.y
        this.arrastre = { tipo: 'estirar', obj: g, extremo: o.extremo, fijo: o.extremo === 'fin' ? inicio : inicio + g.largo }
      } else {
        const sitio = colocarPuerta(plan, o.obj.centro, o.obj.ancho)
        if (sitio) {
          // Se mueve el extremo pulsado: el fijo es el otro, y la dirección apunta hacia el pulsado.
          const [fijo, movil] = o.extremo === 'a' ? [sitio.b, sitio.a] : [sitio.a, sitio.b]
          const l = distancia(fijo, movil)
          const u = { x: (movil.x - fijo.x) / l, y: (movil.y - fijo.y) / l }
          this.arrastre = { tipo: 'ancho', obj: o.obj, fijo, u, largoMuro: sitio.largoMuro }
        }
      }
      this.ctx.cambio()
      return
    }

    // Pulsar algo que no estaba seleccionado lo deja como única selección; si ya lo estaba, se arrastra todo el grupo.
    if (!this.seleccionado(o.obj)) this.seleccion = [elemento]
    let ancla = this.seleccion.find((e) => e.obj === o.obj)!
    if (!this.libre(ancla)) {
      this.ctx.cambio()
      return
    }

    // Alt + arrastrar: se arrastran copias del mueble seleccionado y los originales se quedan.
    if (mods.alt) {
      const copias: Elemento[] = []
      for (const e of this.seleccion) {
        if (!this.libre(e)) continue
        const copia = this.copiar(e)
        if (!copia) continue
        copias.push(copia)
        if (e === ancla) ancla = copia
      }
      if (copias.length) {
        this.seleccion = copias
        if (!copias.includes(ancla)) ancla = copias[0]
      }
    }

    const origenes = new Map<Objeto, Vec[]>()
    for (const e of this.seleccion) {
      if (!this.libre(e)) continue
      if (e.tipo === 'gondola' || e.tipo === 'pieza') origenes.set(e.obj, [{ x: e.obj.x, y: e.obj.y }])
      else if (e.tipo === 'puerta') origenes.set(e.obj, [{ ...e.obj.centro }])
      else origenes.set(e.obj, e.obj.puntos.map((v) => ({ ...v })))
    }
    // Las puertas de un muro que se mueve se van con él.
    for (const p of plan.puertas) {
      if (origenes.has(p) || !editable(plan, 'puertas', p)) continue
      const muro = colocarPuerta(plan, p.centro, p.ancho)?.tramo.muro
      if (muro && origenes.has(muro)) origenes.set(p, [{ ...p.centro }])
    }
    this.arrastre = { tipo: 'grupo', ancla, inicio: this.raton, origenes }
    this.ctx.cambio()
  }

  /** Mientras se arrastra algo. */
  mover(raton: Vec, mods: Mods) {
    this.raton = raton
    const a = this.arrastre
    const plan = this.ctx.plan
    const c = plan.contorno
    if (!a || !c) return
    this.guias = []

    if (a.tipo === 'esquina') {
      const puntos = a.muro ? a.muro.puntos : c
      puntos[a.i] = ajustarARejilla(raton, this.ctx.cam.pasoAjuste())
    } else if (a.tipo === 'ancho') {
      // El extremo contrario se queda quieto; el ancho sale de lo que se aleja el ratón por el muro.
      const t = (raton.x - a.fijo.x) * a.u.x + (raton.y - a.fijo.y) * a.u.y
      const ancho = Math.min(a.largoMuro, Math.max(1, Math.round(t / CELDA) * CELDA))
      a.obj.ancho = ancho
      a.obj.centro = { x: a.fijo.x + (a.u.x * ancho) / 2, y: a.fijo.y + (a.u.y * ancho) / 2 }
    } else if (a.tipo === 'estirar') {
      const g = a.obj
      const v = Math.round((g.horizontal ? raton.x : raton.y) / CELDA) * CELDA
      const largo = Math.max(LARGO_MIN_GONDOLA, a.extremo === 'fin' ? v - a.fijo : a.fijo - v)
      // Por el inicio, la pintura se queda donde estaba: los tramos nuevos (o los que sobran) van por delante.
      if (a.extremo === 'inicio') {
        const dif = Math.round((largo - g.largo) / CELDA)
        const caras = carasDe(g)
        for (const t of caras) {
          if (dif > 0) t.unshift(...Array<null>(dif).fill(null))
          else if (dif < 0) t.splice(0, -dif)
        }
      }
      g.largo = largo
      const inicio = a.extremo === 'fin' ? a.fijo : a.fijo - largo
      if (g.horizontal) g.x = inicio
      else g.y = inicio
    } else {
      this.moverGrupo(a, raton, mods)
    }
    this.ctx.cambio()
  }

  private moverGrupo(a: Extract<Arrastre, { tipo: 'grupo' }>, raton: Vec, mods: Mods) {
    const plan = this.ctx.plan
    const d = { x: raton.x - a.inicio.x, y: raton.y - a.inicio.y }
    const origen = a.origenes.get(a.ancla.obj)![0]
    let delta: Vec

    if (a.ancla.tipo === 'gondola' || a.ancla.tipo === 'pieza') {
      // El ancla manda: a la rejilla y, si no se pulsa Ctrl, al imán del mueble que no se mueve.
      const pos = ajustarARejilla({ x: origen.x + d.x, y: origen.y + d.y }, CELDA)
      if (!mods.ctrl) {
        const quietas = mueblesQuietos(plan, (o) => a.origenes.has(o))
        const forma = a.ancla.tipo === 'gondola' ? rectGondola(a.ancla.obj) : a.ancla.obj
        const iman = imanar({ x: pos.x, y: pos.y, w: forma.w, h: forma.h }, quietas, this.ctx.cam.zoom)
        pos.x += iman.dx
        pos.y += iman.dy
        this.guias = iman.guias
      }
      delta = { x: pos.x - origen.x, y: pos.y - origen.y }
    } else if (a.ancla.tipo === 'puerta') {
      // Una puerta ancla se desliza por el muro más cercano al ratón.
      const sitio = colocarPuerta(plan, { x: origen.x + d.x, y: origen.y + d.y }, a.ancla.obj.ancho)
      delta = sitio ? { x: sitio.centro.x - origen.x, y: sitio.centro.y - origen.y } : ajustarARejilla(d, CELDA)
    } else {
      delta = ajustarARejilla(d, CELDA)
    }

    for (const [obj, o] of a.origenes) {
      if (esGondola(obj) || esPieza(obj)) {
        obj.x = o[0].x + delta.x
        obj.y = o[0].y + delta.y
      } else if (esMuro(obj)) {
        obj.puntos = o.map((v) => ({ x: v.x + delta.x, y: v.y + delta.y }))
      } else {
        obj.centro = { x: o[0].x + delta.x, y: o[0].y + delta.y }
      }
    }
  }

  soltar() {
    const a = this.arrastre
    // Las puertas movidas en grupo se quedan ya pegadas a su muro.
    if (a?.tipo === 'grupo')
      for (const obj of a.origenes.keys()) {
        if (esGondola(obj) || esMuro(obj) || esPieza(obj)) continue
        const sitio = colocarPuerta(this.ctx.plan, obj.centro, obj.ancho)
        if (sitio) obj.centro = sitio.centro
      }
    this.arrastre = null
    this.guias = []
  }

  /** Doble clic sobre un muro (contorno o interior): esquina nueva en ese punto. */
  anadirEsquina(raton: Vec, pantalla: Vec): boolean {
    const plan = this.ctx.plan
    const cam = this.ctx.cam
    if (!editable(plan, 'muros')) return false
    for (const t of tramos(plan)) {
      if (t.muro && !editable(plan, 'muros', t.muro)) continue
      if (proyectar(pantalla, cam.aPantalla(t.a), cam.aPantalla(t.b)).distancia > RADIO) continue
      const v = ajustarARejilla(proyectar(raton, t.a, t.b).punto, CELDA)
      if (distancia(v, t.a) < 1e-6 || distancia(v, t.b) < 1e-6) return false
      const puntos = t.muro ? t.muro.puntos : plan.contorno!
      puntos.splice(t.i + 1, 0, v)
      this.ctx.cambio()
      return true
    }
    return false
  }

  /** Recuadro de selección (herramienta Seleccionar en vacío). Con Mayús suma a lo que ya había. */
  empezarRecuadro(raton: Vec, sumar: boolean) {
    this.recuadro = { origen: raton, fin: raton, sumar }
    if (!sumar) this.seleccion = []
    this.ctx.cambio()
  }

  moverRecuadro(raton: Vec) {
    if (!this.recuadro) return
    this.recuadro.fin = raton
    this.ctx.cambio()
  }

  terminarRecuadro() {
    const r = this.recuadro
    this.recuadro = null
    if (!r) return
    const plan = this.ctx.plan
    const x0 = Math.min(r.origen.x, r.fin.x)
    const x1 = Math.max(r.origen.x, r.fin.x)
    const y0 = Math.min(r.origen.y, r.fin.y)
    const y1 = Math.max(r.origen.y, r.fin.y)
    const caja = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    const nuevos: Elemento[] = []
    // Entra lo que toca el recuadro, aunque no quepa entero: así se coge un pasillo largo sin afinar.
    const tocaCaja = (q: Rect) => q.x < x1 && q.x + q.w > x0 && q.y < y1 && q.y + q.h > y0
    if (plan.capas.gondolas.visible) {
      for (const g of plan.gondolas) if (huellaGondola(g).some(tocaCaja)) nuevos.push({ tipo: 'gondola', obj: g })
      for (const pz of plan.piezas) if (tocaCaja(pz)) nuevos.push({ tipo: 'pieza', obj: pz })
    }
    if (plan.capas.puertas.visible)
      for (const p of plan.puertas) {
        const m = colocarPuerta(plan, p.centro, p.ancho)?.centro ?? p.centro
        if (m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1) nuevos.push({ tipo: 'puerta', obj: p })
      }
    if (plan.capas.muros.visible)
      for (const m of plan.muros)
        if (m.puntos.some((v, i) => i > 0 && segmentoEnRect(m.puntos[i - 1], v, caja))) nuevos.push({ tipo: 'muro', obj: m })
    this.seleccion = [...this.seleccion, ...nuevos.filter((n) => !this.seleccionado(n.obj))]
    this.ctx.cambio()
  }

  get cursorCss(): string | null {
    const a = this.arrastre
    const o = this.sobre
    const horizontal = (g: Gondola) => (g.horizontal ? 'ew-resize' : 'ns-resize')
    if (a?.tipo === 'estirar') return horizontal(a.obj)
    if (a?.tipo === 'ancho') return Math.abs(a.u.x) > Math.abs(a.u.y) ? 'ew-resize' : 'ns-resize'
    if (a) return 'grabbing'
    if (!o) return null
    if (o.tipo === 'gondola' && o.extremo) return horizontal(o.obj)
    if (o.tipo === 'puerta' && o.extremo) return 'col-resize'
    if (o.tipo === 'esquina') return 'grab'
    return this.libre(elementoDe(o)) ? 'grab' : 'pointer'
  }

  tecla(e: KeyboardEvent): boolean {
    if (this.seleccion.length === 0) return false
    const u = this.unico
    if (e.code === 'Escape') this.ctx.seleccionar(null)
    else if (e.code === 'KeyL') this.alternarCandado()
    else if (e.code === 'Delete' || e.code === 'Backspace') this.borrar()
    else if (e.code === 'KeyR' && u?.tipo === 'gondola' && this.libre(u)) this.girar(u.obj)
    else return false
    return true
  }

  /** Bloquea todo si algo estaba libre; si todo estaba bloqueado, lo desbloquea. */
  private alternarCandado() {
    const bloquear = this.seleccion.some((e) => !e.obj.bloqueada)
    for (const e of this.seleccion) e.obj.bloqueada = bloquear || undefined
    this.ctx.cambio()
  }

  /** Borra lo seleccionado que se pueda tocar; lo bloqueado se queda. Un muro se lleva sus puertas. */
  private borrar() {
    const plan = this.ctx.plan
    const fuera = new Set<Objeto>(this.seleccion.filter((e) => this.libre(e)).map((e) => e.obj))
    for (const p of plan.puertas) {
      const muro = colocarPuerta(plan, p.centro, p.ancho)?.tramo.muro
      if (muro && fuera.has(muro)) fuera.add(p)
    }
    plan.puertas = plan.puertas.filter((p) => !fuera.has(p))
    plan.gondolas = plan.gondolas.filter((g) => !fuera.has(g))
    plan.piezas = plan.piezas.filter((pz) => !fuera.has(pz))
    plan.muros = plan.muros.filter((m) => !fuera.has(m))
    this.seleccion = this.seleccion.filter((e) => !fuera.has(e.obj))
    this.ctx.cambio()
  }

  /** Copia de una góndola o pieza, ya añadida a la tienda. Puertas y muros no se copian. */
  private copiar(e: Elemento, dx = 0, dy = 0): Elemento | null {
    const plan = this.ctx.plan
    if (e.tipo === 'gondola') {
      const copia = copiarGondola(e.obj, nuevoId())
      copia.x += dx
      copia.y += dy
      plan.gondolas.push(copia)
      return { tipo: 'gondola', obj: copia }
    }
    if (e.tipo === 'pieza') {
      const copia: Pieza = { ...e.obj, id: nuevoId(), x: e.obj.x + dx, y: e.obj.y + dy, bloqueada: undefined }
      plan.piezas.push(copia)
      return { tipo: 'pieza', obj: copia }
    }
    return null
  }

  /**
   * Ctrl+D: copia el mueble seleccionado (góndolas, cubos, expos) al lado, con un pasillo de 2 m entre medias,
   * hacia donde el grupo es más estrecho. Así se monta una fila de pasillos a golpe de tecla.
   */
  duplicar(): boolean {
    const mueble = this.seleccion.filter((e) => e.tipo === 'gondola' || e.tipo === 'pieza')
    if (mueble.length === 0) return false
    const rects = mueble.flatMap((e) => (e.tipo === 'gondola' ? huellaGondola(e.obj) : e.tipo === 'pieza' ? [e.obj] : []))
    const x0 = Math.min(...rects.map((r) => r.x))
    const x1 = Math.max(...rects.map((r) => r.x + r.w))
    const y0 = Math.min(...rects.map((r) => r.y))
    const y1 = Math.max(...rects.map((r) => r.y + r.h))
    const [dx, dy] = x1 - x0 >= y1 - y0 ? [0, y1 - y0 + PASILLO] : [x1 - x0 + PASILLO, 0]
    this.seleccion = mueble.map((e) => this.copiar(e, dx, dy)).filter((e): e is Elemento => e !== null)
    this.ctx.cambio()
    return true
  }

  /** 90° sobre su centro. */
  private girar(g: Gondola) {
    const r = rectGondola(g)
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    g.horizontal = !g.horizontal
    const n = rectGondola(g)
    const p = ajustarARejilla({ x: cx - n.w / 2, y: cy - n.h / 2 }, CELDA)
    g.x = p.x
    g.y = p.y
    this.ctx.cambio()
  }

  dibujar(verEsquinas: boolean) {
    const g = this.g
    const cam = this.ctx.cam
    const plan = this.ctx.plan
    g.clear()
    vaciar(this.etiquetas)

    const marco = (r: Rect, color: number, alpha: number) => {
      const p = cam.aPantalla({ x: r.x, y: r.y })
      const w = r.w * cam.zoom
      const h = r.h * cam.zoom
      g.roundRect(p.x - 3, p.y - 3, w + 6, h + 6, Math.min(w, h) * 0.3 + 3).stroke({ width: 2, color, alpha })
    }
    const marcoGondola = (gd: Gondola, color: number, alpha: number) => {
      for (const r of huellaGondola(gd)) marco(r, color, alpha)
    }
    const marcoPuerta = (p: Puerta, alpha: number) => {
      const sitio = colocarPuerta(plan, p.centro, p.ancho)
      if (!sitio) return
      const a = cam.aPantalla(sitio.a)
      const b = cam.aPantalla(sitio.b)
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 14, color: COLOR_PUERTA[p.tipo], alpha, cap: 'round' })
    }
    const marcoMuro = (m: MuroInterior, color: number, alpha: number) => {
      const s = m.puntos.map((v) => cam.aPantalla(v))
      g.moveTo(s[0].x, s[0].y)
      for (const v of s.slice(1)) g.lineTo(v.x, v.y)
      g.stroke({ width: 12, color, alpha, join: 'round', cap: 'round' })
    }
    const asa = (p: Vec, activa: boolean) =>
      g.circle(p.x, p.y, activa ? 6.5 : 5).fill({ color: activa ? tema.acento : tema.blanco }).stroke({ width: 2, color: tema.acento })

    const o = this.sobre
    const a = this.arrastre

    if (o?.tipo === 'gondola' && !this.seleccionado(o.obj)) marcoGondola(o.obj, tema.acento, 0.4)
    if (o?.tipo === 'puerta' && !this.seleccionado(o.obj)) marcoPuerta(o.obj, 0.2)
    if (o?.tipo === 'muro' && !this.seleccionado(o.obj)) marcoMuro(o.obj, tema.acento, 0.2)
    if (o?.tipo === 'pieza' && !this.seleccionado(o.obj)) marco(o.obj, tema.acento, 0.4)

    for (const e of this.seleccion) {
      const libre = this.libre(e)
      if (e.tipo === 'gondola') marcoGondola(e.obj, libre ? tema.acento : tema.bloqueado, 1)
      else if (e.tipo === 'puerta') marcoPuerta(e.obj, libre ? 0.35 : 0.15)
      else if (e.tipo === 'pieza') marco(e.obj, libre ? tema.acento : tema.bloqueado, 1)
      else marcoMuro(e.obj, libre ? tema.acento : tema.bloqueado, 0.35)
    }

    // Esquinas: con Seleccionar o Muro se ven todas; con lo demás, solo la que está bajo el ratón.
    if (plan.contorno && editable(plan, 'muros')) {
      const esquinas: [MuroInterior | null, Vec[]][] = [[null, plan.contorno]]
      for (const m of plan.muros) if (editable(plan, 'muros', m)) esquinas.push([m, m.puntos])
      for (const [muro, puntos] of esquinas)
        puntos.forEach((v, i) => {
          const activa =
            (o?.tipo === 'esquina' && o.muro === muro && o.i === i) || (a?.tipo === 'esquina' && a.muro === muro && a.i === i)
          if (!activa && !verEsquinas) return
          const p = cam.aPantalla(v)
          const r = muro ? 3.5 : 4.5
          g.circle(p.x, p.y, activa ? 7 : r).fill({ color: activa ? tema.acento : tema.blanco }).stroke({ width: 2, color: activa ? tema.acento : tema.muro })
        })
    }

    // Con uno solo: su medida y sus extremos para estirar.
    const u = this.unico
    if (u?.tipo === 'gondola') {
      this.etiquetas.addChild(etiquetaLargo(cam, u.obj))
      if (this.libre(u)) {
        const asas = asasGondola(u.obj)
        for (const e of ['inicio', 'fin'] as Extremo[]) {
          const activa = (o?.tipo === 'gondola' && o.extremo === e) || (a?.tipo === 'estirar' && a.extremo === e)
          asa(cam.aPantalla(asas[e]), activa)
        }
      }
    }
    if (u?.tipo === 'puerta' && this.libre(u)) {
      const sitio = colocarPuerta(plan, u.obj.centro, u.obj.ancho)
      if (sitio) {
        asa(cam.aPantalla(sitio.a), (o?.tipo === 'puerta' && o.extremo === 'a') || a?.tipo === 'ancho')
        asa(cam.aPantalla(sitio.b), (o?.tipo === 'puerta' && o.extremo === 'b') || a?.tipo === 'ancho')
      }
    }

    dibujarGuias(g, cam, this.guias)

    const r = this.recuadro
    if (r) {
      const p = cam.aPantalla({ x: Math.min(r.origen.x, r.fin.x), y: Math.min(r.origen.y, r.fin.y) })
      const w = Math.abs(r.fin.x - r.origen.x) * cam.zoom
      const h = Math.abs(r.fin.y - r.origen.y) * cam.zoom
      g.rect(p.x, p.y, w, h).fill({ color: tema.acento, alpha: 0.08 }).stroke({ width: 1, color: tema.acento, pixelLine: true })
    }
  }

  /** Clave del panel de propiedades de la selección. */
  clavePropiedades(): string {
    return this.seleccion
      .map((e) => {
        const extra = e.tipo === 'puerta' ? e.obj.tipo : e.tipo === 'gondola' ? Object.keys(e.obj.cabeceras ?? {}).join('') : ''
        return `${e.tipo}-${e.obj.id}-${!!e.obj.bloqueada}-${extra}`
      })
      .join(',')
  }

  construirPropiedades(raiz: HTMLElement) {
    this.inputLargo = null
    const u = this.unico
    if (u) this.propiedadesDeUno(raiz, u)
    else this.propiedadesDeVarios(raiz)
  }

  private propiedadesDeUno(raiz: HTMLElement, s: Elemento) {
    const libre = this.libre(s)
    const titulos = { puerta: 'Puerta', gondola: 'Góndola', muro: 'Muro interior', pieza: s.tipo === 'pieza' ? NOMBRE_PIEZA[s.obj.tipo] : '' }
    raiz.append(el('p', 'subtitulo', titulos[s.tipo]))

    if (s.tipo === 'puerta') {
      const p = s.obj
      if (libre)
        raiz.append(
          selectorTipo(p.tipo, (t) => {
            p.tipo = t
            this.ctx.cambio()
          }),
          campoNumero('Ancho (m)', 'ancho-puerta', p.ancho, 0.5, 1, (v) => {
            p.ancho = Math.max(1, Math.round(v * 2) / 2)
            this.ctx.cambio()
          }).fila,
        )
    } else if (s.tipo === 'gondola') {
      const g = s.obj
      if (libre) {
        const { fila, input } = campoNumero('Largo (m)', 'largo-gondola', g.largo, 0.5, LARGO_MIN_GONDOLA, (v) => {
          g.largo = Math.max(LARGO_MIN_GONDOLA, Math.round(v * 2) / 2)
          this.ctx.cambio()
        })
        this.inputLargo = input
        const cabeceras = el('div', 'opciones')
        for (const [e, texto] of [['inicio', 'Cabecera inicio'], ['fin', 'Cabecera final']] as const)
          cabeceras.append(
            boton(texto, `opcion${g.cabeceras?.[e] ? ' activa' : ''}`, () => {
              const cab = { ...g.cabeceras }
              if (cab[e]) delete cab[e]
              else cab[e] = { area: null }
              g.cabeceras = cab
              this.ctx.cambio()
            }),
          )
        raiz.append(fila, cabeceras, this.aviso)
      }
    } else if (s.tipo === 'pieza') {
      const pz = s.obj
      if (libre) {
        const medida = (texto: string, id: string, clave: 'w' | 'h') =>
          campoNumero(texto, id, pz[clave], 0.5, 0.5, (v) => {
            pz[clave] = Math.max(0.5, Math.round(v * 2) / 2)
            this.ctx.cambio()
          }).fila
        raiz.append(medida('Ancho (m)', 'ancho-pieza', 'w'), medida('Fondo (m)', 'fondo-pieza', 'h'), this.selectorSeccion(pz), this.aviso)
      }
    } else {
      const largo = s.obj.puntos.reduce((t, v, i) => (i ? t + distancia(s.obj.puntos[i - 1], v) : 0), 0)
      raiz.append(el('p', 'dato', `${formatear(largo)} m de muro`))
    }

    if (!libre && !s.obj.bloqueada) raiz.append(el('p', 'vacio', 'La capa está bloqueada u oculta.'))

    const botones = el('div', 'fila-botones')
    botones.append(
      boton(s.obj.bloqueada ? 'Desbloquear' : 'Bloquear', 'secundario', () => this.alternarCandado(), s.obj.bloqueada ? LockOpen : Lock),
    )
    if (libre && s.tipo === 'gondola') botones.append(boton('Girar', 'secundario', () => this.girar(s.obj), RotateCw))
    if (libre) botones.append(boton('Borrar', 'secundario peligro', () => this.borrar(), Trash2))
    raiz.append(botones)
    const atajos = {
      gondola: 'R gira · L bloquea · Ctrl+D duplica · Supr borra',
      puerta: 'L bloquea · Supr borra',
      muro: 'Doble clic en el muro añade una esquina · Supr lo borra con sus puertas',
      pieza: 'L bloquea · Ctrl+D duplica · Supr borra · El pincel también le da sección',
    }
    raiz.append(el('p', 'atajos', atajos[s.tipo]))
  }

  private propiedadesDeVarios(raiz: HTMLElement) {
    const n = this.seleccion.length
    const cuenta = (tipo: Elemento['tipo']) => this.seleccion.filter((e) => e.tipo === tipo).length
    const nombres: [Elemento['tipo'], string, string][] = [
      ['gondola', 'góndola', 'góndolas'],
      ['pieza', 'cubo o expo', 'cubos y expos'],
      ['puerta', 'puerta', 'puertas'],
      ['muro', 'muro', 'muros'],
    ]
    const partes = nombres.map(([t, uno, varios]) => [cuenta(t), uno, varios] as const).filter(([k]) => k > 0)
    const texto = partes.map(([k, uno, varios]) => `${k} ${k === 1 ? uno : varios}`).join(', ')
    raiz.append(el('p', 'subtitulo', `${n} seleccionados`), el('p', 'dato', texto))

    const todoBloqueado = this.seleccion.every((e) => e.obj.bloqueada)
    const botones = el('div', 'fila-botones')
    botones.append(
      boton(todoBloqueado ? 'Desbloquear' : 'Bloquear', 'secundario', () => this.alternarCandado(), todoBloqueado ? LockOpen : Lock),
    )
    if (cuenta('gondola') || cuenta('pieza')) botones.append(boton('Duplicar', 'secundario', () => this.duplicar(), Copy))
    botones.append(boton('Borrar', 'secundario peligro', () => this.borrar(), Trash2))
    raiz.append(botones, el('p', 'atajos', 'Arrastra uno para mover el grupo · Mayús + clic añade o quita'))
  }

  /** Desplegable para darle (o quitarle) sección a un cubo o expo. */
  private selectorSeccion(pz: Pieza) {
    const fila = el('div', 'campo')
    const label = el('label', '', 'Sección')
    const select = el('select')
    select.id = 'seccion-pieza'
    label.htmlFor = select.id
    const ninguna = el('option', '', 'Sin sección')
    ninguna.value = ''
    select.append(ninguna)
    for (const a of this.ctx.plan.areas.filter((x) => x.tipo === 'seccion')) {
      const op = el('option', '', a.nombre)
      op.value = String(a.id)
      op.selected = a.id === pz.area
      select.append(op)
    }
    select.addEventListener('change', () => {
      pz.area = select.value ? Number(select.value) : null
      this.ctx.cambio()
    })
    fila.append(label, select)
    return fila
  }

  refrescarPropiedades() {
    const u = this.unico
    if (u?.tipo === 'pieza') this.aviso.hidden = piezaValida(this.ctx.plan, u.obj)
    if (u?.tipo !== 'gondola') return
    this.aviso.hidden = gondolaValida(this.ctx.plan, u.obj)
    if (this.inputLargo && document.activeElement !== this.inputLargo) this.inputLargo.value = String(u.obj.largo)
  }
}

function asasGondola(g: Gondola): Record<Extremo, Vec> {
  const r = rectGondola(g)
  return g.horizontal
    ? { inicio: { x: r.x, y: r.y + r.h / 2 }, fin: { x: r.x + r.w, y: r.y + r.h / 2 } }
    : { inicio: { x: r.x + r.w / 2, y: r.y }, fin: { x: r.x + r.w / 2, y: r.y + r.h } }
}
