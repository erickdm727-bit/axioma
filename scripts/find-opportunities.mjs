#!/usr/bin/env node
// Buscador de oportunidades de compra.
//
// Corre cada día hábil sobre el universo de tickers que ya monitoreas en
// "Horario extendido" (data/extended-hours-tickers.json — así no gasta API
// descubriendo tickers nuevos). Para cada ticker calcula, con velas diarias:
//   - Soportes/Resistencias (mismo cálculo que refresh-cache.mjs)
//   - RSI(14)
//   - Proyección del motor de análogos (mismo motor que el Mapa de
//     movimiento / la bitácora de predicciones)
// y combina eso en un puntaje de "oportunidad de compra" 0-10, con las
// razones en texto plano. Escribe data/opportunities.json con el ranking.
//
// v1 / criterio provisional — pendiente de ajustar con feedback real sobre
// qué cuenta como "buena oportunidad". El criterio actual:
//   +hasta 4 puntos: qué tan cerca está el precio de un soporte fuerte
//     (más puntos cuanto más cerca, sin haberlo roto)
//   +hasta 3 puntos: RSI bajo (más puntos cuanto más cerca de sobreventa,
//     sin premiar RSI extremadamente bajo tipo caída libre)
//   +hasta 3 puntos: el motor de análogos apunta alcista (escalado por
//     qué tan fuerte es esa mayoría)
// Umbral: solo se listan tickers con puntaje > 0.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const API_BASE = "https://api.twelvedata.com";
const SLEEP_BETWEEN_TICKERS_MS = 8000;
const OUTPUT_SIZE = 500;
const HORIZON_BARS = 130; // igual que el resto de la app para "1day"
const MIN_TRAIN_SIZE = 15;
const K_MAX = 40;
const SR_PROXIMITY_MAX = 0.08; // más allá de 8% del soporte no suma puntos

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// ==================== Twelve Data ====================

async function tdFetch(pathName, params){
  const key = process.env.TWELVE_DATA_KEY;
  if(!key) throw new Error("Falta TWELVE_DATA_KEY en el entorno.");
  const url = new URL(API_BASE + pathName);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  url.searchParams.set("apikey", key);
  let networkAttempt = 0, rateAttempt = 0;
  const MAX_NETWORK_RETRIES = 3, MAX_RATE_RETRIES = 3;
  while(true){
    let res;
    try {
      res = await fetch(url.toString());
    } catch(networkErr){
      networkAttempt++;
      if(networkAttempt <= MAX_NETWORK_RETRIES){
        await sleep(1200 * networkAttempt);
        continue;
      }
      throw new Error("No se pudo conectar con Twelve Data tras " + MAX_NETWORK_RETRIES + " intentos: " + networkErr.message);
    }
    let data;
    try { data = await res.json(); } catch(e){ throw new Error("Respuesta inválida del servidor de datos."); }
    if(data && data.status === "error") throw new Error(data.message || "Error consultando datos de mercado.");
    if(res.status === 429 && rateAttempt < MAX_RATE_RETRIES){ rateAttempt++; await sleep(4000); continue; }
    return data;
  }
}

async function fetchSeries(symbol, interval, outputsize){
  const data = await tdFetch("/time_series", { symbol, interval, outputsize });
  if(!data.values || !Array.isArray(data.values)) throw new Error(`Sin datos para ${symbol} en ${interval}. Revisa el ticker.`);
  return data.values.map(v => ({
    datetime:v.datetime,
    open:parseFloat(v.open), high:parseFloat(v.high), low:parseFloat(v.low), close:parseFloat(v.close),
    volume: v.volume!=null ? parseFloat(v.volume)||0 : 0,
  })).reverse(); // ascendente cronológico
}

// ==================== Soportes/Resistencias (idéntico a refresh-cache.mjs) ====================

function computeQuarterlyPivot(candlesAsc){
  if(!candlesAsc || candlesAsc.length < 2) return null;
  const lastDate = new Date(candlesAsc[candlesAsc.length-1].datetime.replace(" ","T"));
  const curQ = Math.floor(lastDate.getMonth()/3);
  let prevQ = curQ - 1, prevYear = lastDate.getFullYear();
  if(prevQ < 0){ prevQ = 3; prevYear -= 1; }
  const start = new Date(prevYear, prevQ*3, 1);
  const end = new Date(prevYear, prevQ*3+3, 1);
  const inQuarter = candlesAsc.filter(c=>{
    const d = new Date(c.datetime.replace(" ","T"));
    return d >= start && d < end;
  });
  if(inQuarter.length < 5) return null;
  const high = Math.max(...inQuarter.map(c=>c.high));
  const low = Math.min(...inQuarter.map(c=>c.low));
  const close = inQuarter[inQuarter.length-1].close;
  const pp = (high+low+close)/3;
  return { pp, r1: 2*pp-low, s1: 2*pp-high, quarter:prevQ+1, year:prevYear };
}

