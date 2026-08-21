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

## 2026-08-19 - Modo prueba: cache permanente para cualquier ticker (no solo AAPL)

Erick pidio que el modo prueba deje de pedirle datos a Twelve Data cada vez y que, en cambio, pida cada dato una unica vez y lo guarde para siempre. Se encontro la causa raiz: el modo prueba estaba disenado solo para un ticker fijo (AAPL, con el input bloqueado en solo lectura) y la funcion de sembrado usaba una unica llamada recursiva a ensureTestModeData() sin soporte para otros tickers.

Rediseno:
- Se elimino el bloqueo del campo de ticker (y del de benchmark) en modo prueba: ahora se puede escribir cualquier ticker, igual que en modo normal.
- Nuevo cache generico en localStorage (axTestGenericCacheV1) indexado por "simbolo|intervalo|outputsize" para las series, y por simbolo para el precio actual. fetchSeries y fetchCurrentPrice, en modo prueba, primero consultan este cache; si el dato ya existe lo devuelven al instante; si no existe, hacen la peticion real a Twelve Data UNA sola vez, la guardan en el cache y la devuelven.
- El cache viejo de AAPL (axTestModeDataV1) se migra automaticamente la primera vez que se usa el nuevo cache, para no perder los datos de AAPL ya descargados en sesiones anteriores.
- El banner de modo prueba y el enlace "Borrar cache guardada" se actualizaron para reflejar el comportamiento general (ya no menciona solo AAPL) y ahora muestra la fecha real del ultimo guardado.

Bug encontrado y corregido durante la verificacion: la primera version de este cambio reintrodujo el flag __AX_TEST_SEEDING__ como guarda de reentrada (heredado del diseno viejo). Como analyze() pide varios timeframes en paralelo, ese flag global hacia que solo la PRIMERA peticion concurrente pasara por la rama de cache-y-guardar; el resto caia al camino normal (sin persistir en el cache de modo prueba). Resultado: solo se guardaba 1 de los 8 timeframes por ticker. Se quito el guard de reentrada (ya no hace falta, fetchSeries/fetchCurrentPrice ya no se llaman a si mismas recursivamente en el nuevo diseno) y se verifico que los 8 timeframes + el benchmark quedan guardados correctamente.

Verificado en vivo: se borro el cache viejo y el nuevo, se activo modo prueba, se analizo AAPL desde cero (8 llamadas reales a Twelve Data, una por timeframe, respetando el limite de 6/min) y se confirmo que las 8 quedaron guardadas en axTestGenericCacheV1. Se volvio a analizar AAPL y salio instantaneo, con cero peticiones de red a Twelve Data (confirmado con la herramienta de inspeccion de red). La fecha del banner ("Ultimo guardado") ahora se actualiza sola tras cada guardado. Los 16 graficos siguen renderizando bien, sin NaN, cero errores de consola.
Commits: "Test mode: cache any ticker permanently, fetch once per symbol/interval", "Fix test mode concurrency bug: only first parallel timeframe fetch was cached", "Refresh test mode banner date after each save".

## 2026-08-19 - Overlay real de precio: SMA/EMA/EMA Cloud/Bollinger sobre las velas

Ultimo punto pendiente listado en NOTES.md: hasta ahora SMA, EMA, EMA Cloud y Bollinger dibujaban su indicador solo en el panel pequeno debajo de las velas (escala propia, lineal, 900x120), nunca directamente sobre el precio. Se agrego el overlay real.

Como se hizo: buildCandleSvg(hist, opts) ya devuelve, ademas del string SVG, las funciones xOf(i) y yOf(precio) que usa internamente para dibujar las velas (escala logaritmica, mismo rango que los máximos/mínimos visibles). Bastaba con reutilizar esas mismas funciones (candleCtx.xOf / candleCtx.yOf) para trazar el indicador con las coordenadas EXACTAS de la escala de precio, en vez de reimplementar una escala propia — asi la alineacion queda garantizada por construccion, no por ajuste visual.

