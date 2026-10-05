import { MousePointer2 } from 'lucide'
import { Container } from 'pixi.js'
import type { Edicion } from './edicion'
import type { Vec } from './geometria'
import type { Herramienta, Mods } from './herramienta'

/**
 * No crea nada: arrastrar en vacío hace un recuadro de selección (con Mayús, suma).
 * Es la única herramienta que deja seleccionar lo bloqueado.
 */
export class HerramientaSeleccionar implements Herramienta {
  readonly id = 'seleccionar'
  readonly titulo = 'Seleccionar'
  readonly atajo = 'V'
  readonly icono = MousePointer2
  readonly vista = new Container()
  readonly pintaEncima = false
  readonly necesitaContorno = true
  readonly cursorCss = 'default'
  private raton: Vec = { x: 0, y: 0 }
  private edicion: Edicion

  constructor(edicion: Edicion) {
    this.edicion = edicion
  }

  pista() {
    return 'Clic o recuadro para seleccionar · Mayús suma · Arrastra para mover'
  }

  mover(raton: Vec) {
    this.raton = raton
    this.edicion.moverRecuadro(raton)
  }

  pulsar(mods: Mods) {
    this.edicion.empezarRecuadro(this.raton, mods.shift)
  }

  soltar() {
    this.edicion.terminarRecuadro()
  }

  tecla() {
    return false
  }

  dibujar() {}

  salir() {
    this.edicion.terminarRecuadro()
  }

  ocupada() {
    return false
  }
}
