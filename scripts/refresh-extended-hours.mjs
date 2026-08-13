#!/usr/bin/env node
// Archives extended-hours (pre-market + after-hours) minute bars for each
// ticker in data/extended-hours-tickers.json, using StockData.org's free
// intraday endpoint. Twelve Data (the app's main provider) gates extended
// hours behind its $229/mo Pro plan even for historical data, so this is a
// second, independent pipeline: once a day, pull whatever window
// StockData.org returns (their free plan defaults to the trailing 7
// calendar days) and APPEND any bars not already archived, keyed by exact
// timestamp, into data/extended-hours/<TICKER>.json. StockData's free tier
// has been observed lagging a few trading days behind live -- that's fine
// here, since each day's request re-covers the last 7 days, so a slow day
// just gets backfilled by a later run instead of being lost. The archive
// is meant to outlive StockData's own ~1-month retention window: it only
// ever grows.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const API_BASE = "https://api.stockdata.org/v1/data/intraday";
const SLEEP_BETWEEN_TICKERS_MS = 2000;

function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

async function fetchIntraday(ticker){
  const key = process.env.STOCKDATA_API_KEY;
  if(!key) throw new Error("Falta STOCKDATA_API_KEY en el entorno.");
  const url = new URL(API_BASE);
  url.searchParams.set("symbols", ticker);
  url.searchParams.set("interval", "minute");
  url.searchParams.set("extended_hours", "true");
  url.searchParams.set("api_token", key);
  let attempt = 0;
  const MAX_RETRIES = 3;
  while(true){
    let res;
    try {
      res = await fetch(url.toString());
    } catch(networkErr){
      attempt++;
      if(attempt <= MAX_RETRIES){ await sleep(1500 * attempt); continue; }
      throw networkErr;
    }
    if(res.status === 429){
      attempt++;
      if(attempt <= MAX_RETRIES){ await sleep(3000 * attempt); continue; }
      throw new Error("429 rate limited tras reintentos");
    }
    if(!res.ok){
      throw new Error("HTTP " + res.status);
    }
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  }
}

async function loadTickers(){
  const p = path.join(ROOT, "data", "extended-hours-tickers.json");
  try {
    const raw = await fs.readFile(p, "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j.tickers) ? j.tickers : [];
  } catch(e){
    console.log("data/extended-hours-tickers.json no existe o es invalido; nada que hacer.");
    return [];
  }
}

async function loadArchive(ticker){
  const p = path.join(ROOT, "data", "extended-hours", ticker + ".json");
  try {
    const raw = await fs.readFile(p, "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j.bars) ? j.bars : [];
  } catch(e){
    return [];
  }
}

async function saveArchive(ticker, bars){
  const dir = path.join(ROOT, "data", "extended-hours");
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, ticker + ".json");
  bars.sort(function(a, b){ return a.t < b.t ? -1 : (a.t > b.t ? 1 : 0); });
  await fs.writeFile(p, JSON.stringify({ ticker: ticker, updatedAt: new Date().toISOString(), bars: bars }));
}

async function main(){
  const tickers = await loadTickers();
  if(!tickers.length){
    console.log("Lista de tickers vacia; nada que hacer.");
    return;
  }
  for(const t of tickers){
    try {
      const rows = await fetchIntraday(t);
      const existing = await loadArchive(t);
      const seen = new Set(existing.map(function(b){ return b.t; }));
      let added = 0;
      for(const row of rows){
        if(!row || !row.date || !row.data) continue;
        if(seen.has(row.date)) continue;
        seen.add(row.date);
        existing.push({
          t: row.date,
          o: row.data.open, h: row.data.high, l: row.data.low, c: row.data.close,
          v: row.data.volume,
          x: !!row.data.is_extended_hours
        });
        added++;
      }
      if(added > 0) await saveArchive(t, existing);
      console.log("OK " + t + ": +" + added + " barras nuevas (total " + existing.length + ")");
    } catch(e){
      console.error("ERROR " + t + ": " + e.message);
    }
    await sleep(SLEEP_BETWEEN_TICKERS_MS);
  }
}

main();

