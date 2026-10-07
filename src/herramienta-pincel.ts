import { Eraser, Paintbrush, type IconNode } from 'lucide'
import { Container, Graphics } from 'pixi.js'
import { CELDA, distancia, puntoEnPoligono, type Vec } from './geometria'
import { boton, el, etiqueta, formatear, vaciar, type Contexto, type Herramienta, type Mods } from './herramienta'
import {
  carasDe,
  celdaDe,
  celdasDeRect,
  celdasOcupadas,
  celdaTramo,
  centroCelda,
  claveCelda,
  COLORES_SECCION,
  editable,
  nuevoId,
  rectCabecera,
  sePisan,
  tramoLibre,
  type Area,
  type ExtremoGondola,
  type Rect,
} from './plan'
import type { Pintura } from './pintura'
import { tema } from './tema'

const TAMANOS = [1, 2, 4, 8] // celdas por lado: 0,5 m (un tramo de una cara), 1, 2 y 4 m

const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`
/** Mismo nombre de sección, como los casa la simulación: sin mayúsculas ni espacios de más. */
const mismo = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase()

/** Lo que comparten pincel y goma: la forma, el tamaño y el área con la que se pinta. */
export interface EstadoPincel {
  /** Pincel: se pinta por donde pasa el ratón. Rectángulo: se arrastra de esquina a esquina. */
  forma: 'pincel' | 'rectangulo'
  tamano: number
  area: number | null
}

/**
 * Pincel o goma, a trazo o en rectángulo (también con Mayús en modo pincel).
 * Una sección se pinta en el mueble: tramos de góndola, cabeceras, cubos y expos. Una zona sin venta, en el suelo.
 * La goma borra las dos cosas.
 */
export class HerramientaPincel implements Herramienta {
  readonly id: 'pincel' | 'goma'
  readonly titulo: string
  readonly atajo: string
  readonly icono: IconNode
  readonly vista = new Container()
  readonly pintaEncima = true
  readonly necesitaContorno = true

  private cursor: Vec | null = null
  private pintando = false
  private ultimo: Vec | null = null
  private rect: { origen: Vec; fin: Vec } | null = null
  private datos = new Map<number, HTMLElement>()
  /**
   * Las secciones del histórico, de más a menos facturación: las únicas que la simulación sabe llenar
   * de clientes, así que son los únicos nombres posibles. Null mientras no se ha leído (o si no se puede):
   * entonces el nombre se escribe a mano.
   */
  catalogo: string[] | null = null

  private g = new Graphics()
  private etiquetas = new Container()
  private ctx: Contexto
  private pintura: Pintura
  private estado: EstadoPincel
  private goma: boolean

  constructor(ctx: Contexto, pintura: Pintura, estado: EstadoPincel, goma: boolean) {
    this.ctx = ctx
    this.pintura = pintura
    this.estado = estado
    this.goma = goma
    this.id = goma ? 'goma' : 'pincel'
    this.titulo = goma ? 'Goma' : 'Pincel'
    this.atajo = goma ? 'E' : 'B'
    this.icono = goma ? Eraser : Paintbrush
    this.vista.addChild(this.g, this.etiquetas)
  }

  private get area(): Area | null {
    return this.ctx.plan.areas.find((a) => a.id === this.estado.area) ?? null
  }

  private get puedePintar() {
    return editable(this.ctx.plan, 'pintura') && (this.goma || this.area !== null)
  }

  get cursorCss() {
    return this.puedePintar ? 'crosshair' : 'not-allowed'
  }

  pista() {
    if (!editable(this.ctx.plan, 'pintura')) return 'La capa de pintura está oculta o bloqueada'
    if (!this.goma && !this.area) return 'Elige una sección o zona en el panel de la derecha'
    const que = this.goma ? 'borrar' : this.area?.tipo === 'seccion' ? 'pintar góndolas, cabeceras, cubos y expos' : 'pintar el suelo'
    if (this.estado.forma === 'rectangulo') return `Arrastra de esquina a esquina para ${que}`
    return `Arrastra para ${que} · Mayús + arrastrar: rectángulo`
  }

  ocupada() {
    return false
  }

  mover(raton: Vec) {
    this.cursor = raton
    if (this.rect) {
      this.rect.fin = raton
    } else if (this.pintando && this.ultimo) {
      // Rellenar el trazo entre dos eventos para que un movimiento rápido no deje huecos.
      const pasos = Math.max(1, Math.ceil(distancia(this.ultimo, raton) / CELDA))
      const celdas: [number, number][] = []
      for (let n = 1; n <= pasos; n++) {
        const t = n / pasos
        celdas.push(...this.celdasPincel({ x: this.ultimo.x + (raton.x - this.ultimo.x) * t, y: this.ultimo.y + (raton.y - this.ultimo.y) * t }))
      }
      this.pintarCeldas(celdas)
      this.ultimo = raton
    }
    this.ctx.cambio()
  }

  pulsar(mods: Mods) {
    this.ctx.seleccionar(null)
    if (!this.puedePintar || !this.cursor) return
    if (mods.shift || this.estado.forma === 'rectangulo') {
      this.rect = { origen: this.cursor, fin: this.cursor }
    } else {
      this.pintando = true
      this.ultimo = this.cursor
      this.pintarCeldas(this.celdasPincel(this.cursor))
    }
    this.ctx.cambio()
  }

  soltar() {
    if (this.rect) {
      const a = celdaDe(this.rect.origen)
      const b = celdaDe(this.rect.fin)
      const celdas: [number, number][] = []
      for (let i = Math.min(a.i, b.i); i <= Math.max(a.i, b.i); i++)
        for (let j = Math.min(a.j, b.j); j <= Math.max(a.j, b.j); j++) celdas.push([i, j])
      this.pintarCeldas(celdas)
      this.rect = null
    }
    this.pintando = false
    this.ultimo = null
    this.ctx.cambio()
  }

  tecla() {
    return false
  }

  salir() {
    this.cursor = null
    this.pintando = false
    this.rect = null
  }

  /** Primera celda del pincel con el ratón en el centro. */
  private esquinaPincel(p: Vec) {
    const t = this.estado.tamano
    return { i: Math.round(p.x / CELDA - t / 2), j: Math.round(p.y / CELDA - t / 2) }
  }

  private celdasPincel(p: Vec): [number, number][] {
    const { i, j } = this.esquinaPincel(p)
    const t = this.estado.tamano
    const celdas: [number, number][] = []
    for (let di = 0; di < t; di++) for (let dj = 0; dj < t; dj++) celdas.push([i + di, j + dj])
    return celdas
  }

  /** Pinta (o borra) lo que caiga en esas celdas: el mueble con una sección, el suelo con una zona. */
  private pintarCeldas(celdas: [number, number][]) {
    const plan = this.ctx.plan
    const c = plan.contorno
    const area = this.area
    if (!c || celdas.length === 0 || (!this.goma && !area)) return
    const tocadas = new Set(celdas.map(([i, j]) => claveCelda(i, j)))
    const xs = celdas.map(([i]) => i)
    const ys = celdas.map(([, j]) => j)
    const caja: Rect = {
      x: Math.min(...xs) * CELDA,
      y: Math.min(...ys) * CELDA,
      w: (Math.max(...xs) - Math.min(...xs) + 1) * CELDA,
      h: (Math.max(...ys) - Math.min(...ys) + 1) * CELDA,
    }
    const toca = (r: Rect) => sePisan(r, caja) && celdasDeRect(r).some(([i, j]) => tocadas.has(claveCelda(i, j)))

    if (this.goma || area!.tipo !== 'seccion')
      for (const k of tocadas) {
        const [i, j] = k.split(',').map(Number)
        if (this.goma) plan.celdas.delete(k)
        else if (puntoEnPoligono(centroCelda(i, j), c)) plan.celdas.set(k, area!.id)
      }

    if (this.goma || area!.tipo === 'seccion') {
      const valor = this.goma ? null : area!.id
      const ocupadas = celdasOcupadas(plan)
      for (const g of plan.gondolas) {
        if (!editable(plan, 'gondolas', g)) continue
        const caras = carasDe(g)
        for (const cara of [0, 1] as const)
          caras[cara].forEach((_, k) => {
            if (!tocadas.has(claveCelda(...celdaTramo(g, cara, k)))) return
            // Una cara que no da a ningún pasillo no se pinta: no la ve nadie.
            if (valor !== null && !tramoLibre(plan, ocupadas, g, cara, k)) return
            caras[cara][k] = valor
          })
        for (const e of ['inicio', 'fin'] as ExtremoGondola[]) {
          const cab = g.cabeceras?.[e]
          if (cab && toca(rectCabecera(g, e))) cab.area = valor
        }
      }
      for (const pz of plan.piezas) if (editable(plan, 'gondolas', pz) && toca(pz)) pz.area = valor
    }
    plan.version++
  }

  dibujar() {
    const g = this.g
    const cam = this.ctx.cam
    g.clear()
    vaciar(this.etiquetas)
    if (!this.cursor || !this.puedePintar) return
    // En modo rectángulo, antes de pulsar no se enseña el pincel: solo cuenta dónde empieza el arrastre.
    if (!this.rect && this.estado.forma === 'rectangulo') {
      const p = cam.aPantalla(this.cursor)
      g.circle(p.x, p.y, 3).fill({ color: tema.acento })
      return
    }

    let i0: number, j0: number, i1: number, j1: number
    if (this.rect) {
      const a = celdaDe(this.rect.origen)
      const b = celdaDe(this.rect.fin)
      ;[i0, j0, i1, j1] = [Math.min(a.i, b.i), Math.min(a.j, b.j), Math.max(a.i, b.i) + 1, Math.max(a.j, b.j) + 1]
    } else {
      const e = this.esquinaPincel(this.cursor)
      const t = this.estado.tamano
      ;[i0, j0, i1, j1] = [e.i, e.j, e.i + t, e.j + t]
    }
    const p = cam.aPantalla({ x: i0 * CELDA, y: j0 * CELDA })
    const w = (i1 - i0) * CELDA * cam.zoom
    const h = (j1 - j0) * CELDA * cam.zoom
    g.rect(p.x, p.y, w, h)
    if (!this.goma) g.fill({ color: this.area!.color, alpha: 0.5 })
    g.stroke({ width: 2, color: this.goma ? tema.muro : tema.acento, alpha: 0.8 })

    // Medidas del rectángulo: para diseñar los m² de cada sección antes de amueblarla.
    if (this.rect) {
      const ancho = (i1 - i0) * CELDA
      const alto = (j1 - j0) * CELDA
      const texto = `${formatear(ancho)} × ${formatear(alto)} m · ${formatear(ancho * alto, 0)} m²`
      this.etiquetas.addChild(etiqueta(texto, p.x + w / 2, p.y - 12))
    }
  }

  propiedades = {
    clave: () => {
      const a = this.area
      // Con catálogo, cambiar un nombre cambia lo que les queda a las demás: se reconstruye.
      const nombres = this.catalogo ? this.ctx.plan.areas.map((x) => x.nombre).join('|') : 'a mano'
      return `${this.estado.forma}|${this.estado.tamano}|${a?.id}|${a?.color}|${this.ctx.plan.areas.length}|${nombres}`
    },
    construir: (raiz: HTMLElement) => this.construir(raiz),
    refrescar: () => this.refrescar(),
  }

  private construir(raiz: HTMLElement) {
    const plan = this.ctx.plan
    this.datos.clear()

    const formas = el('div', 'opciones')
    for (const [f, texto] of [['pincel', 'Pincel'], ['rectangulo', 'Rectángulo']] as const) {
      formas.append(
        boton(texto, `opcion${f === this.estado.forma ? ' activa' : ''}`, () => {
          this.estado.forma = f
          this.ctx.cambio()
        }),
      )
    }
    raiz.append(el('p', 'subtitulo', 'Forma'), formas)

    if (this.estado.forma === 'pincel') {
      const tamanos = el('div', 'opciones')
      for (const t of TAMANOS) {
        tamanos.append(
          boton(`${formatear(t * CELDA)} m`, `opcion${t === this.estado.tamano ? ' activa' : ''}`, () => {
            this.estado.tamano = t
            this.ctx.cambio()
          }),
        )
      }
      raiz.append(el('p', 'subtitulo', `Tamaño de ${this.goma ? 'la goma' : 'el pincel'}`), tamanos)
    }
    if (this.goma) return

    const secciones = plan.areas.filter((a) => a.tipo === 'seccion')
    raiz.append(el('p', 'subtitulo', 'Secciones'))
    const ls = el('div', 'areas')
    for (const a of secciones) ls.append(this.fila(a))
    if (secciones.length === 0) ls.append(el('p', 'vacio', 'Aún no hay secciones.'))
    const nueva = boton('+ Nueva sección', 'secundario', () => this.nuevaSeccion())
    if (this.catalogo && this.libres().length === 0) {
      nueva.disabled = true
      nueva.title = 'Ya están todas las secciones con ventas en el histórico. Borra una para crear otra.'
    }
    raiz.append(ls, nueva)

    const sel = this.area
    if (sel?.tipo === 'seccion') {
      const colores = el('div', 'colores')
      for (const c of COLORES_SECCION) {
        const b = boton('', `color${c === sel.color ? ' activa' : ''}`, () => {
          sel.color = c
          plan.version++
          this.ctx.cambio()
        })
        b.style.backgroundColor = css(c)
        b.ariaLabel = 'Color de la sección'
        colores.append(b)
      }
      raiz.append(colores)
    }

    raiz.append(el('p', 'subtitulo', 'Sin venta'))
    const lz = el('div', 'areas')
    for (const a of plan.areas.filter((a) => a.tipo !== 'seccion')) lz.append(this.fila(a))
    raiz.append(lz)
  }

  private fila(a: Area) {
    const fila = el('div', `area${a === this.area ? ' activa' : ''}`)
    const muestra = el('span', 'muestra')
    muestra.style.backgroundColor = css(a.color)
    fila.append(muestra)

    if (a.tipo === 'seccion' && this.catalogo) {
      // Su nombre y los que no tiene ninguna otra. Uno de fuera del histórico (un archivo antiguo) se ve como tal.
      const nombre = el('select', 'nombre')
      nombre.id = `nombre-${a.id}`
      nombre.ariaLabel = 'Nombre de la sección'
      const opciones = this.catalogo.filter((n) => mismo(n, a.nombre) || this.libres().includes(n))
      if (!opciones.some((n) => mismo(n, a.nombre))) opciones.unshift(a.nombre)
      for (const n of opciones) {
        const op = el('option', '', this.catalogo.some((c) => mismo(c, n)) ? n : `${n} (sin ventas)`)
        op.value = n
        op.selected = mismo(n, a.nombre)
        nombre.append(op)
      }
      nombre.addEventListener('focus', () => this.elegir(a))
      nombre.addEventListener('change', () => {
        a.nombre = nombre.value
        this.ctx.cambio()
      })
      fila.append(nombre)
    } else if (a.tipo === 'seccion') {
      const nombre = el('input', 'nombre')
      nombre.id = `nombre-${a.id}`
      nombre.value = a.nombre
      nombre.ariaLabel = 'Nombre de la sección'
      nombre.addEventListener('focus', () => this.elegir(a))
      nombre.addEventListener('input', () => {
        a.nombre = nombre.value
        this.ctx.cambio()
      })
      fila.append(nombre)
    } else {
      fila.append(el('span', 'nombre', a.nombre))
    }

    const datos = el('span', 'datos')
    this.datos.set(a.id, datos)
    fila.append(datos)

    if (a.tipo === 'seccion') {
      const borrar = boton('×', 'quitar', () => this.borrarSeccion(a))
      borrar.ariaLabel = `Borrar ${a.nombre}`
      fila.append(borrar)
    }
    fila.addEventListener('click', (e) => {
      if (!(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) this.elegir(a)
    })
    return fila
  }

  private elegir(a: Area) {
    if (this.estado.area === a.id) return
    this.estado.area = a.id
    this.ctx.cambio()
  }

  /** Las secciones del catálogo que aún no tiene la tienda, en su orden (de más a menos facturación). */
  private libres(): string[] {
    const usadas = this.ctx.plan.areas.filter((a) => a.tipo === 'seccion')
    return (this.catalogo ?? []).filter((n) => !usadas.some((a) => mismo(a.nombre, n)))
  }

  /** Con catálogo, la nueva es la que más factura de las que faltan. */
  private nuevaSeccion() {
    const plan = this.ctx.plan
    const n = plan.areas.filter((a) => a.tipo === 'seccion').length
    const nombre = this.catalogo ? this.libres()[0] : `Sección ${n + 1}`
    if (!nombre) return
    const a: Area = { id: nuevoId(), tipo: 'seccion', nombre, color: COLORES_SECCION[n % COLORES_SECCION.length] }
    plan.areas.push(a)
    this.estado.area = a.id
    this.ctx.cambio()
  }

  private borrarSeccion(a: Area) {
    const plan = this.ctx.plan
    const usada =
      (this.pintura.lineal.get(a.id) ?? 0) > 0 ||
      (this.pintura.piezas.get(a.id) ?? 0) > 0 ||
      plan.gondolas.some((g) => carasDe(g).some((c) => c.includes(a.id)))
    if (usada && !confirm(`Se borrará "${a.nombre}" y se despintará todo el mueble que la lleva. ¿Seguir?`)) return
    plan.areas = plan.areas.filter((x) => x !== a)
    for (const [k, id] of plan.celdas) if (id === a.id) plan.celdas.delete(k)
    // Lo que llevaba esta sección se queda sin sección.
    for (const g of plan.gondolas) {
      for (const cara of carasDe(g)) cara.forEach((id, k) => id === a.id && (cara[k] = null))
      for (const cab of Object.values(g.cabeceras ?? {})) if (cab?.area === a.id) cab.area = null
    }
    for (const pz of plan.piezas) if (pz.area === a.id) pz.area = null
    plan.version++
    if (this.estado.area === a.id) this.estado.area = null
    this.ctx.cambio()
  }

  private refrescar() {
    for (const [id, datos] of this.datos) {
      const m2 = this.pintura.m2.get(id) ?? 0
      const lineal = this.pintura.lineal.get(id) ?? 0
      const piezas = this.pintura.piezas.get(id) ?? 0
      const seccion = this.ctx.plan.areas.find((a) => a.id === id)?.tipo === 'seccion'
      if (seccion) {
        datos.textContent = `${formatear(lineal)} m` + (piezas ? ` · ${piezas} ${piezas === 1 ? 'pieza' : 'piezas'}` : '')
        datos.title = 'Metros de lineal' + (piezas ? ' · cubos y expos' : '')
      } else {
        datos.textContent = `${formatear(m2, 0)} m²`
        datos.title = 'Superficie de suelo'
      }
    }
  }
}
