import crypto from 'crypto';

const BASE = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
const API_KEY = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_API_SECRET;
const RECV_WINDOW = String(process.env.BYBIT_RECV_WINDOW || '5000');
const SYMBOL = 'ETHUSDT';
const CATEGORY = 'linear';

function requireCredentials(){
  if(!API_KEY || !API_SECRET) throw new Error('Bybit private API credentials are not configured');
}

function sign(timestamp, payload=''){
  return crypto.createHmac('sha256', API_SECRET)
    .update(String(timestamp) + API_KEY + RECV_WINDOW + payload)
    .digest('hex');
}

async function privatePost(path, body, signal){
  requireCredentials();
  const bodyString = JSON.stringify(body);
  const timestamp = Date.now();
  const response = await fetch(BASE + path, {
    method:'POST',
    headers:{
      Accept:'application/json',
      'Content-Type':'application/json',
      'User-Agent':'SCALP-Omega-Bybit-Execution-Engine/1.0',
      'X-BAPI-API-KEY':API_KEY,
      'X-BAPI-TIMESTAMP':String(timestamp),
      'X-BAPI-RECV-WINDOW':RECV_WINDOW,
      'X-BAPI-SIGN':sign(timestamp, bodyString)
    },
    body:bodyString,
    cache:'no-store',
    signal
  });
  const text = await response.text();
  let data=null;
  try{ data=JSON.parse(text); }catch{}
  if(!response.ok || data?.retCode!==0){
    throw new Error('Bybit execution '+path+' HTTP '+response.status+': '+(data?.retMsg||text.slice(0,500)));
  }
  return data;
}

function assertFinitePositive(value,name){
  const n=Number(value);
  if(!Number.isFinite(n) || n<=0) throw new Error(name+' must be a positive number');
  return n;
}

function normalizeSide(side){
  const s=String(side||'').toUpperCase();
  if(s==='LONG'||s==='BUY') return 'Buy';
  if(s==='SHORT'||s==='SELL') return 'Sell';
  throw new Error('side must be LONG/SHORT/BUY/SELL');
}

function validateCommand(command){
  if(!command || command.authority!=='CHATGPT') throw new Error('Execution requires authority=CHATGPT');
  if(!command.decisionId) throw new Error('decisionId is required');
  if(!['OPEN','CLOSE','REDUCE','CANCEL','AMEND'].includes(command.action)) throw new Error('Unsupported action');
  if(command.symbol && command.symbol!==SYMBOL) throw new Error('Only ETHUSDT execution is enabled');
  if(command.action==='OPEN'){
    if(!['LONG','SHORT','BUY','SELL'].includes(String(command.side||'').toUpperCase())) throw new Error('OPEN requires side');
    assertFinitePositive(command.qty,'qty');
    if(command.orderType==='Limit') assertFinitePositive(command.price,'price');
  }
  return true;
}

export async function executeBybitCommand(command,{signal}={}){
  validateCommand(command);
  if(String(process.env.BYBIT_EXECUTION_ENABLED||'false').toLowerCase()!=='true'){
    return {executed:false,dryRun:true,status:'EXECUTION_DISABLED',decisionId:command.decisionId};
  }

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  if(signal){
    if(signal.aborted) controller.abort();
    else signal.addEventListener('abort',()=>controller.abort(),{once:true});
  }

  try{
    let body;
    const side=command.side?normalizeSide(command.side):null;
    const orderType=command.orderType||'Market';

    if(command.action==='OPEN'){
      body={
        category:CATEGORY,
        symbol:SYMBOL,
        side,
        orderType,
        qty:String(assertFinitePositive(command.qty,'qty')),
        positionIdx:Number(command.positionIdx??0),
        orderLinkId:String(command.decisionId).slice(0,36)
      };
      if(orderType==='Limit'){
        body.price=String(assertFinitePositive(command.price,'price'));
        body.timeInForce=command.timeInForce||'GTC';
      }else{
        body.timeInForce='IOC';
      }
      if(command.takeProfit!=null){
        body.takeProfit=String(assertFinitePositive(command.takeProfit,'takeProfit'));
        body.tpOrderType='Market';
        body.tpTriggerBy=command.tpTriggerBy||'MarkPrice';
      }
      if(command.stopLoss!=null){
        body.stopLoss=String(assertFinitePositive(command.stopLoss,'stopLoss'));
        body.slOrderType='Market';
        body.slTriggerBy=command.slTriggerBy||'MarkPrice';
      }
      if(command.takeProfit!=null || command.stopLoss!=null) body.tpslMode='Full';
    }else if(command.action==='CLOSE'||command.action==='REDUCE'){
      const positionSide=command.positionSide;
      if(!['Buy','Sell'].includes(positionSide)) throw new Error('CLOSE/REDUCE requires positionSide=Buy/Sell');
      body={
        category:CATEGORY,
        symbol:SYMBOL,
        side:positionSide==='Buy'?'Sell':'Buy',
        orderType:'Market',
        qty:String(command.qty||'0'),
        positionIdx:Number(command.positionIdx??0),
        reduceOnly:true,
        closeOnTrigger:true,
        orderLinkId:String(command.decisionId).slice(0,36)
      };
      if(command.qty==null) body.qty='0';
    }else if(command.action==='CANCEL'){
      body={category:CATEGORY,symbol:SYMBOL};
      if(command.orderId) body.orderId=String(command.orderId);
      else if(command.orderLinkId) body.orderLinkId=String(command.orderLinkId);
      else throw new Error('CANCEL requires orderId or orderLinkId');
    }else if(command.action==='AMEND'){
      body={category:CATEGORY,symbol:SYMBOL};
      if(command.orderId) body.orderId=String(command.orderId);
      else if(command.orderLinkId) body.orderLinkId=String(command.orderLinkId);
      else throw new Error('AMEND requires orderId or orderLinkId');
      for(const [k,n] of [['qty','qty'],['price','price'],['takeProfit','takeProfit'],['stopLoss','stopLoss']]){
        if(command[k]!=null) body[k]=String(assertFinitePositive(command[k],n));
      }
    }

    const data=await privatePost(
      command.action==='CANCEL'?'/v5/order/cancel':
      command.action==='AMEND'?'/v5/order/amend':'/v5/order/create',
      body,
      controller.signal
    );
    return {
      executed:true,
      dryRun:false,
      status:'ACCEPTED',
      decisionId:command.decisionId,
      action:command.action,
      symbol:SYMBOL,
      orderId:data?.result?.orderId||null,
      orderLinkId:data?.result?.orderLinkId||body.orderLinkId||null,
      rawStatus:data?.retMsg||'OK'
    };
  }finally{
    clearTimeout(timer);
  }
}

export const executionCapabilities={
  open:true,
  close:true,
  reduce:true,
  cancel:true,
  amend:true,
  leverage:false,
  withdrawal:false
};
