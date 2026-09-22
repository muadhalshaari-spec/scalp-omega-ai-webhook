import { getBybitPrivateAccount } from '../lib/bybit-private.js';

export const maxDuration = 20;

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const data = await getBybitPrivateAccount();
    return res.status(200).json({
      ok:true,
      connection:'BYBIT_PRIVATE_AUTH_OK',
      environment:data.environment,
      checkedAt:data.fetchedAt,
      endpoints:{
        wallet:true,
        position:true,
        openOrders:true
      },
      decisionAuthority:'CHATGPT_ONLY',
      accountDataReturned:false
    });
  }catch(e){
    return res.status(502).json({
      ok:false,
      connection:'BYBIT_PRIVATE_AUTH_FAILED',
      error:e?.message||String(e),
      accountDataReturned:false
    });
  }
}
