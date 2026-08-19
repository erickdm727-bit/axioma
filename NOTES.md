# Notas de desarrollo — Axioma

## Mejoras hechas a Williams %R (referencia para replicar en otros indicadores)

Checklist de todo lo que tiene Williams %R que los demás indicadores "estándar" (RSI, Estocástico, SMA, EMA, Bollinger, Ichimoku, VWAP, etc.) todavía no tienen:

1. **Gráfico propio** (`drawWilliamsChart`) — velas + panel de oscilador debajo, en vez de solo chips de texto por temporalidad.
2. **Pan y zoom** en ese gráfico — arrastrar con mouse, rueda para zoom, doble clic para resetear, soporte touch en celular. Usa el helper genérico `__axAttachPanZoom`, ya reusable para cualquier gráfico nuevo.
3. **Vista por defecto de 180 velas** en vez de todo el historial completo (usa `__axWindowSlice`).
4. **Analizador de umbrales óptimos** (`analyzeWilliamsThresholds`) — calcula estadísticamente en qué nivel históricamente reversa el precio, separado para compra y venta.
5. **Botón "Optimizar parámetros"** en la pestaña de Backtest, conectado a ese analizador.
6. **Inputs de backtest editables** (`btWilliamsBuy` / `btWilliamsSell`) que se autollenan con lo que diga el optimizador. Se guardan en `BT_INDICATOR_CONFIG.williams` con los campos `buyThresh`/`sellThresh` (ojo: NO `buyThreshold`/`sellThreshold`, ese fue un bug que ya se corrigió).
7. **Dos líneas horizontales dinámicas** en el gráfico (tanto el normal como el del backtest), tomadas en vivo de esos mismos umbrales — antes eran fijas en -20/-50/-80.

### Orden de dependencias
- El punto 1 (gráfico) es prerrequisito de 2 y 7.
- El punto 4 (analizador) es prerrequisito de 5, 6 y 7.
- Si un indicador ya tuviera gráfico pero no optimizador, se podría saltar el paso 1 — pero por ahora Williams es el único indicador con gráfico en toda la app (confirmado revisando el código: solo existen `drawChart` (código muerto/huérfano) y `drawWilliamsChart`).

### Piezas reusables ya existentes (no hay que reinventarlas)
- `buildOscillatorSvg(hist, seriesValues, opts)` — dibuja el panel de oscilador con soporte para `refLines` dinámicas. Sirve para cualquier indicador 0-100 o -100-0 (RSI, Estocástico, Williams).
- `buildCandleSvg(hist, opts)` — panel de velas.
- `__axAttachPanZoom(paneEl, key, redraw)` — pan/zoom genérico, idempotente.
- `__axWindowSlice(full, key, defaultBars)` — ventaneo del historial.

## Plan: agregar gráfico propio a cada indicador (paso 1 de la replicación)

Orden sugerido, empezando por los más parecidos a Williams (osciladores acotados 0-100):
1. RSI — HECHO (gráfico agregado y verificado en vivo: candlestick + oscilador RSI(14) con líneas 30/70, pan/zoom, selector de marco temporal). Commit: "Add dedicated chart to RSI indicator..."
2. Estocástico — HECHO (gráfico agregado y verificado en vivo: candlestick + oscilador %K(14) con líneas 20/80, pan/zoom, selector de marco temporal). Commit: "Add dedicated chart to Stochastic indicator..."
3. SMA — HECHO, con una salvedad importante: SMA no es un oscilador acotado 0-100 como Williams/RSI/Stoch, es una media que normalmente se dibuja ENCIMA del precio (overlay), no en un panel separado. buildCandleSvg/finishCandleSvg (las funciones que dibujan las velas, compartidas por los 4 indicadores) NO tienen soporte para dibujar líneas overlay todavía. Por seguridad (no tocar el render compartido sin supervisión), hice SMA(20) como panel propio separado abajo (mismo patrón que los osciladores, pero con auto-escala en vez de 0-100), NO overlay sobre el precio. Funciona y está verificado en vivo, pero si quieres el look "de verdad" (línea de SMA encima de las velas), eso requiere extender buildCandleSvg con un parámetro opts.overlays — pendiente, decisión de diseño para revisar juntos. Commit: "Add dedicated chart to SMA indicator..."
4. EMA — HECHO, mismo patrón que SMA (panel propio con EMA(20) auto-escalada, no overlay). Verificado en vivo junto con regresión de Williams/RSI/Stoch/SMA (los 5 renderizan sin NaN ni errores). Commit: "Add dedicated chart to EMA indicator..."
5. EMA Cloud — HECHO. Este no siguio el patron de panel de una linea: hice un SVG propio (sin tocar buildOscillatorSvg ni buildCandleSvg) con EMA(20) y EMA(50) como dos lineas mas el area sombreada entre ellas (verde si EMA20>=EMA50, rojo si no). Verificado en vivo con regresion completa de los 6 indicadores ya hechos, cero errores. Commit: "Add dedicated chart to EMA Cloud indicator..."
6. Siguiente: Bollinger Bands (banda superior/inferior + precio — tambien es tipo overlay, mismo enfoque de SVG propio que EMA Cloud probablemente aplique bien)
7. (resto — Ichimoku, VWAP Anclado, Acum/Distrib., Heikin Ashi Semanal, Patrones de velas, Fuerza relativa, Setup Beardo, Soportes/Resistencias)

Cada uno se hace y se verifica en vivo con datos reales antes de pasar al siguiente.
