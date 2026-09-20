import crypto from 'node:crypto';
import { insertSignalEvent } from '../lib/supabase.js';

export const maxDuration = 60;

function parseBody(req){if(req?.body&&typeof req.body==='object')return req.body;if(typeof req?.body==='string'){try{return JSON.parse(req.body)}catch{}}return{}}
function verify(req){
  const secret=process.env.SIGNAL_PROCESS_SECRET;
  if(!secret)return true;
  const supplied=String(req.headers?.['x-signal-process-secret']||'');
  const a=Buffer.from(supplied),b=Buffer.from(secret);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  if(!verify(req))return res.status(401).json({ok:false,error:'Unauthorized'});
  const body=parseBody(req);
  const base=`https://${req.headers.host}`;
  try{
    const r=await fetch(`${base}/api/institutional?ts=${Date.now()}`,{headers:{Accept:'application/json'},cache:'no-store'});
    const t=await r.text();let data=null;try{data=JSON.parse(t)}catch{}
    if(!r.ok||!data?.ok)return res.status(502).json({ok:false,error:data?.error||t.slice(0,500)});
    const institutional=data.institutional||null;
    let persistence={configured:false,persisted:false,status:'NOT_CONFIGURED'};
    try{
      persistence=await Promise.race([
        insertSignalEvent({
          job_id:body.jobId||null,
          source:'TRADINGVIEW',
          alert:body.alert||body,
          institutional,
          status:'PROCESSED',
          received_at:body.receivedAt||new Date().toISOString(),
          processed_at:new Date().toISOString()
        }),
        new Promise((resolve)=>setTimeout(()=>resolve({configured:false,persisted:false,status:'TIMEOUT'}),1500))
      ]);
    }catch(e){persistence={configured:true,persisted:false,status:'ERROR',error:String(e?.message||e)}}
    return res.status(200).json({
      ok:true,processedAt:new Date().toISOString(),alert:body.alert||body,
      pipeline:'INSTITUTIONAL_EXECUTION',institutional,persistence
    });
  }catch(e){return res.status(502).json({ok:false,error:e?.message||String(e)})}
}
