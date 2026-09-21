export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  const host=typeof req.headers.host==='string'?req.headers.host:'scalp-omega-ai-webhook.vercel.app';
  try{
    const r=await fetch('https://'+host+'/api/institutional?ts='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}});
    const text=await r.text();
    let data=null; try{data=JSON.parse(text)}catch{}
    if(!r.ok||!data?.ok) return res.status(502).json({ok:false,error:data?.error||text.slice(0,500)});
    return res.status(200).json({
      ...data,
      engine:'SCALP-Ω Live Data Bridge for ChatGPT',
      decisionAuthority:'CHATGPT_CONVERSATIONAL_ONLY',
      decisionPolicy:'CHATGPT_ONLY',
      finalDecision:null,
      instruction:'ChatGPT must perform the market reasoning and issue the final LONG, SHORT, or NO_TRADE decision from the supplied evidence.'
    });
  }catch(e){
    return res.status(502).json({ok:false,error:e?.message||String(e)});
  }
}
