import { executeBybitCommand, executionCapabilities } from '../lib/bybit-execution.js';

export const maxDuration = 20;

function authorized(req){
  const expected=process.env.WEBHOOK_SECRET;
  if(!expected) return false;
  const supplied=req.headers['x-webhook-secret'] || req.headers.authorization?.replace(/^Bearer\\s+/i,'');
  return supplied===expected;
}

function parseBody(req){
  if(req.body && typeof req.body==='object') return req.body;
  try{return JSON.parse(req.body||'{}')}catch{return null}
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method not allowed'});
  if(!authorized(req)) return res.status(401).json({ok:false,error:'Unauthorized'});

  const command=parseBody(req);
  if(!command) return res.status(400).json({ok:false,error:'Invalid JSON body'});

  try{
    const result=await executeBybitCommand(command);
    return res.status(result.dryRun?200:202).json({
      ok:true,
      engine:'SCALP-Ω Bybit Execution Engine v1',
      decisionAuthority:'CHATGPT_ONLY',
      executionEnabled:String(process.env.BYBIT_EXECUTION_ENABLED||'false').toLowerCase()==='true',
      capabilities:executionCapabilities,
      result
    });
  }catch(e){
    return res.status(400).json({
      ok:false,
      engine:'SCALP-Ω Bybit Execution Engine v1',
      decisionAuthority:'CHATGPT_ONLY',
      decisionGenerated:false,
      error:e?.message||String(e)
    });
  }
}
