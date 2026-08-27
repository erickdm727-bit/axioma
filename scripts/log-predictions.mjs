#!/usr/bin/env node
// Bitácora de predicciones del "Mapa de movimiento probable".
//
// Cada día hábil, para cada ticker del portafolio (mismo universo que
// refresh-cache.mjs, vía Firestore con fallback a data/watchlist.json):
//   1) Si todavía no hay una predicción registrada para la vela diaria más
//      reciente de ese ticker, calcula la proyección "Método propio"
//      (motor de análogos histórico, idéntico al que usa index7.html) y la
//      guarda en data/predictions-log.json con el precio de llamada, el
//      horizonte (130 velas diarias ~ 6 meses) y las bandas de confianza.
//   2) Revisa las predicciones pendientes de ese ticker: si ya pasaron las
//      130 velas desde que se hizo la llamada, la resuelve contra el precio
//      real y guarda si acertó la dirección, si el precio real cayó dentro
//      de ±1σ / ±2σ, y el error porcentual.
//
// Esto es un registro PROSPECTIVO: la predicción se guarda antes de conocer
// el resultado, así que no hay forma de "hacer trampa" con retrospectiva.
// Es el complemento en vivo del backtest sintético que ya existe en la app
// (runMovementCalibration), reutilizando la misma metodología de puntaje
// (precisión direccional, cobertura ±1σ/±2σ) para que ambos sean comparables.
//
// Fase 2 (pendiente, no implementada en este archivo todavía): "Método
// comparado contra S&P 500" (methods.market) y "Método fusión"
// (methods.fusion) — por ahora esos campos quedan en null en cada registro
// nuevo, listos para llenarse cuando se construya esa parte.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const API_BASE = "https://api.twelvedata.com";
const SLEEP_BETWEEN_TICKERS_MS = 8000;
const TIMEFRAME = "1day";
const HORIZON_BARS = 130; // igual a MOVEMENT_PARAMS["1day"].proj en index7.html
const MIN_TRAIN_SIZE = 15;
const K_MAX = 40;
const OUTPUT_SIZE = 500; // ~2 años de velas diarias
const FIRESTORE_USER_UID = "xvvl1v1KBPgSSJHn6EVwywmo24y2";

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

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

