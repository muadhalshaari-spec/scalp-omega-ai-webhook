import postgres from 'npm:postgres';

const DB_URL = Deno.env.get('SUPABASE_DB_URL') ?? '';
const sql = postgres(DB_URL, {
  max: 1,
  idle_timeout: 20,
  max_lifetime: 1800
});

const INST_ID = 'ETH-USDT-SWAP';
const TIMEFRAMES = ['1m', '5m', '15m', '1H', '4H', '1D'];
const TF_LIMIT = 1000;

const EXTERNAL_CANDLES = Object.freeze({
  BINANCE: { instrument: 'ETHUSDT', endpoint: 'https://fapi.binance.com/fapi/v1/klines', interval: { '1m':'1m', '5m':'5m', '15m':'15m', '1H':'1h', '4H':'4h', '1D':'1d' } },
  BYBIT: { instrument: 'ETHUSDT', endpoint: 'https://api.bybit.com/v5/market/kline', interval: { '1m':'1', '5m':'5', '15m':'15', '1H':'60', '4H':'240', '1D':'D' } }
});

async function fetchBinanceCandles(tf, fullBackfill) {
  const cfg = EXTERNAL_CANDLES.BINANCE;
  const limit = fullBackfill ? 1000 : 100;
  const qs = new URLSearchParams({ symbol: cfg.instrument, interval: cfg.interval[tf], limit: String(limit) });
  const data = await getJson(cfg.endpoint + '?' + qs.toString());
  const observedAt = new Date().toISOString();
  return (Array.isArray(data) ? data : []).map(row => {
    const openTime = num(row?.[0]);
    const closeTime = num(row?.[6]);
    const o=num(row?.[1]), h=num(row?.[2]), l=num(row?.[3]), cl=num(row?.[4]), v=num(row?.[5]) ?? 0;
    if (![openTime,o,h,l,cl].every(Number.isFinite)) return null;
    return { source:'BINANCE', instrument:cfg.instrument, timeframe:tf, time_ms:Math.trunc(openTime), open:o, high:h, low:l, close:cl, volume:v, confirmed:Number.isFinite(closeTime) ? closeTime < Date.now() : true, observed_at:observedAt };
  }).filter(Boolean).sort((a,b)=>a.time_ms-b.time_ms);
}

async function fetchBybitCandles(tf, fullBackfill) {
  const cfg = EXTERNAL_CANDLES.BYBIT;
  const limit = fullBackfill ? 1000 : 100;
  const qs = new URLSearchParams({ category:'linear', symbol:cfg.instrument, interval:cfg.interval[tf], limit:String(limit) });
  const data = await getJson(cfg.endpoint + '?' + qs.toString());
  const rows = Array.isArray(data?.result?.list) ? data.result.list : [];
  const intervalMs = tf==='1D' ? 86400000 : Number(cfg.interval[tf])*60000;
  const observedAt = new Date().toISOString();
  return rows.map(row => {
    const openTime=num(row?.[0]); const o=num(row?.[1]), h=num(row?.[2]), l=num(row?.[3]), cl=num(row?.[4]), v=num(row?.[5]) ?? 0;
    if (![openTime,o,h,l,cl].every(Number.isFinite)) return null;
    return { source:'BYBIT', instrument:cfg.instrument, timeframe:tf, time_ms:Math.trunc(openTime), open:o, high:h, low:l, close:cl, volume:v, confirmed:openTime+intervalMs < Date.now(), observed_at:observedAt };
  }).filter(Boolean).sort((a,b)=>a.time_ms-b.time_ms);
}

async function needsBackfill(source, instrument, tf) {
  const rows = await sql`
    select rows_written
    from public.market_backfill_state
    where source=${source} and instrument=${instrument} and timeframe=${tf}
    limit 1
  `;
  return Number(rows[0]?.rows_written ?? 0) < TF_LIMIT;
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getJson(url, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'SCALP-Omega-MarketSync/2.0' },
      cache: 'no-store',
      signal: controller.signal
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + text.slice(0, 200));
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyToken(token) {
  if (!token) return false;
  const rows = await sql`
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'market_sync_token'
    limit 1
  `;
  return rows[0]?.decrypted_secret === token;
}

