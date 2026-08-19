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
6. Bollinger Bands — HECHO. Descubri que ya existia una funcion bollingerSvgPaths(candles,xOf,yOf,period,mult) en el codigo (parte de un drawChart() viejo/muerto, sin elemento HTML — no se usa en produccion pero el algoritmo era correcto). No la reuse directamente (habria requerido duplicar el calculo de mid/sd de todos modos para el auto-escalado), pero SI confirme que el enfoque matematico es el mismo: SMA(20) +/- 2 desviaciones estandar. Panel propio con banda superior, banda inferior, relleno del canal, y linea de media punteada. Verificado en vivo con regresion completa de los 7 indicadores, cero errores. Commit: "Add dedicated chart to Bollinger Bands indicator..."

Dato importante para el futuro: el drawChart() muerto tambien tiene un patron ya resuelto para dibujar overlays de EMA/Bollinger ENCIMA de las velas (maLineSvgPath + bollingerSvgPaths con xOf/yOf compartidos con las velas). Si en algun momento decidimos hacer overlays de verdad (en vez de panel separado) para SMA/EMA/Bollinger, ese codigo muerto es la referencia a seguir — ya resolvieron el problema de alineación de coordenadas antes.

7. Ichimoku — HECHO PARCIAL, a proposito. Ichimoku completo son 5 lineas: Tenkan-sen(9), Kijun-sen(26), Senkou Span A/B (que forman la nube Kumo, desplazada 26 periodos HACIA ADELANTE), y Chikou Span (precio desplazado 26 periodos HACIA ATRAS). Implemente solo Tenkan-sen y Kijun-sen (el cruce entre estas dos es en si una senal valida y muy usada). NO implemente la nube Kumo ni el Chikou porque requieren desplazamiento temporal (mostrar valores calculados hace 26 velas en la posicion actual, y proyectar 26 velas hacia el futuro donde no hay velas todavia) — es facil hacerlo mal y mostrar una nube en el lugar equivocado, lo cual en una herramienta de trading real es peor que no mostrarla. Lo deje documentado aqui en vez de improvisar. Verificado en vivo con regresion de los 8 indicadores, cero errores. Commit: "Add dedicated chart to Ichimoku indicator..."

8. VWAP Anclado — HECHO. Encontre anchoredVwapFromLow(candlesAsc, lookback=100) ya en el codigo (busca el minimo mas bajo en las ultimas 100 velas y ancla desde ahi), pero solo devuelve el valor FINAL, no una serie. Reimplemente la misma logica de anclaje pero calculando el VWAP acumulado en cada vela desde el ancla, para poder dibujar la linea completa. Verificado en vivo con regresion de los 9 indicadores, cero errores. Commit: "Add dedicated chart to VWAP Anclado indicator..."

9. Acumulacion/Distribucion — HECHO. Encontre adLine(candlesAsc) ya en el codigo pero solo devuelve {rising, delta} (resumen), no la serie. La formula interna (CLV = ((close-low)-(high-close))/range, ad += CLV*volumen, acumulado) es simple asi que la reimplemente directo para tener la serie completa. Sin offset/lookback, arranca desde la primera vela. Verificado en vivo con regresion de los 10 indicadores, cero errores. Commit: "Add dedicated chart to Acumulacion/Distribucion indicator..."

10. HECHO: Heikin Ashi Semanal. Se agrego drawHeikinChart/renderHeikinChart, reutilizando la funcion existente heikinAshi(candlesAsc) (ya devuelve la serie completa transformada {open,close,high,low,datetime}, no fue necesario reimplementar nada) alimentada directo a buildCandleSvg/finishCandleSvg como grafico PRINCIPAL (no tiene panel de oscilador propio, oscWrapEl.innerHTML se deja vacio). Fijo al timeframe semanal (result.seriesByTf["1week"]), sin selector de timeframe (a diferencia de todos los demas indicadores, esta tarjeta no incluye el div tf-selector).