Patron aplicado en los 4 modulos: se calcula la serie del indicador (igual que antes), se construye un path SVG con candleCtx.xOf(indice)/candleCtx.yOf(valor), y se inyecta dentro del SVG de las velas ya generado (con la tecnica ya usada en Soportes/Resistencias: quitar los ultimos 6 caracteres "</svg>", concatenar el overlay, volver a cerrar). El panel pequeno de abajo se dejo intacto (no se quito nada), asi que ahora se ve el indicador dos veces: encima de las velas (nuevo, real) y en el panel aparte (como antes, para contexto/zoom).

- SMA(20): una linea celeste (#5BC0EB) sobre el precio.
- EMA(20): una linea violeta (#C77DFF) sobre el precio.
- EMA Cloud (generico, 20/50): las dos EMAs (celeste/violeta) mas la nube de relleno entre ellas (verde si alcista, rojo si bajista), igual que en el panel pero ahora tambien sobre las velas.
- Bollinger (20, 2 sigma): banda superior e inferior (celeste) con relleno translucido entre ellas, mas la media movil central (violeta, punteada).

Nota: EMA Cloud 20/50 y 50/100 (los modulos nuevos separados del generico) NO se tocaron en este cambio — se dejaron fuera a proposito para no ampliar el alcance sin que Erick lo pida. Se puede replicar el mismo patron para esos dos en cualquier momento, es codigo casi identico.

Verificado en vivo con datos reales (AAPL via modo prueba, cero costo de API): los 4 overlays aparecen correctamente sobre las velas, coordenadas dentro del rango esperado del grafico, sin NaN. Confirmado visualmente por captura de pantalla que la linea de SMA(20) sigue el precio de forma natural, cruzando por dentro de las velas donde corresponde. Bollinger muestra banda superior por encima, inferior por debajo y media al centro, en el orden correcto. Regresion completa: las 16 graficas del sitio siguen renderizando bien, cero errores de consola, emacloud2050/emacloud50100/setup no se vieron afectados (verificado que sus funciones siguen intactas en el codigo fuente).
Commit: "Add real price overlay for SMA/EMA/EMA Cloud/Bollinger on candlesticks".

## 2026-08-19 - Se quito el panel separado de abajo en SMA/EMA/EMA Cloud/Bollinger

Erick pidio quitar el panel pequeno de abajo (oscSvg) en los 4 modulos donde se agrego el overlay real sobre las velas, ya que ahora es informacion duplicada (la misma linea se veia dos veces: sobre las velas y en el panel aparte).

Se reemplazo el bloque que llamaba a buildOscillatorSvg / dibujaba el panel de escala propia por simplemente oscWrapEl.innerHTML = "" en los 4 casos (SMA, EMA, EMA Cloud, Bollinger). La funcion buildOscillatorSvg no se toco, sigue en uso por los demas indicadores (Williams, RSI, Estocastico, VWAP, AD, etc.) que no tienen overlay real todavia.

Verificado en vivo: el div del panel queda vacio y colapsa a 0 de alto (sin hueco visual), la tarjeta de cada modulo ahora termina justo despues del grafico de velas + leyenda. Los 4 overlays siguen intactos (SMA 1 path, EMA 1 path, EMA Cloud 3 paths, Bollinger 4 paths, sin NaN). Regresion completa de las 16 graficas sin cambios, cero errores de consola. EMA Cloud 20/50, 50/100 y Setup Beardo no se tocaron.
Commit: "Remove separate bottom panel for SMA/EMA/EMA Cloud/Bollinger (now overlaid on candles)".

## 2026-08-19 — EMA Cloud 20/50 y 50/100: overlay real + quitar panel

Se aplico el mismo patron de overlay real (lineas EMA + nube de relleno directamente sobre las velas usando candleCtx.xOf/yOf) a los dos modulos EMA Cloud restantes: EMA Cloud 20/50 y EMA Cloud 50/100. Antes solo el EMA Cloud generico tenia overlay real; estos dos seguian con el panel inferior de escala local. Se quito ese panel inferior en ambos (oscWrapEl queda vacio y colapsado a 0 de alto), igual que se hizo con los otros 4 modulos.

Verificado en vivo (modo prueba, AAPL): chartSvg-emacloud2050 y chartSvg-emacloud50100 con 3 paths cada uno (EMA corta, EMA larga, nube), sin NaN, oscWrapEl con alto 0 en ambos. Leyenda correcta: "EMA(20) EMA(50)" para 2050 y "EMA(50) EMA(100)" para 50100. Regresion completa de los 12 modulos de grafico sin errores de consola.

Commit: "EMA Cloud 20/50 and 50/100: overlay real + remove bottom panel" (sha cc3da431).

## 2026-08-19 — Ichimoku completo: Senkou Span A/B (nube Kumo) y Chikou Span

Se completo el ultimo pendiente de overlay real: Ichimoku ahora dibuja los 5 componentes directamente sobre las velas, no solo Tenkan-sen y Kijun-sen como antes.

Cambios:
- buildCandleSvg ahora acepta un parametro opcional opts.futureSlots (default 0, no rompe ningun llamador existente) que extiende el denominador de xOf para dejar espacio a la derecha de las velas — necesario porque la nube Kumo se proyecta 26 periodos hacia adelante del ultimo precio real.
- drawIchimokuChart llama buildCandleSvg con futureSlots: 26 y calcula:
  - Tenkan-sen (9) y Kijun-sen (26): igual que antes, ahora dibujadas sobre las velas (antes solo en el panel).
  - Senkou Span A = (Tenkan+Kijun)/2, proyectada 26 periodos adelante.
  - Senkou Span B = punto medio del maximo/minimo de 52 periodos, proyectada 26 periodos adelante.
  - Nube Kumo: relleno entre Senkou A y B (poligono), color segun la relacion actual (verde si A>=B, rojo si A<B), opacidad 0.15.
  - Chikou Span: precio de cierre desplazado 26 periodos hacia atras.
- Se quito el panel inferior (oscWrapEl vacio y colapsado), igual que los demas modulos con overlay real.
- Leyenda actualizada con los 5 componentes y colores.

Verificado en vivo (modo prueba, AAPL, 4h): chartSvg-ichi con 5 paths (Tenkan, Kijun, Senkou A, Senkou B, Chikou) + 1 poligono (nube), sin NaN, oscWrapEl colapsado a 0. Visualmente la nube se proyecta correctamente al hueco vacio a la derecha de las velas, y el Chikou se ve desplazado hacia atras siguiendo el precio. Regresion completa de los 12 modulos de grafico sin errores de consola.

Con esto queda completo el pendiente historico: "Overlay real de precio para SMA/EMA/EMA Cloud/Bollinger" y "completar Ichimoku (Kumo cloud, Chikou Span)" — ya no quedan overlays pendientes en NOTES.md.

Commit: "Ichimoku: overlay real (Senkou A/B, Kumo cloud, Chikou Span) sobre velas" (sha 4d3ff05a).

## 2026-08-19 — RSI, Estocastico, VWAP, Acum/Distrib y Fuerza relativa: unificados en un solo grafico

Ultima tanda de "overlay real". Estos 5 modulos no son indicadores de precio (RSI y %K estocastico van de 0 a 100, Acum/Distrib es un acumulado sin limite natural, Fuerza relativa es un ratio contra el benchmark) asi que ponerlos literalmente sobre el eje de precio de las velas no tiene sentido matematico. En vez de eso se unificaron en UN SOLO grafico SVG junto con las velas (antes cada uno vivia en un panel separado debajo, con su propio elemento y su propio pan/zoom).

Cambios tecnicos:
- Nueva funcion compartida mergeOscPanel(svg, hist, xOf, seriesValues, opts): toma el SVG ya armado de las velas, agranda su viewBox/height para abrir espacio abajo, y dibuja ahi la linea del indicador (con su propia escala local 0-100, o min/max de los datos) usando el mismo candleCtx.xOf para que quede perfectamente alineada en X con las velas. Reutilizada por RSI, Estocastico, Acum/Distrib y Fuerza relativa.
- VWAP es distinto: SI esta en escala de precio (es un promedio de precio ponderado por volumen), asi que se overlayo literalmente sobre las velas igual que SMA/EMA, sin necesitar mergeOscPanel.
- Se quito el panel inferior separado (oscWrapEl) en los 5 casos.

Williams %R se dejo intacto a proposito: ya tenia una funcionalidad mas avanzada (crosshair sincronizado entre las velas y su panel, con pan/zoom tactil) que ninguno de los otros indicadores tenia. Fusionarlo en un solo SVG habria sido un paso atras, no un avance, asi que no se toco.

Verificado en vivo (modo prueba, AAPL, 4h): los 5 graficos muestran 1 path cada uno, sin NaN, panel inferior colapsado a 0 de alto, leyenda correcta en cada uno (RSI 70/30, Estocastico 80/20, VWAP sin franjas, Acum/Distrib sin franjas, Fuerza relativa vs SPY con linea en 100). Williams confirmado sin cambios (panel propio de 112px de alto, como siempre). Regresion completa de los 13 modulos de grafico sin NaN y sin errores de consola.

Con esto termina el pendiente de "overlay real" para todos los indicadores del scanner, salvo Williams que ya iba mas adelantado.

Commit: "RSI/Estocastico/VWAP/AD/Fuerza relativa: overlay real sobre velas" (sha 94f89760).

## 2026-08-20 — Revertido: RSI, Estocastico, Acum/Distrib y Fuerza relativa vuelven a panel separado

Erick pidio explicitamente que los indicadores que NO comparten escala con el precio vuelvan a tener su propio modulo/panel separado, en vez de estar fusionados en un solo SVG junto con las velas (lo que se habia hecho unas horas antes en el commit "RSI/Estocastico/VWAP/AD/Fuerza relativa: overlay real sobre velas").

Se revirtio exactamente a como estaban antes: RSI, Estocastico y Acum/Distrib vuelven a usar oscWrapEl con su propio <svg> independiente (RSI y Estocastico via buildOscillatorSvg, Acum/Distrib con su dibujo local propio), y Fuerza relativa vuelve a usar buildOscillatorSvg tambien. Se elimino la funcion mergeOscPanel por quedar sin ningun uso.

VWAP no se toco: SI comparte escala con el precio (es un promedio de precio ponderado por volumen), asi que se queda con el overlay real literal sobre las velas, igual que SMA/EMA/Bollinger/Ichimoku/EMA Cloud.

Regla que queda establecida para el futuro: "overlay real" (dibujar directamente sobre las velas, eje de precio compartido) solo aplica a indicadores que SI estan en escala de precio (SMA, EMA, EMA Cloud, Bollinger, Ichimoku, VWAP). Los que no comparten esa escala (RSI, Estocastico, Williams %R, Acum/Distrib, Fuerza relativa) se quedan con su panel propio separado.

Verificado en vivo (modo prueba, AAPL): chartSvg-rsi/stoch/ad vuelven a su tamano original (viewBox 260, sin paths de overlay en las velas), oscSvg-rsi/stoch/ad vuelven a tener su propio <svg> poblado. Regresion completa de los 13 modulos sin NaN y sin errores de consola. mergeOscPanel confirmado ausente del código fuente desplegado.

Commit: "Revert RSI/Estocastico/AD/Fuerza relativa a panel separado (no comparten escala con precio)" (sha b2991087).

## 2026-08-20 — Contexto de Mercado: gráfica + EMA Cloud (SPY/QQQ)

El módulo "Contexto de Mercado" (marketctx) solo mostraba chips de texto (▲/▼ Nube alcista/bajista) para SPY y QQQ, sin ninguna gráfica visual.

Se agregó una función nueva `marketCtxChartHtml(hist, label)` que construye, para cada símbolo (SPY y QQQ), una gráfica de velas real (`buildCandleSvg` + `finishCandleSvg`, últimas 120 velas) con overlay de EMA Cloud (EMA8 vs EMA21, igual que describe el texto explicativo del módulo) dibujado directamente sobre las velas — mismo patrón que `drawEmaCloudChart` (nube de color según EMA rápida >= EMA lenta, líneas EMA8 en #5BC0EB y EMA21 en #C77DFF).

`renderMarketContext` ahora inserta ambas gráficas (`mc-charts-wrap`) justo debajo de la fila de chips, antes del veredicto agregado. El resto de la lógica (chips, cálculo de score, manejo de errores parciales) no se tocó.

Es una gráfica estática (sin pan/zoom ni selector de marco temporal), ya que este módulo no sigue la arquitectura estándar de un solo ticker (chartSvg-X/oscSvg-X) sino que renderiza todo dentro de un único contenedor (`marketctx-body`) para dos símbolos a la vez.

Verificado en vivo (modo prueba, AAPL): 2 SVG, 200 rects cada uno (velas+volumen), 6 paths (cloud fill + 2 líneas EMA por símbolo), sin NaN, sin errores de consola.

## 2026-08-20 — VWAP anclado: fix del punto de inicio (ahora pinea en el mínimo real)

Erick notó que la línea de VWAP anclado (drawVwapChart) no arrancaba visualmente en el mínimo de la vela ancla, sino a media altura de esa vela. Causa: el primer punto de la serie usaba el precio típico (H+L+C)/3 de la vela ancla (definición estándar de VWAP), no su mínimo — y como esa vela suele tener mecha inferior larga, el típico queda notablemente por encima del low.

Fix en `drawVwapChart`: se antepone un punto inicial explícito en `(candleCtx.xOf(anchorOff), candleCtx.yOf(hist[anchorOff].low))` antes de recorrer la serie acumulada normal. La línea ahora nace exactamente en la punta de la mecha inferior de la vela ancla (el "pin" visual de "anclado desde el mínimo") y de ahí en adelante sigue el cálculo VWAP acumulado sin cambios.

Verificado en vivo (modo prueba, AAPL, 4h): el primer punto del path (y~150.39) coincide exactamente (pixel-perfect) con el extremo inferior de la línea de mecha (wick) de la vela ancla.

## 2026-08-20 — Diagnóstico: portafolio no se actualiza solo (root cause: data/watchlist.json desactualizado)

Erick reportó que de sus posiciones en Portafolio, solo SLV se actualiza sola — el resto no. Y en Horario extendido, muchos tickers que sí son compras reales aparecen con tag "manual" en vez de "portafolio".

Causa raíz encontrada: los precios automáticos del portafolio NO se piden en vivo desde el dispositivo — vienen de `data/portfolio-cache.json`, que el workflow `refresh-data.yml` regenera cada 2h corriendo `scripts/refresh-cache.mjs`, el cual solo pide datos para los tickers listados en `data/watchlist.json`. Ese archivo es estático y se quedó con solo 5 tickers (SOFI, SLV, TSLA, XYZ, RIOT) — cualquier posición agregada después nunca entra al refresh automático de 2h. `startPortfolioAutoRefresh()` solo llama `refreshPortfolioFromSharedCacheOnly()`, que únicamente lee ese archivo — por eso solo los tickers que sí están ahí (aparentemente solo SLV coincide con las posiciones reales actuales) se ven frescos.

Hay un fallback de una sola vez al cargar la app (`missing = Object.keys(groupLotsByTicker()).filter(t => !(t in shared.tickers))`) que hace fetch en vivo para tickers ausentes del cache — pero solo corre una vez al inicio, no se repite en el intervalo de 30 min, así que si son muchos tickers ausentes es fácil toparse con límites de la API y quedar con datos viejos o en error permanentemente.

Fix aplicado ahora (independiente, no requiere info de Erick): `syncExtendedHoursAutoTickers()` solo agregaba tickers de portafolio ausentes de la lista de Horario extendido, pero nunca promovía una entrada existente con `source:"manual"` a `source:"portfolio"` aunque el ticker ya estuviera en `groupLotsByTicker()` — por eso un ticker agregado manualmente a Horario extendido ANTES de comprarlo se quedaba marcado "manual" para siempre. Ahora la función recorre la lista completa y promueve cualquier entrada cuyo ticker esté en el portafolio real.

Pendiente: actualizar `data/watchlist.json` con la lista completa y actual de tickers en portafolio de Erick (se le pidió la lista) y disparar manualmente el workflow `refresh-data.yml` para refrescar el cache de inmediato en vez de esperar el próximo cron de 2h.