async function fetchOkxCandles(tf, fullBackfill) {
  const target = fullBackfill ? TF_LIMIT : 50;
  const pages = fullBackfill ? 5 : 1;
  const out = [];
  let after = null;

  for (let page = 0; page < pages && out.length < target; page++) {
    const qs = new URLSearchParams({
      instId: INST_ID,
      bar: tf,
      limit: fullBackfill ? '300' : '50'
    });
    if (after != null) qs.set('after', String(after));

    const data = await getJson('https://www.okx.com/api/v5/market/candles?' + qs.toString());
    const rows = Array.isArray(data?.data) ? data.data : [];
    if (!rows.length) break;
    out.push(...rows);

    const oldest = num(rows.at(-1)?.[0]);
    if (oldest == null || oldest === after) break;
    after = oldest;
    if (!fullBackfill || rows.length < 300) break;
  }

  const unique = new Map();
  const observedAt = new Date().toISOString();
  for (const row of out) {
    const ts = num(row?.[0]);
    const o = num(row?.[1]);
    const h = num(row?.[2]);
    const l = num(row?.[3]);
    const c = num(row?.[4]);
    const v = num(row?.[5]) ?? 0;
    if (![ts, o, h, l, c].every(Number.isFinite)) continue;

    unique.set(String(ts), {
      source: 'OKX',
      instrument: INST_ID,
      timeframe: tf,
      time_ms: Math.trunc(ts),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v,
      confirmed: row?.[8] === '1',
      observed_at: observedAt
    });
  }

  return [...unique.values()].sort((a, b) => a.time_ms - b.time_ms).slice(-target);
}


async function upsertRows(rows) {
  if (!rows.length) return 0;
  await sql`
    insert into public.market_candles (
      source,instrument,timeframe,time_ms,open,high,low,close,volume,confirmed,observed_at
    )
    select
      x.source,x.instrument,x.timeframe,x.time_ms,x.open,x.high,x.low,x.close,x.volume,x.confirmed,x.observed_at
    from jsonb_to_recordset(${sql.json(rows)}::jsonb) as x(
      source text,
      instrument text,
      timeframe text,
      time_ms bigint,
      open numeric,
      high numeric,
      low numeric,
      close numeric,
      volume numeric,
      confirmed boolean,
      observed_at timestamptz
    )
    on conflict (source,instrument,timeframe,time_ms)
    do update set
      open=excluded.open,
      high=excluded.high,
      low=excluded.low,
      close=excluded.close,
      volume=excluded.volume,
      confirmed=excluded.confirmed,
      observed_at=excluded.observed_at
  `;
  return rows.length;
}