Bug encontrado y corregido en vivo: la primera version uso result.seriesByTf["1S"] (la ETIQUETA visible del selector) en lugar de result.seriesByTf["1week"] (la KEY real con la que se guarda la serie, confirmado revisando la config de timeframes: { key:"1week", label:"1S", kind:"direct", interval:"1week", outputsize:230 }). Esto hacia que el grafico SIEMPRE cayera en el estado vacio ("No hay datos suficientes en el marco semanal") sin importar el ticker, incluso con datos validos (verificado con la API de Twelve Data devolviendo 230 velas semanales OK para el ticker de prueba). Corregido cambiando la key a "1week". Verificado en vivo con ticker fresco (KO): el grafico ahora renderiza velas Heikin Ashi semanales reales, sin NaN, con leyenda visible. Regresion de los 10 indicadores anteriores (williams, rsi, stoch, sma, ema, emacloud, bb, ichi, vwap, ad) sigue limpia, cero errores de consola.
Commits: "Add dedicated chart to Heikin Ashi Semanal indicator" + fix "Fix Heikin Ashi chart: correct seriesByTf key from \"1S\" to \"1week\"".

11. HECHO: Patrones de velas. Se agrego drawPatternsChart/renderPatternsChart. A diferencia de los demas indicadores, la funcion existente detectPatterns(candlesAsc) NO devuelve una serie completa: solo evalua las ultimas 3 velas del array que se le pasa (usa candlesAsc[n-1], [n-2], [n-3] y las 6 anteriores para la tendencia), devolviendo un array de {pattern, bias} para ese punto. Para poder marcar patrones a lo largo de todo el historial visible, el grafico nuevo llama detectPatterns(hist.slice(i-6, i+1)) para cada barra i de la ventana (equivalente a pasar el historial completo hasta i, ya que la funcion solo lee las ultimas 7 velas) — sin modificar detectPatterns en absoluto.

El grafico principal reutiliza buildCandleSvg/finishCandleSvg (igual que Heikin Ashi, sin panel de oscilador propio) y le agrega marcadores encima: triangulo verde debajo de la vela para patrones alcistas, triangulo rojo arriba para bajistas, circulo amarillo para neutros (Doji), cada uno con un <title> SVG con el/los nombre(s) del patron para hover. Los marcadores se inyectan en el string SVG ya terminado (antes del cierre </svg>) usando los mismos xOf/yOf que devolvio buildCandleSvg, para que queden alineados exactamente con las velas y dibujados POR ENCIMA de estas. La leyenda debajo del grafico lista en texto los ultimos 3 patrones detectados en la ventana visible con fecha (via fmtDateShort) y sesgo.

Los 13 tipos de patron que reconoce detectPatterns (sin cambios): Doji, Martillo, Hombre Colgado, Estrella Fugaz, Martillo Invertido, Envolvente Alcista/Bajista, Estrella de la Mañana/Tarde (+ variantes Doji), Tres Soldados Blancos, Tres Cuervos Negros.

Verificado en vivo con ticker fresco (PFE): el grafico muestra velas reales con marcadores de patrones correctos (Doji y Envolvente Alcista detectados en fechas reales), leyenda con texto correcto, sin NaN. Regresion de los 11 indicadores anteriores (williams, rsi, stoch, sma, ema, emacloud, bb, ichi, vwap, ad, heikin) sigue limpia, cero errores de consola.
Commit: "Add dedicated chart to Candlestick Patterns indicator".

