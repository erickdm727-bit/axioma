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
3. Siguiente: Medias Móviles (SMA)
4. (resto de indicadores "estándar" — EMA, EMA Cloud, Bollinger, Ichimoku, VWAP Anclado, Acum/Distrib., Heikin Ashi Semanal, Patrones de velas, Fuerza relativa, Setup Beardo, Soportes/Resistencias)

Cada uno se hace y se verifica en vivo con datos reales antes de pasar al siguiente.
