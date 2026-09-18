import crypto from 'node:crypto';
import { Client } from '@upstash/qstash';

export const maxDuration = 10;

function parseBody(req){
  if(req?.body&&typeof req.body==='object')return req.body;
  if(typeof req?.body==='string'){try{return JSON.parse(req.body)}catch{return{raw:req.body}}}
  return{};
}
function authorized(req){
  const expected=process.env.TV_WEBHOOK_SECRET;
  if(!expected)return{configured:false,ok:true};
  const supplied=String(req.headers?.['x-tradingview-secret']??req.headers?.['x-webhook-secret']??'');
  const a=Buffer.from(supplied),b=Buffer.from(expected);
  return{configured:true,ok:a.length===b.length&&crypto.timingSafeEqual(a,b)};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method==='GET')return res.status(200).json({
    ok:true,service:'SCALP-Ω TradingView Webhook',endpoint:'/api/webhook',
    accepts:['POST'],processor:'/api/process-signal',
    authentication:process.env.TV_WEBHOOK_SECRET?'configured':'not_configured',
    queue:'QSTASH'
  });
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const auth=authorized(req);
  if(!auth.ok)return res.status(401).json({ok:false,error:'Invalid webhook secret'});

  const alert=parseBody(req);
  const jobId=crypto.randomUUID();
  const base=`https://${req.headers.host}`;
  const payload={jobId,alert,receivedAt:new Date().toISOString(),source:'TRADINGVIEW'};

  try{
    if(!process.env.QSTASH_TOKEN)throw new Error('QSTASH_TOKEN is not configured');
    const client=new Client({token:process.env.QSTASH_TOKEN});
    const result=await client.publishJSON({
      url:`${base}/api/process-signal`,
      body:payload
    });
    return res.status(202).json({
      ok:true,accepted:true,queued:true,jobId,
      qstashMessageId:result.messageId||null,
      receivedAt:payload.receivedAt,
      webhookAuthenticated:auth.configured,
      processor:'/api/process-signal',
      queue:'QSTASH',
      execution:'asynchronous',
      message:'Alert accepted by QStash for institutional processing.'
    });
  }catch(e){
    return res.status(502).json({ok:false,accepted:false,queued:false,jobId,error:e?.message||String(e)});
  }
}