12. HECHO: Fuerza Relativa vs Mercado. Se agrego drawRelChart/renderRelChart. La funcion existente computeRelativeStrength(tickerDaily, benchmarkDaily, lookback) tampoco sirve para un grafico: solo devuelve un resumen escalar (retorno del ticker, retorno del benchmark, exceso) sobre un lookback fijo, no una serie. El grafico nuevo reimplementa la logica como serie completa: alinea el historial diario del ticker (result.seriesByTf["1day"]) con el historial diario del benchmark (result.benchmark.series) recortando ambos al mismo largo por la cola (mismo criterio de alineacion por indice que ya usaba computeRelativeStrength), les aplica la misma ventana de pan/zoom (__axWindowSlice con la key "rel" aplicada a ambos arrays ya alineados, lo que garantiza que devuelvan el mismo rango), y calcula un ratio normalizado RS[i] = (ticker.close[i]/ticker.close[0]) / (bench.close[i]/bench.close[0]) * 100 para cada barra visible. El grafico principal (velas) muestra el precio del ticker via buildCandleSvg; el panel de abajo muestra la linea de fuerza relativa via buildOscillatorSvg con una linea de referencia punteada en 100 (rendimiento igual al benchmark). Sin selector de timeframe (a diferencia de la mayoria) porque el benchmark solo se descarga en diario, igual que Heikin Ashi.

Hallazgo importante durante la verificacion: el modulo "Fuerza relativa" tiene su propio toggle/checkbox independiente de los "metodos" (chips como "Método Williams R%"), y ese toggle estaba apagado en la configuracion de prueba usada durante esta sesion — por eso la app nunca llamaba a la API del benchmark (SPY) y el grafico caia siempre en "Sin datos suficientes del benchmark SPY", incluso con datos reales disponibles. No es un bug del grafico: es el comportamiento esperado cuando el modulo esta desactivado. Se activo el toggle "Fuerza relativa" manualmente para poder verificar. Erick: si este modulo aparece vacio en uso normal, revisa que el checkbox "Fuerza relativa" este activado en la configuracion "Personalizado" (o que el metodo elegido lo incluya).

Verificado en vivo con ticker fresco (HON, benchmark SPY): el grafico muestra velas reales de HON + linea de fuerza relativa mostrando "por debajo de SPY por 15.1%", sin NaN. Regresion de los 12 indicadores anteriores sigue limpia, cero errores de consola.
Commit: "Add dedicated chart to Fuerza Relativa vs Mercado indicator".

13. HECHO: Setup Beardo
Grafico dedicado: velas diarias (1day) como grafico principal, SIN panel de oscilador (este indicador es un checklist compuesto multi-timeframe, no una serie continua — no tiene sentido graficarlo como linea historica). En vez de reimplementar el checklist, se reutiliza setupChecklist(seriesByTf, currentPrice) tal cual, y se muestra el resultado como leyenda de texto con iconos de color (verde = cumple, gris = no cumple), formato "X/5 condiciones cumplidas" + detalle de cada condicion.

BUG encontrado y corregido: la primera version asumia que setupChecklist() devolvia un array de condiciones directamente (igual que detectPatterns). En realidad devuelve un objeto envoltorio { conditions, passCount, total, score } — el array real esta en .conditions. Como el codigo original hacia `setupChecklist(...) || []`, el fallback `[]` nunca se activaba (el objeto es truthy), asi que `conditions.filter(...)` fallaba con "conditions.filter is not a function". Este error no aparecia en la consola ni en window.onerror porque analyze() tiene un try/catch de nivel superior que lo capturaba silenciosamente y solo lo mostraba en el texto de #statusLine (con clase "err") — la leyenda del grafico se quedaba vacia sin ninguna pista visible del problema. Diagnosticado revisando el contenido de #statusLine tras el analisis. Corregido cambiando la linea a:
`const conditions = (setupChecklist(result.seriesByTf, price) || {}).conditions || [];`

Verificado en vivo con ticker fresco (MMM): el grafico muestra velas diarias reales de MMM sin NaN, y la leyenda ahora muestra el checklist real: "2/5 condiciones cumplidas" con el detalle de cada condicion (vela semanal Heikin Ashi verde ✓, VWAP anclado ✓, media de 10 dias ✗, nube EMA 4h ✗, ruptura de tendencia bajista ✗). #statusLine sin clase de error, texto normal de "Listo". Regresion de los 13 indicadores anteriores (williams, rsi, stoch, sma, ema, emacloud, bb, ichi, vwap, ad, heikin, patterns, rel) sigue limpia — todos con SVG real y cero NaN. Cero errores de consola.
Commit grafico: "Add dedicated chart to Setup Beardo indicator".
Commit fix bug: "Fix Setup Beardo checklist: setupChecklist returns wrapper object, not bare array".

