#!/usr/bin/env node
// Fetches price + support/resistance levels for each ticker in data/watchlist.json
// using Twelve Data, and writes data/portfolio-cache.json. Run by the
// "Refresh portfolio cache" GitHub Actions workflow on a schedule, so the
// app can show fresh portfolio data instantly on any device without each
// device spending its own Twelve Data API credits.
//
// The support/resistance math below is a direct port of the same functions
// in index7.html (computeQuarterlyPivot, computeSupportResistanceLevels,
// buildPortfolioSRAlert) — keep them in sync if either side changes.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const API_BASE = "https://api.twelvedata.com";
const PORT_SR_PROXIMITY = 0.02; // dentro de 2% cuenta como "cerca" de un nivel
const SLEEP_BETWEEN_TICKERS_MS = 8000;

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
  })).reverse(); // ascending chronological
}

// ==================== ported from index7.html ====================

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

function buildPortfolioSRAlert(daily, currentPrice, sr){
    const s1 = sr.supports[0], s2 = sr.supports[1];
    const r1 = sr.resistances[0], r2 = sr.resistances[1];
    const prevClose = daily.length>1 ? daily[daily.length-2].close : null;

    if(s1 && prevClose!=null && prevClose>=s1.price && currentPrice<s1.price){
      return { urgent:true, icon:"⚠", cls:"bear", title:"Acaba de romper un soporte",
        text:`El precio cruzó por debajo del Soporte ${s1.n} (${s1.price.toFixed(2)} USD) — zona de riesgo.` + (s2?` Si sigue cayendo, el siguiente soporte está en ${s2.price.toFixed(2)} USD.`:'') };
    }
    if(r1 && prevClose!=null && prevClose<=r1.price && currentPrice>r1.price){
      return { urgent:true, icon:"🚀", cls:"bull", title:"Acaba de romper una resistencia",
        text:`El precio cruzó por encima de la Resistencia ${r1.n} (${r1.price.toFixed(2)} USD) — podría acelerar al alza.` + (r2?` Siguiente resistencia en ${r2.price.toFixed(2)} USD.`:'') };
    }

    const distS = s1 ? (currentPrice-s1.price)/currentPrice : null;
    const distR = r1 ? (r1.price-currentPrice)/currentPrice : null;

    if(distS!=null && distS>=0 && distS<=PORT_SR_PROXIMITY){
      return { urgent:true, icon:"⚠", cls:"mixed", title:"Cerca de un soporte — zona de riesgo",
        text:`Estás a ${(distS*100).toFixed(1)}% de tocar el Soporte ${s1.n} (${s1.price.toFixed(2)} USD).` + (s2?` Si se rompe, el siguiente soporte está en ${s2.price.toFixed(2)} USD.`:'') };
    }
    if(distR!=null && distR>=0 && distR<=PORT_SR_PROXIMITY){
      return { urgent:true, icon:"◆", cls:"mixed", title:"Cerca de una resistencia",
        text:`Estás a ${(distR*100).toFixed(1)}% de la Resistencia ${r1.n} (${r1.price.toFixed(2)} USD).` + (r2?` Si la rompe, la siguiente resistencia está en ${r2.price.toFixed(2)} USD.`:'') };
    }

    const parts = [];
    if(distS!=null && distS>=0) parts.push(`${(distS*100).toFixed(1)}% arriba del Soporte ${s1.n} (${s1.price.toFixed(2)} USD)`);
    if(distR!=null && distR>=0) parts.push(`${(distR*100).toFixed(1)}% debajo de la Resistencia ${r1.n} (${r1.price.toFixed(2)} USD)`);
    return { urgent:false, icon:"◇",
      text: parts.length ? `Precio a ${parts.join(" y ")} — sin niveles clave inmediatos que vigilar.` : "No hay suficiente historial para calcular soportes/resistencias confiables todavía." };
  }

// ==================== main ====================

function isMarketOpenNowET(){
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type).value;
  const weekday = get("weekday");
  const hour = parseInt(get("hour"), 10) % 24;
  const minute = parseInt(get("minute"), 10);
  if(weekday === "Sat" || weekday === "Sun") return false;
  const minutesNow = hour * 60 + minute;
  const marketOpen = 9 * 60 + 30;
  const marketClose = 16 * 60;
  return minutesNow >= marketOpen && minutesNow < marketClose;
}

async function main(){
  if(!isMarketOpenNowET()){
    console.log("Mercado cerrado (fuera de 9:30am-4:00pm hora de Nueva York, o fin de semana) — no se actualiza el cache.");
    return;
  }
  const watchlistPath = path.join(ROOT, "data", "watchlist.json");
  const raw = await fs.readFile(watchlistPath, "utf8");
  const tickers = JSON.parse(raw);
  if(!Array.isArray(tickers) || !tickers.length){
    console.log("data/watchlist.json está vacío o no es un array; nada que hacer.");
    return;
  }

  const cache = {};
  for(const t of tickers){
    try {
      const daily = await fetchSeries(t, "1day", 260);
      const price = daily[daily.length-1].close;
      const sr = computeSupportResistanceLevels(daily, price);
      const alert = buildPortfolioSRAlert(daily, price, sr);
      cache[t] = { price, sr, alert, daily: daily.slice(-90), updatedAt: Date.now(), error: null };
      console.log(`OK ${t}: price=${price}`);
    } catch (e) {
      cache[t] = { error: e.message || "error", updatedAt: Date.now() };
      console.error(`ERROR ${t}: ${e.message}`);
    }
    await sleep(SLEEP_BETWEEN_TICKERS_MS);
  }

  const out = { generatedAt: Date.now(), tickers: cache };
  const dataDir = path.join(ROOT, "data");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, "portfolio-cache.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote cache for ${tickers.length} tickers.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

