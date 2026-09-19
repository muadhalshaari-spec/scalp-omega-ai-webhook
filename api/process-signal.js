import { verifySignature } from '@upstash/qstash/nextjs';
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
async function handler(req,res){

  let stage='start';
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    stage='read_body';
    const rawBody=await readRawBody(req);
    stage='verify_qstash';
    // Signature verification is handled by the Upstash Next.js verifier wrapper.
    // The wrapper receives the exact raw body because bodyParser is disabled above.

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

export default verifySignature(handler);
