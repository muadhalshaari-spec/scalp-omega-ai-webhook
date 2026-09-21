import { getLiveMemory } from '../lib/market-memory.js';

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const host=typeof req.headers.host==='string'?req.headers.host:'scalp-omega-ai-webhook.vercel.app';
  try{
    const r=await fetch('https://'+host+'/api/confluence?dataOnly=1&ts='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}});
    const memory=await getLiveMemory().catch(()=>({configured:false,value:null}));
    const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=null}
    if(!r.ok||!data?.ok)return res.status(502).json({ok:false,error:data?.error||text.slice(0,500)});
    // DATA-ONLY CONTRACT: expose observations and market data only.
    // Deliberately omit all trading decisions, signals, probabilities, entries, stops, targets and risk gates.
    return res.status(200).json({ok:true,engine:'SCALP-Ω Market Data Feed v3',decisionAuthority:'CHATGPT_CONVERSATIONAL_ONLY',decisionPolicy:'CHATGPT_ONLY',source:data.source,instrument:data.instrument,fetchedAt:data.fetchedAt,analysisMode:'DATA_FOR_CHATGPT',market:data.market,features:data.features,contexts:data.contexts,externalIntelligence:data.externalIntelligence,macroContext:data.macroContext||null,observations:data.observations,dataQuality:data.dataQuality,featureSummary:data.featureSummary,memory:{historicalStore:'SUPABASE',realtimeStore:'UPSTASH_REDIS',upstashConfigured:memory.configured,upstashLiveSnapshotCached:memory.value!==null,upstashUpdatedAt:memory.value?.updatedAt||null}});
  }catch(e){return res.status(502).json({ok:false,error:e?.message||String(e)})}
}
