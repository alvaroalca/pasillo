# Estado

**2026-10-05**: arquitectura y modelo de datos cerrados (ver `CLAUDE.md`). Fase 1 (editor por pasos) completa y probada. Después, rediseño del editor a estilo Paint/Figma en tres tandas.

**Tanda 1 (hecha y probada)**: barra de herramientas a la izquierda (Seleccionar V, Muro M, Puerta P, Góndola G, Pincel B, Goma E), propiedades y capas a la derecha, menú de hamburguesa (nueva, abrir, guardar) y barra de estado. Lo que existe se edita desde cualquier herramienta (`edicion.ts`): pasar por encima, mover, estirar (góndolas y ahora también puertas por sus extremos), R gira, L bloquea, Supr borra. Con pincel y goma manda la pintura. Candado por objeto (puertas, góndolas) y por capa (Muros, Puertas, Góndolas, Pintura), con ojo para ocultar; lo bloqueado solo se selecciona con Seleccionar. Deshacer/rehacer con fotos de la tienda (`historial.ts`). Las góndolas van siempre a 0,5 m.

**Tanda 2 (hecha y probada)**: imán con guías (`iman.ts`) al crear y al mover góndolas: alinea en fila, pega por el extremo y espalda con espalda con las vecinas a menos de 3 m; solo bordes (siempre en la rejilla); umbral de 10 px con tope de 1,5 m; Ctrl lo desactiva. Selección múltiple: Mayús + clic, recuadro con Seleccionar (coge lo que toca), arrastrar uno mueve el grupo, Alt + arrastrar duplica el grupo. Ctrl+D copia las góndolas seleccionadas al lado con un pasillo de 2 m. L y Supr valen para varios.

**Tanda 3 (hecha y probada)**: muros interiores con la herramienta Muro cuando el contorno ya está cerrado (líneas abiertas, ajuste a 90°/45°, extremos imantados a esquinas y paredes, se terminan con doble clic, Intro o Esc). Con Muro en la mano los muros no se cogen; se editan con cualquier otra herramienta (esquinas, muro entero, recuadro, borrar con sus puertas). Puertas en cualquier tramo de muro, con el tipo nuevo Interior; el hueco se recorta del trazo del muro. Doble clic sobre un muro (contorno o interior) añade una esquina. Una góndola que atraviesa un muro sale roja y una cara contra un muro no suma lineal (`muroEntre`, que también servirá a la simulación). Lógica comprobada en Node.

**Ajustes tras la tanda 3**: con Puerta en la mano los muros no se cogen (`sobreMuros`, como Muro), para poder poner puertas en muros interiores. Pincel y goma con selector de forma Pincel / Rectángulo; el rectángulo enseña sus medidas mientras se arrastra (probado).

**Mueble y secciones en el mueble (hecho, pendiente de prueba a mano)**: herramientas Cabecera (C), Cubo (U) y Expo (X). Las secciones se pintan en las caras de góndola por tramos de 50 cm, en cabeceras y en piezas; el suelo solo lleva zonas sin venta. Lineal y piezas por sección en el panel. Formato de archivo v2 con migración de v1 (comprobada en Node, igual que lineal, choques entre mueble y copia de góndolas). Capa "Góndolas" pasa a llamarse Mobiliario. Botones de opción activos ahora con fondo de acento (antes salían en blanco).

Antes, ya probado: contorno con escala, puertas, góndolas con lineal útil, secciones y zonas pintadas, guardar y cargar (autoguardado + `.json`).

## Siguiente

- Fase 2: tienda demo y simulación sencilla.


## Conocido

- No se impide que el contorno se cruce consigo mismo.
- Escalar la tienda ya amueblada mueve las góndolas pero no cambia su tamaño, así que las que estaban pegadas se separan un poco.
- Pintura, lineal y manchas se recalculan enteros en cada cambio: ~7 ms en una tienda de 4.000 m² pintada entera (medido en Node). Si se nota al pintar, hacerlo incremental.
- Varias acciones seguidas en menos de 400 ms se deshacen juntas (la foto se toma tras una pausa o al soltar el ratón).
- No se pueden quitar esquinas sueltas (solo añadir con doble clic).
