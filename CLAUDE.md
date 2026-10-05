# CLAUDE.md: Planta

Editor y simulador de tiendas en el navegador. El usuario dibuja la planta de su tienda (contorno, puertas, góndolas, secciones), le da sus datos de venta y ve a los clientes moverse por ella como puntos. Sirve para comparar distribuciones: la tienda A contra la B con el mismo modelo, nunca como predicción absoluta.

Pieza de portfolio. Nace de cuatro años de Álvaro en Decathlon. Se publicará en `alvaroalcaraz.com/planta/`. Estado vivo en `docs/STATUS.md`.

## Stack

- TypeScript + Vite + PixiJS 8. Sin backend: una tienda es un JSON.
- Salida estática con rutas relativas (`base: './'`). La CSP del portfolio no admite nada en línea: ni scripts ni estilos en `index.html`.
- Solo escritorio (el portfolio es de PC).

## Decisiones cerradas

**Alcance v1**: una planta, sin almacén ni trastienda operativa. Se complica cuando el producto funcione.

**Espacio**
- Rejilla de 50 cm (ancho aproximado de una persona). Todo se ajusta a ella.
- Contorno: polígono por clics, ajuste a rejilla y a ángulos de 90°/45°. El usuario mete los m² y la escala sale de ahí.
- Zonas sin venta pintadas en el suelo: cajas, zona privada (los clientes no la cruzan), baños, probadores. Las cajas son de momento una zona pintada; las cajas individuales con su cola llegan en la fase 3.
- **Mueble** (todo en la rejilla de 50 cm, todo es obstáculo para los clientes):
  - **Góndola**: largo variable, stock por las dos caras. Pegada a pared, la cara de la pared queda inútil sola: no hay pieza "mural".
  - **Cabecera**: 1 m (el fondo de la góndola) × 0,5 m, en perpendicular. Solo existe pegada a un extremo de góndola, como mucho una por extremo; vive dentro de la góndola (`cabeceras`) y se mueve y borra con ella.
  - **Cubo** (1 × 1 m) y **expo** (2 × 2 m) por defecto, medida editable: piezas sueltas, de una sección entera o de ninguna. La expo adorna pero ocupa sitio y desvía el paso como un cubo.
- **Las secciones se pintan en el mueble, no en el suelo** (decidido el 2026-10-05, formato de archivo v2): cada cara de góndola por tramos de 50 cm (una góndola puede compartir varias secciones en el mismo pasillo, y cada cara mira a un pasillo), cada cabecera y cada pieza. Una cara que no da a ningún pasillo (pared, muro u otro mueble delante) no se pinta. Los archivos v1 migran solos: cada tramo hereda la sección del suelo que tenía delante.
- La medida de una sección es su **lineal** (metros de tramo pintado con suelo libre delante, más 1 m por cabecera) y sus cubos y expos, no m² de suelo.
- Una sección puede tener varias manchas sueltas (ciclismo al fondo y un cubo de ciclismo en la entrada). El cliente elige destino según el lineal de cada mancha; cubos y expos atraen por su cuenta.

**Datos de entrada** (lo que da la app de tienda de Decathlon: tienda > sección > familia > subfamilia > producto, por hora, en € o unidades)
- Por sección: ventas por hora y cesta media, en la misma unidad (€ o unidades, da igual: la cuenta es la misma).
- Por tienda: ventas por hora, cesta media, frecuentación por hora (contador de la puerta antirrobo) y cajeros por hora.
- La tienda demo trae números inventados y creíbles, sin datos ni marca de Decathlon. La app se abre ya funcionando.

**Modelo**
- Compradores de la sección por hora = ventas ÷ cesta media. Igual para la tienda.
- Secciones por comprador = suma de compradores de sección ÷ compradores de tienda.
- Visitantes = frecuentación; los que no compran pasean con los mismos pesos y no pasan por caja.
- La venta se registra en caja: la entrada del cliente se adelanta para que los picos no salgan corridos.
- Movimiento: un mapa de distancias por sección (un recorrido de la rejilla desde cada una); los clientes bajan hacia su destino. Coste independiente del número de clientes. Cerrar un pasillo = bloquear celdas y recalcular los mapas.
- Muros y puertas en la simulación: un paso entre dos celdas está cerrado si lo corta un muro, salvo que en ese punto haya una puerta (hoy `muroEntre` no mira puertas: arreglarlo al empezar la fase 2).
- Sentido de las puertas con dos mapas de caminos: mientras compra, las puertas de Salida están cerradas; al irse (tras cajas), las de Entrada. Interior, en los dos sentidos. Emergencia, cerrada salvo evacuación. Así un recibidor con puerta exterior e interior funciona sin más (decidido el 2026-10-05 a raíz del recibidor de Álvaro).
- Cubos (y cabeceras) son obstáculos con su sección: atraen a los clientes de esa sección según sus ventas de esa hora, aunque estén lejos del resto de la sección. Si muchos se paran en el mismo cubo, se forma un cuello de botella (Álvaro, 2026-10-05).
- Simulación determinista con semilla. Se precalcula el día y la línea de tiempo lo reproduce; un evento a mitad de día (cierre de pasillo) re-simula desde ese momento.
- Los números importan más que los puntos: tiempo medio en tienda, espera en cola, mapa de calor de atascos y gente que pasa por delante de cada sección.

**Visual** (referencia: Mini Motorways, de Dinosaur Polo Club)
- Vista cenital plana, fondo gris muy claro y frío. Nada de crema ni naranja.
- Secciones: manchas planas de color suave. Góndolas: barras gris carbón con esquinas redondeadas.
- Clientes: puntos verdes con rastro corto. Trabajadores: puntos rojos.
- Tipografía sans redonda, alojada en el propio proyecto (la CSP del portfolio no deja cargar fuentes de fuera).

**Editor** (estilo Paint/Figma, decidido el 2026-10-05)
- La herramienta activa solo decide qué se crea al pulsar en vacío. Lo que ya existe se edita desde cualquier herramienta (`edicion.ts`).
- Con pincel y goma gana la pintura: no se cogen objetos al pasar por encima.
- Candado por objeto y por capa. Lo bloqueado solo se selecciona con Seleccionar, para poder desbloquearlo.
- Deshacer con fotos del JSON de la tienda, tomadas tras una pausa o al soltar el ratón.
- Góndolas siempre en la rejilla de 50 cm, sea cual sea el zoom.
- Imán entre góndolas solo por bordes (siempre en la rejilla), vecinas a 3 m o menos; Ctrl lo quita.
- Muros interiores: líneas abiertas sobre las líneas de la rejilla, así que separan celdas en vez de ocuparlas (`muroEntre`). Con Muro o Puerta en la mano no se cogen (`sobreMuros`), para poder dibujar o poner puertas encima.
- Las puertas van en cualquier tramo de muro (contorno o interior); tipos: entrada, salida, emergencia, interior.

## Fases

1. Editor: contorno con escala, puertas, góndolas, zonas y secciones. Guardar y cargar JSON.
2. Simulación sencilla: entran, visitan 1-3 secciones al azar, pagan y salen esquivando góndolas.
3. Datos reales: curvas por hora, pesos, cajeros, colas, línea de tiempo.
4. Eventos (cierres, trabajadores como puntos rojos), mapa de calor, comparación A/B.

## Cómo trabajar aquí

- Medir antes de optimizar. El Web Worker para la simulación entra solo si hace falta.
- La lógica de simulación no depende de PixiJS, para poder probarla en Node.
