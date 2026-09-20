import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';

export const maxDuration = 10;

function parseBody(req){
  if(req?.body&&typeof req.body==='object')return req.body;
  if(typeof req?.body==='string'){try{return JSON.parse(req.body)}catch{return{raw:req.body}}}
  return{};
}
function authorized(req){
  const expected=process.env.TV_WEBHOOK_SECRET;
  if(!expected)return{configured:false,ok:true};
  const alert=parseBody(req);
  const supplied=String(req.headers?.['x-tradingview-secret']??req.headers?.['x-webhook-secret']??alert.webhookSecret??alert.secret??alert.token??'');
  const a=Buffer.from(supplied),b=Buffer.from(expected);
  return{configured:true,ok:a.length===b.length&&crypto.timingSafeEqual(a,b)};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method==='GET')return res.status(200).json({
    ok:true,service:'SCALP-Ω TradingView Webhook',endpoint:'/api/webhook',
    accepts:['POST'],processor:'/api/process-signal',
    authentication:process.env.TV_WEBHOOK_SECRET?'configured':'not_configured'
  });
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const auth=authorized(req);
  if(!auth.configured)return res.status(503).json({ok:false,error:'TradingView webhook secret is not configured; webhook is fail-closed.'});
  if(!auth.ok)return res.status(401).json({ok:false,error:'Invalid webhook secret'});

  const jobId=crypto.randomUUID();
  const base=`https://${req.headers.host}`;
  const payload={jobId,alert,receivedAt:new Date().toISOString(),source:'TRADINGVIEW'};
  const qstashToken=process.env.QSTASH_TOKEN;
  const qstashDestination=process.env.QSTASH_DESTINATION_URL || `https://${req.headers.host}/api/process-signal`;
  if(qstashToken){
    try{
      const qstashHeaders={
        Authorization:`Bearer ${qstashToken}`,
        'Content-Type':'application/json',
        'Upstash-Retries':'3',
        'Upstash-Timeout':'15s',
        'Upstash-Content-Based-Deduplication':'true'
      };
      if(process.env.SIGNAL_PROCESS_SECRET)qstashHeaders['Upstash-Forward-x-signal-process-secret']=process.env.SIGNAL_PROCESS_SECRET;
      const qr=await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(qstashDestination)}`,{
        method:'POST',headers:qstashHeaders,body:JSON.stringify(payload),cache:'no-store'
      });
      if(!qr.ok)throw new Error(`QStash HTTP ${qr.status}`);
      const qdata=await qr.json().catch(()=>({}));
      return res.status(202).json({ok:true,accepted:true,queued:true,jobId,receivedAt:payload.receivedAt,webhookAuthenticated:true,queue:'QSTASH',messageId:qdata.messageId||null,processor:'/api/process-signal',execution:'qstash'});
    }catch(e){
      // Fail closed for the queue path: do not silently downgrade if QStash is configured.
      return res.status(502).json({ok:false,error:'QStash publish failed',detail:e?.message||String(e)});
    }
  }

  waitUntil((async()=>{
    try{
      const headers={'Content-Type':'application/json','Accept':'application/json'};
      if(process.env.SIGNAL_PROCESS_SECRET)headers['x-signal-process-secret']=process.env.SIGNAL_PROCESS_SECRET;
      await fetch(`${base}/api/process-signal`,{
        method:'POST',headers,body:JSON.stringify(payload),cache:'no-store'
      });
    }catch{}
  })());

  return res.status(202).json({
    ok:true,accepted:true,queued:true,jobId,
    receivedAt:payload.receivedAt,
    webhookAuthenticated:auth.configured,
    processor:'/api/process-signal',
    execution:'asynchronous',
    message:'Alert accepted for background institutional processing.'
  });
}