14. HECHO: Soportes/Resistencias (ultimo indicador estandar)
Grafico dedicado: velas del timeframe seleccionable (por defecto 4h, con selector de marco temporal igual que Williams/RSI/etc.), SIN panel de oscilador (los niveles de soporte/resistencia son precios estaticos, no una serie continua). En vez de reimplementar la deteccion de niveles, se reutiliza computeSupportResistanceLevels(hist, price) tal cual sobre la ventana de velas visible (mismo enfoque que Patterns: recalculo directo sobre el hist visible, no sobre el resultado precalculado de analyze() que usa su propio candle set interno). La funcion combina tres fuentes de niveles: pivotes de precio (maximos/minimos locales de 90 velas), retrocesos de Fibonacci (23.6/38.2/50/61.8/78.6%) del rango reciente, y el pivote trimestral (PP, R1, S1). Los niveles cercanos se agrupan en clusters ("confluencia" cuando coinciden varios tipos).

Visualizacion: los 3 soportes mas cercanos (verde #3ECF8E) y las 3 resistencias mas cercanas (rojo #FF5C5C) se dibujan como lineas horizontales punteadas sobre las velas, con etiqueta de precio y tipo de nivel (Pivote / Fibonacci / Pivote trimestral / Confluencia). La leyenda debajo del grafico muestra el soporte y la resistencia mas cercanos al precio actual.

Verificado en vivo con ticker fresco (JNJ, timeframe 4h): 130 elementos de linea renderizados, colores de soporte/resistencia correctos, leyenda mostrando "Soporte mas cercano: $269.21 · Resistencia mas cercana: $274.90" (valores reales, sin NaN). Regresion completa de los 14 indicadores anteriores (williams, rsi, stoch, sma, ema, emacloud, bb, ichi, vwap, ad, heikin, patterns, rel, setup) sigue limpia. Cero errores de consola. #statusLine sin clase de error.
Commit: "Add dedicated chart to Soportes/Resistencias indicator".

=== LISTA COMPLETA: los 15 indicadores estandar ya tienen su propio grafico dedicado (velas + pan/zoom + selector de temporalidad donde aplica) siguiendo el patron de Williams %R: williams, rsi, stoch, sma, ema, emacloud, bb, ichi, vwap, ad, heikin, patterns, rel, setup, sr. ===

Pendiente para revisar con Erick (no se toca sin supervision):
- Overlay real de precio para SMA/EMA/EMA Cloud/Bollinger (dibujar las lineas de la media/banda directamente sobre las velas, en vez de solo el panel de oscilador). Requiere extender buildCandleSvg/finishCandleSvg con soporte para overlays.
- Ichimoku completo: falta Senkou Span A/B (nube Kumo) y Chikou Span en el grafico dedicado.

## Modo prueba (sin consumir API)

Boton "Modo prueba" junto al buscador de ticker. Al activarlo: el ticker se fija en AAPL (solo lectura), el benchmark se fija en SPY (solo lectura), y aparece un aviso amarillo dejando claro que son datos congelados de ejemplo, no precios en vivo.

Como funciona (auto-sembrado, sin archivo de datos en el repo): la PRIMERA vez que se activa el modo prueba y se pulsa Analizar, la app hace una unica ronda real de llamadas a Twelve Data (los 8 marcos temporales que usan los graficos: 5min, 30min, 1h, 2h, 4h, 1day, 1week, 1month, mas el benchmark SPY diario) y guarda el resultado completo en localStorage bajo la clave axTestModeDataV1. A partir de ahi, mientras el modo prueba este activo, CADA analisis (tantos como quieras) lee de ese cache local y no hace ninguna llamada a la API — verificado con la herramienta de red: segundo y tercer analisis con modo prueba activo, cero peticiones a api.twelvedata.com. El cache sobrevive a recargas de pagina y a cerrar el navegador (localStorage persiste).

Los dos puntos de entrada a la API pagada (fetchSeries y fetchCurrentPrice) llevan un guardado `if(__AX_TEST_MODE__ && !__AX_TEST_SEEDING__)` al principio: si el modo prueba esta activo devuelven datos del cache en vez de llamar a tdFetch. El flag __AX_TEST_SEEDING__ evita que la propia siembra inicial (que SI necesita llamar a fetchSeries de verdad) se quede atrapada en su propio cache vacio. El resto del pipeline (analyze(), todos los modulos, los 15 graficos) no se toco — consumen el resultado exactamente igual que con datos reales, por eso los 15 indicadores funcionan igual en modo prueba que en modo normal.

Si se quieren datos de prueba mas recientes, el aviso amarillo incluye un enlace "Actualizar datos ↻" que borra el cache y vuelve a sembrarlo (otra ronda real de llamadas, una sola vez).

Verificado en vivo: activacion + primer analisis (con espera real por el limite de 6-8 peticiones/min de Twelve Data, la app ya maneja esto sola con reintentos), luego 2 analisis mas sin ninguna peticion de red a Twelve Data (confirmado con la herramienta de inspeccion de red), los 15 graficos con datos y sin NaN, cero errores de consola. Tambien se confirmo que el modo normal (boton desactivado) sigue funcionando sin cambios: ticker real XOM analizado con datos en vivo despues de desactivar el modo prueba.
Commit: "Add offline test mode (AAPL, self-seeding via localStorage, zero API cost after first use)".

## 2026-08-19 - Setup Beardo: grafico eliminado + EMA Cloud 20/50 y 50/100: graficos nuevos

Dos cambios pedidos por Erick a partir de capturas de pantalla:

1) Setup Beardo (5 condiciones): se elimino por completo el grafico de velas dedicado que tenia (HTML del card, las funciones drawSetupChart/renderSetupChart, y la llamada renderSetupChart(r) en el dispatch de analyze()). El modulo vuelve a su estado original: solo checklist + score, sin grafico. Instruccion explicita: no se debe volver a modificar este modulo despues de este cambio.

