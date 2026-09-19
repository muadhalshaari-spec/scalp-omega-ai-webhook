import { Receiver } from '@upstash/qstash';
import { insertSignalEvent, supabaseConfigured } from '../lib/supabase.js';

export const maxDuration = 60;
export const config = { api: { bodyParser: false } };

function readRawBody(req){
  return new Promise((resolve,reject)=>{
    let data='';
    req.setEncoding('utf8');
    req.on('data',chunk=>{data+=chunk;});
    req.on('end',()=>resolve(data));
    req.on('error',reject);
  });
}
function verifyLegacy(req){
  const secret=process.env.SIGNAL_PROCESS_SECRET;
  if(!secret)return false;
  const supplied=String(req.headers?.['x-signal-process-secret']||'');
  return supplied===secret;
}
export default async function handler(req,res){
  let stage='start';
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    stage='read_body';
    const rawBody=await readRawBody(req);
    const signature=String(req.headers?.['upstash-signature']||'');
    let verified=false;
    stage='verify_qstash';
    if(signature&&process.env.QSTASH_CURRENT_SIGNING_KEY&&process.env.QSTASH_NEXT_SIGNING_KEY){
      const receiver=new Receiver({
        currentSigningKey:process.env.QSTASH_CURRENT_SIGNING_KEY,
        nextSigningKey:process.env.QSTASH_NEXT_SIGNING_KEY
      });
      const base=`https://${req.headers.host}`;
      verified=await receiver.verify({signature,body:rawBody,url:`${base}/api/process-signal`});
    } else if(verifyLegacy(req)) {
      verified=true;
    }
    if(!verified)return res.status(401).json({ok:false,error:'Invalid QStash signature'});

    const body=JSON.parse(rawBody||'{}');
    const base=`https://${req.headers.host}`;
    stage='institutional';
    const r=await fetch(`${base}/api/institutional?ts=${Date.now()}`,{headers:{Accept:'application/json'},cache:'no-store'});
    const t=await r.text();let data=null;try{data=JSON.parse(t)}catch{}
    if(!r.ok||!data?.ok)return res.status(502).json({ok:false,error:data?.error||t.slice(0,500),stage});

    const processedAt=new Date().toISOString();
    const alert=body.alert||body;
    let persistence={configured:false};
    if(supabaseConfigured()){
      stage='supabase_insert';
      persistence=await insertSignalEvent({
        job_id: body.jobId || null,
        source: body.source || 'TRADINGVIEW',
        alert,
        institutional: data.institutional||null,
        status: 'PROCESSED',
        received_at: body.receivedAt || null,
        processed_at: processedAt
      });
    }

    return res.status(200).json({
      ok:true,
      processedAt,
      alert,
      pipeline:'INSTITUTIONAL_EXECUTION',
      institutional:data.institutional||null,
      persistence
    });
  }catch(e){
    console.error('process-signal failed', {stage, error:e?.message||String(e)});
    return res.status(502).json({ok:false,error:e?.message||String(e),stage});
  }
}