function computeSupportResistanceLevels(candlesAsc, price){
  const arr = candlesAsc.slice(-90);
  if(arr.length < 10) return { support:null, resistance:null, supports:[], resistances:[], quarterlyPivot:null };
  const highs=[], lows=[];
  for(let i=3;i<arr.length-3;i++){
    const w = arr.slice(i-3,i+4);
    if(arr[i].high === Math.max(...w.map(c=>c.high))) highs.push(arr[i].high);
    if(arr[i].low === Math.min(...w.map(c=>c.low))) lows.push(arr[i].low);
  }
  const swingHigh = Math.max(...arr.map(c=>c.high));
  const swingLow = Math.min(...arr.map(c=>c.low));
  const range = swingHigh - swingLow;
  const candidates = [
    ...highs.map(h=>({price:h, type:"pivot"})),
    ...lows.map(l=>({price:l, type:"pivot"})),
  ];
  if(range > 0){
    [0.236,0.382,0.5,0.618,0.786].forEach(r=>{
      candidates.push({ price: swingHigh - range*r, type:"fib" });
    });
  }
  const qp = computeQuarterlyPivot(candlesAsc);
  if(qp){
    candidates.push({ price: qp.pp, type:"qpivot" });
    candidates.push({ price: qp.r1, type:"qpivot" });
    candidates.push({ price: qp.s1, type:"qpivot" });
  }
  const tol = Math.max(price*0.006, 0.01);
  candidates.sort((a,b)=>a.price-b.price);
  const clusters = [];
  candidates.forEach(c=>{
    const last = clusters[clusters.length-1];
    if(last && Math.abs(c.price-last.price) <= tol){
      last.sum += c.price; last.n += 1; last.price = last.sum/last.n;
      if(!last.types.includes(c.type)) last.types.push(c.type);
    } else {
      clusters.push({ price:c.price, sum:c.price, n:1, types:[c.type] });
    }
  });
  clusters.forEach(c=>{ c.kind = c.types.length>1 ? "confluencia" : c.types[0]; });

  const supports = clusters.filter(c=>c.price<price).sort((a,b)=>b.price-a.price).slice(0,3)
    .map((c,i)=>({ price:c.price, n:i+1, type:c.kind }));
  const resistances = clusters.filter(c=>c.price>price).sort((a,b)=>a.price-b.price).slice(0,3)
    .map((c,i)=>({ price:c.price, n:i+1, type:c.kind }));

  return {
    support: supports[0] ? supports[0].price : null,
    resistance: resistances[0] ? resistances[0].price : null,
    supports, resistances, quarterlyPivot: qp,
  };
}

// ==================== Motor de análogos (idéntico a index7.html / log-predictions.mjs) ====================

function linRegSlope(ys){
  const n = ys.length;
  const xMean = (n-1)/2, yMean = meanArr(ys);
  let num=0, den=0;
  for(let i=0;i<n;i++){ num += (i-xMean)*(ys[i]-yMean); den += (i-xMean)*(i-xMean); }
  return den ? num/den : 0;
}

function meanArr(arr){ return arr.reduce((a,b)=>a+b,0)/arr.length; }

function stddevSimple(arr){ const m=meanArr(arr); return Math.sqrt(meanArr(arr.map(x=>(x-m)*(x-m)))); }

function rollingRSIArr(closes, period=14){
  const out = new Array(closes.length).fill(null);
  if(closes.length < period+1) return out;
  let avgGain, avgLoss;
  for(let i=1;i<closes.length;i++){
    const diff = closes[i]-closes[i-1];
    if(i===period){
      let g=0,l=0;
      for(let j=1;j<=period;j++){ const d=closes[j]-closes[j-1]; if(d>0) g+=d; else l+=-d; }
      avgGain=g/period; avgLoss=l/period;
      out[i]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
    } else if(i>period){
      const gain=diff>0?diff:0, loss=diff<0?-diff:0;
      avgGain=(avgGain*(period-1)+gain)/period; avgLoss=(avgLoss*(period-1)+loss)/period;
      out[i]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
    }
  }
  return out;
}

