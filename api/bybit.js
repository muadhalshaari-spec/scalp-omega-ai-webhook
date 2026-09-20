import { getBybitFullMarketData } from '../lib/bybit.js';

export const maxDuration = 55;

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),50000);
  try{
    const data=await getBybitFullMarketData({signal:controller.signal});
    return res.status(data.available?200:502).json({
      ok:data.available===true,
      engine:'SCALP-Ω Bybit Full Market Data Adapter v3',
      decisionAuthority:'CHATGPT_ONLY',
      decisionPolicy:'BYBIT_DATA_ONLY_NO_DECISION',
      ...data
    });
  }catch(e){
    return res.status(502).json({ok:false,error:e?.message||String(e),decisionGenerated:false});
  }finally{clearTimeout(timer)}
}