function base64url(input){
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getFirestoreAccessToken(serviceAccount){
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const unsigned = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = unsigned + "." + signature;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  const data = await res.json();
  if(!data.access_token) throw new Error("No se pudo obtener access_token de Firestore: " + JSON.stringify(data));
  return data.access_token;
}

async function fetchPortfolioTickersFromFirestore(){
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if(!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY no está configurado");
  const serviceAccount = JSON.parse(raw);
  const accessToken = await getFirestoreAccessToken(serviceAccount);
  const url = `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents/users/${FIRESTORE_USER_UID}`;
  const res = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  if(!res.ok) throw new Error("Firestore fetch failed: " + res.status + " " + await res.text());
  const doc = await res.json();
  const lotsRaw = doc.fields && doc.fields.ta_scanner_portfolio_lots && doc.fields.ta_scanner_portfolio_lots.stringValue;
  if(!lotsRaw) throw new Error("El documento de Firestore no tiene ta_scanner_portfolio_lots");
  const lots = JSON.parse(lotsRaw);
  if(!Array.isArray(lots)) throw new Error("ta_scanner_portfolio_lots no es un array");
  const tickers = Array.from(new Set(lots.map(l => (l.ticker || "").trim().toUpperCase()).filter(Boolean))).sort();
  return tickers;
}

async function resolveTickerUniverse(){
  const watchlistPath = path.join(ROOT, "data", "watchlist.json");
  try {
    const fsTickers = await fetchPortfolioTickersFromFirestore();
    if(fsTickers && fsTickers.length){
      console.log(`Tickers desde Firestore (${fsTickers.length}): ${fsTickers.join(", ")}`);
      return fsTickers;
    }
    console.log("Firestore no devolvió tickers de portafolio; usando data/watchlist.json.");
  } catch(e){
    console.log("No se pudo leer Firestore (" + e.message + "); usando data/watchlist.json.");
  }
  try {
    const raw = await fs.readFile(watchlistPath, "utf8");
    const tickers = JSON.parse(raw);
    if(Array.isArray(tickers) && tickers.length) return tickers;
  } catch(e){ }
  return [];
}

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

const LOG_PATH = path.join(ROOT, "data", "predictions-log.json");

async function loadLog(){
  try {
    const raw = await fs.readFile(LOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if(parsed && Array.isArray(parsed.records)) return parsed;
  } catch(e){ }
  return { generatedAt: Date.now(), records: [] };
}

async function saveLog(log){
  log.generatedAt = Date.now();
  const dataDir = path.join(ROOT, "data");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(LOG_PATH, JSON.stringify(log, null, 2) + "\n");
}

function makeOwnMethodEntry(projection){
  if(projection.method !== "analog") return null;
  const last = projection.central.length - 1;
  return {
    method: "analog",
    trainingSize: projection.trainingSize,
    n: projection.n,
    meanRet: projection.meanRet,
    pctPositive: projection.pctPositive,
    direction: directionFromPctPositive(projection.pctPositive),
    centralFinal: projection.central[last],
    upper1Final: projection.upper1[last],
    lower1Final: projection.lower1[last],
    upper2Final: projection.upper2[last],
    lower2Final: projection.lower2[last],
  };
}

function resolveMethodEntry(methodEntry, priceAtCall, actualPrice){
  if(!methodEntry) return null;
  const actualRet = Math.log(actualPrice/priceAtCall);
  let dirCorrect = null;
  if(methodEntry.direction === "bullish") dirCorrect = actualRet > 0;
  else if(methodEntry.direction === "bearish") dirCorrect = actualRet < 0;
  return {
    actualRet,
    dirCorrect,
    within1: actualPrice >= methodEntry.lower1Final && actualPrice <= methodEntry.upper1Final,
    within2: actualPrice >= methodEntry.lower2Final && actualPrice <= methodEntry.upper2Final,
    errPct: (actualPrice - methodEntry.centralFinal) / priceAtCall,
  };
}

async function processTicker(ticker, log){
  let series;
  try {
    series = await fetchSeries(ticker, TIMEFRAME, OUTPUT_SIZE);
  } catch(e){
    console.error(`ERROR ${ticker}: no se pudo obtener histórico (${e.message})`);
    return;
  }
  if(!series.length){
    console.error(`ERROR ${ticker}: histórico vacío`);
    return;
  }

  const dtIndex = new Map(series.map((c,i) => [c.datetime, i]));
  let resolvedCount = 0;
  for(const rec of log.records){
    if(rec.ticker !== ticker || rec.resolved) continue;
    const callIdx = dtIndex.get(rec.calledAtDatetime);
    if(callIdx == null) continue;
    const targetIdx = callIdx + rec.horizonBars;
    if(targetIdx >= series.length) continue;
    const targetBar = series[targetIdx];
    rec.resolved = true;
    rec.resolution = {
      resolvedAt: Date.now(),
      actualDate: targetBar.datetime,
      actualPrice: targetBar.close,
      own: resolveMethodEntry(rec.methods.own, rec.priceAtCall, targetBar.close),
      market: resolveMethodEntry(rec.methods.market, rec.priceAtCall, targetBar.close),
      fusion: resolveMethodEntry(rec.methods.fusion, rec.priceAtCall, targetBar.close),
    };
    resolvedCount++;
  }
  if(resolvedCount) console.log(`${ticker}: se resolvieron ${resolvedCount} predicción(es).`);

  const lastBar = series[series.length-1];
  const id = `${ticker}_${lastBar.datetime}`;
  const alreadyLogged = log.records.some(r => r.id === id);
  if(alreadyLogged){
    console.log(`${ticker}: ya existe predicción para ${lastBar.datetime}.`);
    return;
  }

  const projection = computeProjectionAnalog(series, lastBar.close, HORIZON_BARS, MIN_TRAIN_SIZE, K_MAX);
  const ownEntry = makeOwnMethodEntry(projection);
  if(!ownEntry){
    console.log(`${ticker}: historial insuficiente (${projection.trainingSize} muestras) — no se registra predicción hoy.`);
    return;
  }

  log.records.push({
    id,
    ticker,
    timeframe: TIMEFRAME,
    horizonBars: HORIZON_BARS,
    calledAt: lastBar.datetime,
    calledAtDatetime: lastBar.datetime,
    calledAtTs: Date.now(),
    priceAtCall: lastBar.close,
    methods: { own: ownEntry, market: null, fusion: null },
    resolved: false,
    resolution: null,
  });
  console.log(`${ticker}: nueva predicción registrada (${ownEntry.direction}, precio actual ${lastBar.close}, central a ${HORIZON_BARS} velas ${ownEntry.centralFinal.toFixed(2)}).`);
}

async function main(){
  const tickers = await resolveTickerUniverse();
  if(!tickers.length){
    console.log("No hay tickers para procesar (ni Firestore ni watchlist.json dieron resultado).");
    return;
  }
  const log = await loadLog();
  for(const ticker of tickers){
    await processTicker(ticker, log);
    await sleep(SLEEP_BETWEEN_TICKERS_MS);
  }
  await saveLog(log);
  console.log(`Bitácora guardada: ${log.records.length} registro(s) en total.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