2) EMA Cloud 20/50 y EMA Cloud 50/100: estos dos modulos (distintos del modulo generico "EMA Cloud" que ya tenia grafico) no mostraban ningun grafico, solo el selector de marco temporal vacio. Se investigo el modulo generico emacloud (que ya calculaba EMA(20)/EMA(50) con nube) y se uso como plantilla:
- emacloud2050: clon exacto del generico (mismos periodos 20/50), apuntando a los IDs propios del modulo (chartSvg-emacloud2050, etc.) para que tenga su propio grafico independiente.
- emacloud50100: misma logica pero con EMA(50)/EMA(100) en vez de EMA(20)/EMA(50).
Ambos siguen el patron estandar: candlestick arriba (finishCandleSvg) + panel pequeno abajo con las dos EMAs y la nube alcista/bajista entre ellas, leyenda con colores, selector de marco temporal multi-timeframe (igual que el resto de indicadores estandar).

Verificado en vivo con datos reales (AAPL vía modo prueba, sin gastar API): las 16 graficas restantes (williams, rsi, stoch, sma, ema, emacloud, emacloud2050, emacloud50100, bb, ichi, vwap, ad, heikin, patterns, rel, sr) renderizan bien, sin NaN. Setup Beardo confirmado sin elemento de grafico (chartSvg-setup ya no existe), checklist y score intactos ("SESGO ALCISTA score +0.20"). EMA Cloud 20/50 muestra leyenda "EMA(20) EMA(50)" y EMA Cloud 50/100 muestra "EMA(50) EMA(100)", ambos con 3 paths SVG (nube + 2 lineas) en el panel. Cero errores de consola, cero peticiones a Twelve Data durante la prueba (modo prueba funcionando correctamente).
Commits: "Remove dedicated chart from Setup Beardo (5 condiciones)" y "Add EMA Cloud 20/50 and 50/100 dedicated charts".