function rollingStochKArr(candles, period=14){
  const out = new Array(candles.length).fill(null);
  for(let i=period-1;i<candles.length;i++){
    const win = candles.slice(i-period+1,i+1);
    const hh=Math.max(...win.map(c=>c.high)), ll=Math.min(...win.map(c=>c.low));
    out[i] = hh===ll?50:100*(candles[i].close-ll)/(hh-ll);
  }
  return out;
}

function rollingRegSlopeArr(closes, window){
  const out = new Array(closes.length).fill(null);
  for(let i=window-1;i<closes.length;i++){
    out[i] = linRegSlope(closes.slice(i-window+1,i+1).map(Math.log));
  }
  return out;
}

function rollingSigmaArr(closes, window){
  const out = new Array(closes.length).fill(null);
  for(let i=window;i<closes.length;i++){
    const rets=[]; for(let j=i-window+1;j<=i;j++) rets.push(Math.log(closes[j]/closes[j-1]));
    out[i]=stddevSimple(rets)||1e-6;
  }
  return out;
}

function rollingSmaTrendArr(closes, shortP, longP){
  const out = new Array(closes.length).fill(null);
  for(let i=longP-1;i<closes.length;i++){
    const smaS = closes.slice(i-shortP+1,i+1).reduce((a,b)=>a+b,0)/shortP;
    const smaL = closes.slice(i-longP+1,i+1).reduce((a,b)=>a+b,0)/longP;
    const price = closes[i];
    let score=0; score += price>smaS?1:-1; score += price>smaL?1:-1; score += smaS>smaL?1:-1;
    out[i]=score/3;
  }
  return out;
}

function buildAnalogSamples(candles, horizonBars){
  const closes = candles.map(c=>c.close);
  const n = closes.length;
  const window = Math.max(15, Math.min(40, Math.floor(n/10)));
  const rsiArr = rollingRSIArr(closes,14);
  const stochArr = rollingStochKArr(candles,14);
  const slopeArr = rollingRegSlopeArr(closes, window);
  const sigmaArr = rollingSigmaArr(closes, window);
  const trendArr = rollingSmaTrendArr(closes, Math.max(5,Math.floor(window/2)), window);
  const samples = [];
  for(let i=0;i<n;i++){
    if(rsiArr[i]==null||stochArr[i]==null||slopeArr[i]==null||sigmaArr[i]==null||trendArr[i]==null) continue;
    const fwdIdx = i+horizonBars;
    const fwdReturn = fwdIdx < n ? Math.log(closes[fwdIdx]/closes[i]) : null;
    samples.push({ i, feat:[slopeArr[i]/sigmaArr[i], (rsiArr[i]-50)/50, (stochArr[i]-50)/50, trendArr[i]], fwdReturn });
  }
  return samples;
}

function computeProjectionAnalog(fullCandles, price, horizonBars, minTrainSize=15, kMax=40){
  const closes = fullCandles.map(c=>c.close);
  const samples = buildAnalogSamples(fullCandles, horizonBars);
  if(!samples.length) return { method:"fallback", trainingSize:0 };
  const current = samples[samples.length-1];
  const training = samples.filter(s => s.fwdReturn !== null && s.i !== current.i);
  if(training.length < minTrainSize) return { method:"fallback", trainingSize:training.length };

  const dists = training.map(s => {
    let d=0; for(let f=0; f<4; f++){ const diff = s.feat[f]-current.feat[f]; d += diff*diff; }
    return { s, d: Math.sqrt(d) };
  });
  dists.sort((a,b)=>a.d-b.d);
  const k = Math.max(8, Math.min(kMax, Math.round(training.length/5)));
  const neighbors = dists.slice(0,k).map(x=>x.s);

  const H = horizonBars;
  const paths = neighbors.map(s => {
    const path = new Array(H);
    for(let j=1;j<=H;j++) path[j-1] = Math.log(closes[s.i+j]/closes[s.i]);
    return path;
  });
  const central=[], upper1=[], lower1=[], upper2=[], lower2=[];
  for(let j=0;j<H;j++){
    const vals = paths.map(p=>p[j]);
    const m = meanArr(vals);
    const sd = stddevSimple(vals) || 1e-6;
    const c = price*Math.exp(m);
    central.push(c); upper1.push(c*Math.exp(sd)); lower1.push(c*Math.exp(-sd));
    upper2.push(c*Math.exp(2*sd)); lower2.push(c*Math.exp(-2*sd));
  }
  const finalReturns = paths.map(p=>p[H-1]);
  const meanRet = meanArr(finalReturns);
  const pctPositive = finalReturns.filter(r=>r>0).length/finalReturns.length;

  return { method:"analog", central, upper1, lower1, upper2, lower2, n:neighbors.length, trainingSize:training.length, pctPositive, meanRet };
}

