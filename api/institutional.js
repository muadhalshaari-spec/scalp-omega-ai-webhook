export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const host=typeof req.headers.host==='string'?req.headers.host:'scalp-omega-ai-webhook.vercel.app';
  try{
    const r=await fetch('https://'+host+'/api/confluence?dataOnly=1&ts='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}});
    const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=null}
    if(!r.ok||!data?.ok)return res.status(502).json({ok:false,error:data?.error||text.slice(0,500)});

    // DATA-ONLY CONTRACT:
    // expose observations/measurements only; never expose trading decisions,
    // signals, probabilities, entries, stops, targets, verdicts, or risk gates.
    const stripDerivedSignals = (value)=>{
      if(!value||typeof value!=='object') return value;
      if(Array.isArray(value)) return value.map(stripDerivedSignals);
      const out={};
      for(const [k,v] of Object.entries(value)){
        if(k==='featureSignals') continue;
        out[k]=stripDerivedSignals(v);
      }
      return out;
    };

    return res.status(200).json({
      ok:true,
      engine:'SCALP-Ω AI Data Feed v2',
      decisionAuthority:'CHATGPT_ONLY',
      decisionPolicy:'NO_DECISION_OUTPUT',
      source:data.source,
      instrument:data.instrument,
      fetchedAt:data.fetchedAt,
      analysisMode:'DATA_ONLY_CLOSED_CANDLES',
      market:stripDerivedSignals(data.market),
      features:stripDerivedSignals(data.features),
      contexts:stripDerivedSignals(data.contexts),
      externalIntelligence:stripDerivedSignals(data.externalIntelligence),
      macroContext:stripDerivedSignals(data.macroContext||null),
      observations:stripDerivedSignals(data.observations),
      dataQuality:data.dataQuality,
      featureSummary:stripDerivedSignals(data.featureSummary)
    });
  }catch(e){
    return res.status(502).json({ok:false,error:e?.message||String(e)})
  }
}