const HISTORY_TARGETS = Object.freeze({
  OKX: 90 * 86400000,
  BINANCE: 3 * 365 * 86400000,
  BYBIT: 3 * 365 * 86400000
});
const BACKFILL_PAGES_PER_RUN = 10;
function intervalMs(tf) {
  const map = { '1m':60000, '5m':300000, '15m':900000, '1H':3600000, '4H':14400000, '1D':86400000 };
  return map[tf] || 60000;
}
const BACKFILL_MATRIX = [
  ...TIMEFRAMES.map(timeframe => ({ source:'OKX', instrument:INST_ID, timeframe })),
  ...TIMEFRAMES.map(timeframe => ({ source:'BINANCE', instrument:'ETHUSDT', timeframe })),
  ...TIMEFRAMES.map(timeframe => ({ source:'BYBIT', instrument:'ETHUSDT', timeframe }))
];
async function ensureBackfillState() {
  for (const item of BACKFILL_MATRIX) {
    const targetMs = Date.now() - (HISTORY_TARGETS[item.source] || 90 * 86400000);
    await sql`
      insert into public.market_backfill_state (source,instrument,timeframe,oldest_target_ms,completed)
      values (${item.source},${item.instrument},${item.timeframe},${targetMs},false)
      on conflict (source,instrument,timeframe) do nothing
    `;
  }
}
async function primeCursor(state) {
  if (state.cursor_ms !== null && state.cursor_ms !== undefined && Number.isFinite(Number(state.cursor_ms))) {
    return Number(state.cursor_ms);
  }
  return Date.now();
}
function normalizeBackfillRow(source, instrument, timeframe, row, observedAt) {
  const ts = num(row?.time_ms ?? row?.timestamp ?? row?.[0]);
  const o = num(row?.open ?? row?.[1]), h = num(row?.high ?? row?.[2]), l = num(row?.low ?? row?.[3]), c = num(row?.close ?? row?.[4]);
  const v = num(row?.volume ?? row?.[5]) ?? 0;
  if (![ts,o,h,l,c].every(Number.isFinite)) return null;
  return { source,instrument,timeframe,time_ms:Math.trunc(ts),open:o,high:h,low:l,close:c,volume:v,confirmed:true,observed_at:observedAt };
}
async function fetchHistoricalPage(state, cursorMs) {
  const observedAt = new Date().toISOString();
  if (state.source === 'BINANCE') {
    const cfg = EXTERNAL_CANDLES.BINANCE;
    const qs = new URLSearchParams({symbol:cfg.instrument,interval:cfg.interval[state.timeframe],limit:'1000',endTime:String(Math.max(0,cursorMs))});
    const data=await getJson(cfg.endpoint+'?'+qs.toString());
    return (Array.isArray(data)?data:[]).map(r=>normalizeBackfillRow('BINANCE',cfg.instrument,state.timeframe,{time_ms:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]},observedAt)).filter(Boolean).sort((a,b)=>a.time_ms-b.time_ms);
  }
  if (state.source === 'BYBIT') {
    const cfg=EXTERNAL_CANDLES.BYBIT;
    const qs=new URLSearchParams({category:'linear',symbol:cfg.instrument,interval:cfg.interval[state.timeframe],limit:'1000',end:String(Math.max(0,cursorMs))});
    const data=await getJson(cfg.endpoint+'?'+qs.toString());
    const rows=Array.isArray(data?.result?.list)?data.result.list:[];
    return rows.map(r=>normalizeBackfillRow('BYBIT',cfg.instrument,state.timeframe,{time_ms:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]},observedAt)).filter(Boolean).sort((a,b)=>a.time_ms-b.time_ms);
  }
  const out=[]; let after=Math.max(0,cursorMs);
  for(let page=0;page<BACKFILL_PAGES_PER_RUN && out.length<10000;page++){
    const qs=new URLSearchParams({instId:INST_ID,bar:state.timeframe,limit:'300',after:String(after)});
    const data=await getJson('https://www.okx.com/api/v5/market/history-candles?'+qs.toString());
    const rows=Array.isArray(data?.data)?data.data:[];
    if(!rows.length)break;
    for(const r of rows){
      const x=normalizeBackfillRow('OKX',INST_ID,state.timeframe,{time_ms:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]},observedAt);
      if(x)out.push(x);
    }
    const oldest=num(rows.at(-1)?.[0]);
    if(oldest==null||oldest>=after)break;
    after=oldest;
    if(rows.length<300)break;
  }
  return [...new Map(out.map(x=>[x.time_ms,x])).values()].sort((a,b)=>a.time_ms-b.time_ms);
}
async function backfillOneState() {
  await ensureBackfillState();
  const processed = [];
  const maxStatesPerRun = 4;
  for (let i = 0; i < maxStatesPerRun; i++) {
    const states = await sql`
      select source,instrument,timeframe,cursor_ms,oldest_target_ms,completed,last_run_at,rows_written
      from public.market_backfill_state
      where completed=false
      order by last_run_at nulls first,last_run_at asc,source,timeframe
      limit 1
    `;
    const state = states[0];
    if (!state) break;

    const cursor = await primeCursor(state);
    const target = Number(state.oldest_target_ms) || Date.now() - 90 * 86400000;
    if (cursor <= target) {
      await sql`update public.market_backfill_state
        set completed=true,last_run_at=now(),cursor_ms=${cursor}
        where source=${state.source} and instrument=${state.instrument} and timeframe=${state.timeframe}`;
      processed.push({
        status:'COMPLETE_FOR_STATE',
        source:state.source,
        instrument:state.instrument,
        timeframe:state.timeframe
      });
      continue;
    }

    const rows = await fetchHistoricalPage(state, cursor);
    if (!rows.length) {
      await sql`update public.market_backfill_state
        set completed=true,last_run_at=now(),cursor_ms=${cursor}
        where source=${state.source} and instrument=${state.instrument} and timeframe=${state.timeframe}`;
      processed.push({
        status:'SOURCE_EXHAUSTED',
        source:state.source,
        instrument:state.instrument,
        timeframe:state.timeframe
      });
      continue;
    }

    await upsertRows(rows);
    const minTs = Math.min(...rows.map(r => r.time_ms));
    const nextCursor = minTs - 1;
    await sql`
      update public.market_backfill_state
      set cursor_ms=${nextCursor},
          last_run_at=now(),
          rows_written=rows_written+${rows.length},
          completed=(${nextCursor}<=${target})
      where source=${state.source} and instrument=${state.instrument} and timeframe=${state.timeframe}
    `;
    processed.push({
      status:'BACKFILLED',
      source:state.source,
      instrument:state.instrument,
      timeframe:state.timeframe,
      fetched:rows.length,
      oldest:minTs,
      nextCursor,
      target
    });
  }
  return {
    status: processed.length ? 'BATCHED' : 'COMPLETE',
    processedCount: processed.length,
    processed
  };
}

