import { runInstitutionalBacktest } from '../lib/institutional-backtest.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Method not allowed' });

  const instId = 'ETH-USDT-SWAP';
  const bars = ['1m','5m','15m','1H','4H','1D'];
  const target = 1000;
  const backtest15mTarget = Math.min(5000, Math.max(1000, Number(req.query?.depth || 5000)));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const fetchJson = async (url) => {
    const r = await fetch(url,{cache:'no-store',signal:controller.signal,headers:{Accept:'application/json','User-Agent':'SCALP-Omega-Backtest/1.0'}});
    const text = await r.text();
    let data; try { data=JSON.parse(text); } catch { data=null; }
    if(!r.ok || data?.code !== '0') throw new Error(`OKX HTTP ${r.status}: ${data?.msg || text.slice(0,200)}`);
    return data;
  };

  const fetchCandles = async (bar) => {
    const out=[]; let after=null;
    const desired = bar === '15m' ? backtest15mTarget : target;
    const useHistory = bar === '15m';
    const maxPages = bar === '15m' ? Math.ceil(desired / 100) + 2 : 5;
    for(let page=0;page<maxPages && out.length<desired;page++){
      const p=new URLSearchParams({instId,bar,limit: useHistory ? '100' : '300'});
      if(after!=null)p.set('after',String(after));
      const endpoint = useHistory ? 'history-candles' : 'candles';
      const d=await fetchJson(`https://www.okx.com/api/v5/market/${endpoint}?${p}`);
      const rows=d.data||[]; if(!rows.length)break;
      out.push(...rows);
      const oldest=Number(rows[rows.length-1][0]);
      if(!Number.isFinite(oldest)||oldest===after)break;
      after=oldest; if(rows.length<300)break;
    }
    const unique=new Map(out.map(r=>[String(r[0]),r]));
    return [...unique.values()] .sort((a,b)=>Number(a[0])-Number(b[0])).slice(-desired).map(c=>({
      time:Number(c[0]),open:Number(c[1]),high:Number(c[2]),low:Number(c[3]),close:Number(c[4]),volume:Number(c[5]),confirmed:c[8]==='1'
    }));
  };

  try {
    const rows=await Promise.all(bars.map(async bar=>[bar,await fetchCandles(bar)]));
    const candlesByTf=Object.fromEntries(rows);
    const result=runInstitutionalBacktest({candlesByTf,horizonBars:48,feesBps:5,slippageBps:2});
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store,no-cache,must-revalidate');
    return res.status(200).send(JSON.stringify({
      ok:true,engine:'SCALP-Ω Institutional Backtest Engine v2',source:'OKX',instrument:instId,
      generatedAt:new Date().toISOString(),candlesPerTimeframe:Object.fromEntries(rows.map(([tf,c])=>[tf,c.length])),
      closedCandlesPerTimeframe:Object.fromEntries(rows.map(([tf,c])=>[tf,c.filter(x=>x.confirmed).length])),
      ...result
    },null,2));
  } catch(error) {
    res.setHeader('Cache-Control','no-store');
    return res.status(502).json({ok:false,error:error?.name==='AbortError'?'OKX request timed out after 15 seconds':error?.message||String(error)});
  } finally { clearTimeout(timeout); }
}
