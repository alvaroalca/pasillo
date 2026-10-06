# Pasillo

Simulador de tiendas en el navegador. Dibujas la planta de tu tienda (paredes, puertas, góndolas, cajas) y pintas cada sección sobre su mueble. Después reproduces un día real de ventas: cada ticket es un cliente que entra, recorre sus secciones esquivando el mueble y a los demás, hace cola y paga. Sirve para comparar dos colocaciones con la misma gente: dónde se forman los atascos y cuánto tiempo se pierde en ellos.

**Probar:** [alvaroalcaraz.com/pasillo](https://alvaroalcaraz.com/pasillo/)

## Cómo está hecho

- TypeScript + Vite + PixiJS 8. Sin backend: una tienda es un JSON.
- La simulación no depende de PixiJS y se prueba en Node. Es determinista: con la misma tienda y el mismo día sale siempre lo mismo, y por eso dos colocaciones se pueden comparar.
- Movimiento sobre una rejilla de 50 cm con un mapa de distancias por sección (Dijkstra), así que el coste no crece con el número de clientes.
- El histórico de la demo es inventado (`scripts/generar-historico.ts`, semilla fija), con cifras de un hipermercado de deporte de costa de 2.000 m².

## Ejecutar en local

```
npm install
npm run dev
```

## Licencia

MIT. Ver [LICENSE](LICENSE).
