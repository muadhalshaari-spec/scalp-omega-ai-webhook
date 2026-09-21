import { getBybitPrivateAccount } from '../lib/bybit-private.js';

export const maxDuration = 20;

function authorized(req){
  const expected = process.env.WEBHOOK_SECRET;
  if(!expected) return false;
  const supplied = req.headers['x-webhook-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i,'');
  return supplied === expected;
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  if(!authorized(req)) return res.status(401).json({ok:false,error:'Unauthorized'});
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),15000);
  try{
    const data = await getBybitPrivateAccount({signal:controller.signal});
    return res.status(200).json({
      ok:true,
      engine:'SCALP-Ω Bybit Private Account Adapter v1',
      decisionAuthority:'CHATGPT_ONLY',
      decisionPolicy:'ACCOUNT_DATA_ONLY_NO_DECISION',
      ...data
    });
  }catch(e){
    return res.status(502).json({
      ok:false,
      error:e?.message||String(e),
      decisionGenerated:false
    });
  }finally{
    clearTimeout(timer);
  }
}