function directionFromPctPositive(pctPositive){
  if(pctPositive >= 0.6) return "bullish";
  if(pctPositive <= 0.4) return "bearish";
  return "neutral";
}

// ==================== Puntaje de oportunidad (v1, provisional) ====================

function scoreOpportunity({ price, sr, rsi, analog }){
  const reasons = [];
  let score = 0;

  // Cercanía a soporte (hasta 4 puntos) — solo cuenta si el precio sigue
  // arriba del soporte (no si ya lo rompió).
  const s1 = sr.supports[0];
  if(s1){
    const dist = (price - s1.price) / price;
    if(dist >= 0 && dist <= SR_PROXIMITY_MAX){
      const pts = 4 * (1 - dist/SR_PROXIMITY_MAX);
      score += pts;
      reasons.push(`Precio a ${(dist*100).toFixed(1)}% del Soporte ${s1.n} (${s1.price.toFixed(2)}) — +${pts.toFixed(1)}`);
    }
  }

  // RSI bajo pero no en caída libre (hasta 3 puntos), mejor punto dulce ~35-45
  if(rsi != null){
    let pts = 0;
    if(rsi <= 20) pts = 1; // demasiado extremo, podría seguir cayendo
    else if(rsi <= 45) pts = 3 * (1 - Math.max(0, rsi-20)/25);
    if(pts > 0){
      score += pts;
      reasons.push(`RSI(14) en ${rsi.toFixed(1)} — +${pts.toFixed(1)}`);
    }
  }

  // Motor de análogos apuntando alcista (hasta 3 puntos)
  if(analog && analog.method === "analog"){
    if(analog.pctPositive >= 0.55){
      const pts = 3 * Math.min(1, (analog.pctPositive - 0.5) / 0.35);
      score += pts;
      reasons.push(`Motor de análogos: ${(analog.pctPositive*100).toFixed(0)}% de casos similares subieron a 130 velas — +${pts.toFixed(1)}`);
    }
  }

  return { score: Math.round(score*10)/10, reasons };
}

// ==================== Main ====================

async function loadUniverse(){
  const p = path.join(ROOT, "data", "extended-hours-tickers.json");
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw);
    if(parsed && Array.isArray(parsed.tickers) && parsed.tickers.length) return parsed.tickers;
  } catch(e){ /* sin universo: nada que hacer */ }
  return [];
}

async function main(){
  const tickers = await loadUniverse();
  if(!tickers.length){
    console.log("No hay tickers en data/extended-hours-tickers.json; nada que hacer.");
    return;
  }

  const results = [];
  for(const ticker of tickers){
    try {
      const daily = await fetchSeries(ticker, "1day", OUTPUT_SIZE);
      if(daily.length < 30){ console.log(`${ticker}: histórico insuficiente, se omite.`); await sleep(SLEEP_BETWEEN_TICKERS_MS); continue; }
      const price = daily[daily.length-1].close;
      const sr = computeSupportResistanceLevels(daily, price);
      const rsiArr = rollingRSIArr(daily.map(c=>c.close), 14);
      const rsi = rsiArr[rsiArr.length-1];
      const analog = computeProjectionAnalog(daily, price, HORIZON_BARS, MIN_TRAIN_SIZE, K_MAX);
      const { score, reasons } = scoreOpportunity({ price, sr, rsi, analog });

      if(score > 0){
        results.push({
          ticker,
          price,
          score,
          reasons,
          rsi,
          support: sr.supports[0] ? sr.supports[0].price : null,
          resistance: sr.resistances[0] ? sr.resistances[0].price : null,
          analogDirection: analog.method === "analog" ? directionFromPctPositive(analog.pctPositive) : null,
          analogPctPositive: analog.method === "analog" ? analog.pctPositive : null,
        });
        console.log(`${ticker}: puntaje ${score} — ${reasons.join(" | ")}`);
      } else {
        console.log(`${ticker}: sin oportunidad clara (puntaje 0).`);
      }
    } catch(e){
      console.error(`ERROR ${ticker}: ${e.message}`);
    }
    await sleep(SLEEP_BETWEEN_TICKERS_MS);
  }

  results.sort((a,b) => b.score - a.score);

  const out = { generatedAt: Date.now(), criteria: "v1: cercanía a soporte + RSI bajo + motor de análogos alcista (provisional)", results };
  const dataDir = path.join(ROOT, "data");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, "opportunities.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`Listo: ${results.length} oportunidad(es) encontradas de ${tickers.length} tickers analizados.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
