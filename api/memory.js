import { getLiveMemory } from '../lib/market-memory.js';
import { supabaseConfigured, getRecentMarketCandles } from '../lib/supabase.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const [memory,candles]=await Promise.all([
      getLiveMemory(),
      getRecentMarketCandles({source:'OKX',instrument:'ETH-USDT-SWAP',timeframe:'15m',limit:20})
    ]);
    return res.status(200).json({
      ok:true,
      engine:'SCALP-Ω Memory Health v1',
      supabase:{configured:supabaseConfigured(),reachable:candles.configured===true,latest15mRows:candles.rows.length},
      upstash:{configured:memory.configured,reachable:memory.configured===true && memory.value!==null,key:memory.key,updatedAt:memory.value?.updatedAt||null},
      policy:{historicalStore:'SUPABASE',realtimeStore:'UPSTASH_REDIS',decisionAuthority:'CHATGPT_ONLY'}
    });
  }catch(e){ return res.status(503).json({ok:false,error:e?.message||String(e)}); }
}