async function persistDeepMicrostructure(snapshot) {
  const o=snapshot?.okx?.orderBook;if(!o)return {persisted:false,reason:'NO_ORDERBOOK'};
  const bids=Array.isArray(o.bids)?o.bids:[],asks=Array.isArray(o.asks)?o.asks:[],trades=Array.isArray(snapshot?.okx?.trades)?snapshot.okx.trades:[];
  const n=(v)=>Number.isFinite(Number(v))?Number(v):0;
  const b=bids.slice(0,400),a=asks.slice(0,400);
  const bd=b.reduce((s,x)=>s+n(x?.[1]),0),ad=a.reduce((s,x)=>s+n(x?.[1]),0);
  const bn=b.reduce((s,x)=>s+n(x?.[0])*n(x?.[1]),0),an=a.reduce((s,x)=>s+n(x?.[0])*n(x?.[1]),0);
  const bb=n(b[0]?.[0])||null,aa=n(a[0]?.[0])||null,mid=bb!=null&&aa!=null?(bb+aa)/2:null;
  const buy=trades.filter(t=>String(t?.side).toLowerCase()==='buy').reduce((s,t)=>s+n(t?.sz),0);
  const sell=trades.filter(t=>String(t?.side).toLowerCase()==='sell').reduce((s,t)=>s+n(t?.sz),0);
  const eventTs=snapshot.fetchedAt||new Date().toISOString(),bucket=new Date(Math.floor(new Date(eventTs).getTime()/60000)*60000).toISOString();
  await sql`
    insert into public.market_microstructure_snapshots(source,instrument,event_ts,event_bucket,seq_id,best_bid,best_ask,mid_price,spread,spread_bps,bid_depth_400,ask_depth_400,bid_notional_400,ask_notional_400,trade_count,buy_size,sell_size,delta_size,vwap,order_book,trades,metrics)
    values('OKX',${INST_ID},${eventTs}::timestamptz,${bucket}::timestamptz,${num(o.seqId)||null},${bb},${aa},${mid},${mid!=null?aa-bb:null},${mid?((aa-bb)/mid)*10000:null},${bd},${ad},${bn},${an},${trades.length},${buy},${sell},${buy-sell},${(buy+sell)?trades.reduce((s,t)=>s+n(t?.px)*n(t?.sz),0)/(buy+sell):null},${sql.json(o)},${sql.json(trades)},${sql.json({depthImbalance400:(bd+ad)?(bd-ad)/(bd+ad):null,notionalImbalance400:(bn+an)?(bn-an)/(bn+an):null,buySellRatio:sell?buy/sell:null,capture:'OKX_BOOKS_400_PLUS_RECENT_TRADES_500'})})
    on conflict(source,instrument,event_bucket) do update set
      event_ts=excluded.event_ts,seq_id=excluded.seq_id,best_bid=excluded.best_bid,best_ask=excluded.best_ask,mid_price=excluded.mid_price,spread=excluded.spread,spread_bps=excluded.spread_bps,
      bid_depth_400=excluded.bid_depth_400,ask_depth_400=excluded.ask_depth_400,bid_notional_400=excluded.bid_notional_400,ask_notional_400=excluded.ask_notional_400,
      trade_count=excluded.trade_count,buy_size=excluded.buy_size,sell_size=excluded.sell_size,delta_size=excluded.delta_size,vwap=excluded.vwap,order_book=excluded.order_book,trades=excluded.trades,metrics=excluded.metrics
  `;
  return {persisted:true};
}
async function persistCollectorState(snapshot) {
  const eventMs = Date.parse(snapshot?.fetchedAt || '') || Date.now();
  const eventTs = new Date(eventMs).toISOString();
  const category = 'OKX_SWAP';
  const symbol = INST_ID;
  const trades = Array.isArray(snapshot?.okx?.trades) ? snapshot.okx.trades : [];
  const book = snapshot?.okx?.orderBook || null;
  const ticker = snapshot?.okx?.ticker || null;
  const funding = snapshot?.okx?.funding || null;
  const oi = snapshot?.okx?.openInterest || null;

  for (const t of trades.slice(0, 100)) {
    const tradeId = String(t?.tradeId || t?.id || ((t?.ts || eventMs) + ':' + (t?.px || '') + ':' + (t?.sz || '') + ':' + (t?.side || '')));
    await sql`
      insert into public.market_trades
        (event_id,category,symbol,trade_time_ms,side,price,size,sequence_id,is_block_trade,is_rpi_trade,raw,observed_at)
      values
        (${('okx:trade:' + tradeId)},${category},${symbol},${num(t?.ts) || eventMs},${t?.side || null},
         ${num(t?.px)},${num(t?.sz)},${tradeId},false,false,${sql.json(t)},${eventTs}::timestamptz)
      on conflict (event_id) do nothing
    `;
  }

  if (book) {
    const bookTs = num(book.ts) || eventMs;
    const updateId = num(book.seqId);
    const bookEventId = 'okx:book:' + symbol + ':' + bookTs + ':' + (updateId ?? eventMs);
    await sql`
      insert into public.market_orderbook_updates
        (event_id,category,symbol,message_type,event_time_ms,update_id,cross_sequence,matching_engine_time_ms,bids,asks,raw,observed_at)
      values
        (${bookEventId},${category},${symbol},'snapshot',${bookTs},${updateId},null,${bookTs},
         ${sql.json(book.bids || [])},${sql.json(book.asks || [])},${sql.json(book)},${eventTs}::timestamptz)
      on conflict (event_id) do nothing
    `;
    await sql`
      insert into public.market_orderbook_state
        (category,symbol,event_time_ms,update_id,cross_sequence,matching_engine_time_ms,bids,asks)
      values
        (${category},${symbol},${bookTs},${updateId},null,${bookTs},${sql.json(book.bids || [])},${sql.json(book.asks || [])})
      on conflict (category,symbol) do update set
        event_time_ms=excluded.event_time_ms, update_id=excluded.update_id, matching_engine_time_ms=excluded.matching_engine_time_ms,
        bids=excluded.bids, asks=excluded.asks, updated_at=now()
    `;
  }

  if (ticker) {
    await sql`
      insert into public.market_ticker_state(category,symbol,event_time_ms,data)
      values (${category},${symbol},${num(ticker.ts) || eventMs},${sql.json(ticker)})
      on conflict (category,symbol) do update set event_time_ms=excluded.event_time_ms,data=excluded.data,updated_at=now()
    `;
  }

  if (funding && num(funding.fundingTime) != null) {
    await sql`
      insert into public.market_funding(category,symbol,funding_time_ms,funding_rate,raw,observed_at)
      values (${category},${symbol},${num(funding.fundingTime)},${num(funding.fundingRate)},${sql.json(funding)},${eventTs}::timestamptz)
      on conflict (category,symbol,funding_time_ms) do update set funding_rate=excluded.funding_rate,raw=excluded.raw,observed_at=excluded.observed_at
    `;
  }

  if (oi && num(oi.ts) != null) {
    await sql`
      insert into public.market_open_interest(category,symbol,interval_time,timestamp_ms,open_interest,open_interest_value,raw,observed_at)
      values (${category},${symbol},'snapshot',${num(oi.ts)},${num(oi.oi)},${num(oi.oiCcy)},${sql.json(oi)},${eventTs}::timestamptz)
      on conflict (category,symbol,interval_time,timestamp_ms) do update set
        open_interest=excluded.open_interest,open_interest_value=excluded.open_interest_value,raw=excluded.raw,observed_at=excluded.observed_at
    `;
  }

  const references = [
    ['BINANCE','ETHUSDT',snapshot?.binance?.premiumIndex || null],
    ['BINANCE_OI','ETHUSDT',snapshot?.binance?.openInterest || null],
    ['BYBIT','ETHUSDT',snapshot?.bybit?.ticker || null],
    ['BYBIT_OI','ETHUSDT',snapshot?.bybit?.openInterest || null],
    ['DERIBIT','ETH-PERPETUAL',snapshot?.deribit?.ticker || null]
  ];
  for (const [key, refSymbol, data] of references) {
    if (!data) continue;
    await sql`
      insert into public.market_reference(reference_key,category,symbol,data,observed_at)
      values (${key},${category},${refSymbol},${sql.json(data)},${eventTs}::timestamptz)
      on conflict (reference_key,category,symbol) do update set data=excluded.data,observed_at=excluded.observed_at
    `;
  }

  await sql`
    insert into public.market_raw_events(event_id,topic,event_time_ms,payload,observed_at)
    values (${('okx:market-sync:' + eventMs)},'okx.market-sync.snapshot',${eventMs},${sql.json(snapshot)},${eventTs}::timestamptz)
    on conflict (event_id) do nothing
  `;

  await sql`
    insert into public.collector_health(
      id,category,symbol,process_started_at_ms,ws_connected,ws_last_message_at_ms,rest_last_success_at_ms,last_error_at_ms,
      last_error,messages,trades,orderbook_messages,ticker_messages,candle_messages,liquidation_messages,queued_rows,updated_at
    ) values (
      ${('OKX_REST:' + symbol)},${category},${symbol},${eventMs},false,null,${eventMs},null,null,
      1,${trades.length},${book ? 1 : 0},${ticker ? 1 : 0},${TIMEFRAMES.length},0,0,now()
    )
    on conflict (id) do update set
      rest_last_success_at_ms=excluded.rest_last_success_at_ms,last_error_at_ms=null,last_error=null,
      messages=excluded.messages,trades=excluded.trades,orderbook_messages=excluded.orderbook_messages,
      ticker_messages=excluded.ticker_messages,candle_messages=excluded.candle_messages,updated_at=now()
  `;

  return { persisted:true, tradeRows:trades.length, orderbookSnapshot:Boolean(book), tickerState:Boolean(ticker),
    fundingState:Boolean(funding), openInterestState:Boolean(oi), collectorHealth:'OKX_REST:' + symbol };
}
async function fetchSnapshot() {
  const [ticker, book, trades, oi, funding, binancePremium, binanceOi, bybitTicker, bybitOi, deribitTicker] =
    await Promise.allSettled([
      getJson('https://www.okx.com/api/v5/market/ticker?instId=' + INST_ID),
      getJson('https://www.okx.com/api/v5/market/books?instId=' + INST_ID + '&sz=400'),
      getJson('https://www.okx.com/api/v5/market/trades?instId=' + INST_ID + '&limit=500'),
      getJson('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=' + INST_ID),
      getJson('https://www.okx.com/api/v5/public/funding-rate?instId=' + INST_ID),
      getJson('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT'),
      getJson('https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT'),
      getJson('https://api.bybit.com/v5/market/tickers?category=linear&symbol=ETHUSDT'),
      getJson('https://api.bybit.com/v5/market/open-interest?category=linear&symbol=ETHUSDT&intervalTime=5min&limit=1'),
      getJson('https://www.deribit.com/api/v2/public/ticker?instrument_name=ETH-PERPETUAL')
    ]);

  const val = (r) => r.status === 'fulfilled' ? r.value : null;
  return {
    fetchedAt: new Date().toISOString(),
    source: 'SCALP-OMEGA-MARKET-SYNC',
    instrument: INST_ID,
    okx: {
      ticker: val(ticker)?.data?.[0] ?? null,
      orderBook: val(book)?.data?.[0] ?? null,
      trades: (val(trades)?.data ?? []).slice(0, 100),
      openInterest: val(oi)?.data?.[0] ?? null,
      funding: val(funding)?.data?.[0] ?? null
    },
    binance: {
      premiumIndex: val(binancePremium),
      openInterest: val(binanceOi)
    },
    bybit: {
      ticker: val(bybitTicker)?.result?.list?.[0] ?? null,
      openInterest: val(bybitOi)?.result?.list?.[0] ?? null
    },
    deribit: {
      ticker: val(deribitTicker)?.result ?? null
    }
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ ok: false, error: 'POST required' }, { status: 405 });
  }
  if (!DB_URL) {
    return Response.json({ ok: false, error: 'SUPABASE_DB_URL missing' }, { status: 500 });
  }

  const started = Date.now();
  try {
    const authorized = await verifyToken(req.headers.get('x-market-sync-token') ?? '');
    if (!authorized) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

    const results = [];
    for (const tf of TIMEFRAMES) {
      const backfill = await needsBackfill('OKX', INST_ID, tf);
      const rows = await fetchOkxCandles(tf, backfill);
      const written = await upsertRows(rows);
      results.push({ source:'OKX', instrument:INST_ID, timeframe:tf, mode:backfill?'BACKFILL':'INCREMENTAL', fetched:rows.length, written, latest:rows.at(-1)?.time_ms ?? null, confirmed:rows.filter(r=>r.confirmed).length, status:'OK' });
    }

    for (const [source, cfg] of Object.entries(EXTERNAL_CANDLES)) {
      for (const tf of TIMEFRAMES) {
        const backfill = await needsBackfill(source, cfg.instrument, tf);
        try {
          const rows = source === 'BINANCE' ? await fetchBinanceCandles(tf, backfill) : await fetchBybitCandles(tf, backfill);
          const written = await upsertRows(rows);
          results.push({ source, instrument:cfg.instrument, timeframe:tf, mode:backfill?'BACKFILL':'INCREMENTAL', fetched:rows.length, written, latest:rows.at(-1)?.time_ms ?? null, confirmed:rows.filter(r=>r.confirmed).length, status:'OK' });
        } catch (error) {
          results.push({ source, instrument:cfg.instrument, timeframe:tf, mode:backfill?'BACKFILL':'INCREMENTAL', fetched:0, written:0, latest:null, confirmed:0, status:'FAILED', error:error?.message ?? String(error) });
        }
      }
    }

    const snapshot = await fetchSnapshot();
    const deepMicrostructure = await persistDeepMicrostructure(snapshot).catch(error => ({persisted:false,error:error?.message || String(error)}));
    const collectorPersistence = await persistCollectorState(snapshot).catch(error => ({persisted:false,error:error?.message || String(error)}));
    const historicalBackfill = await backfillOneState().catch(error => ({status:'FAILED',error:error?.message || String(error)}));
    const eventTs = new Date().toISOString();
    const summary = {
      price: num(snapshot.okx.ticker?.last),
      binanceMarkPrice: num(snapshot.binance.premiumIndex?.markPrice),
      bybitPrice: num(snapshot.bybit.ticker?.lastPrice),
      deribitPrice: num(snapshot.deribit.ticker?.last_price),
      okxFundingRate: num(snapshot.okx.funding?.fundingRate),
      okxOpenInterest: num(snapshot.okx.openInterest?.oi),
      binanceFundingRate: num(snapshot.binance.premiumIndex?.lastFundingRate),
      bybitFundingRate: num(snapshot.bybit.ticker?.fundingRate)
    };

    await sql`
      insert into public.market_snapshots (source,instrument,event_ts,payload)
      values (
        'SCALP-OMEGA-MARKET-SYNC',
        ${INST_ID},
        ${eventTs}::timestamptz,
        ${sql.json({...snapshot, summary})}
      )
    `;

    return Response.json({
      ok: true,
      engine: 'SCALP-Ω Supabase Market Sync v2.1',
      instrument: INST_ID,
      durationMs: Date.now() - started,
      results,
      deepMicrostructure,
      collectorPersistence,
      historicalBackfill,
      snapshotStored: true,
      sourceCoverage: { candleSources:['OKX','BINANCE','BYBIT'], timeframes:TIMEFRAMES }
    });
  } catch (error) {
    return Response.json({
      ok: false,
      engine: 'SCALP-Ω Supabase Market Sync v2.1',
      durationMs: Date.now() - started,
      error: error?.message ?? String(error)
    }, { status: 500 });
  }
});
