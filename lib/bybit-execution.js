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
  if(!['OPEN','CLOSE','REDUCE','CANCEL','AMEND','SET_LEVERAGE'].includes(command.action)) throw new Error('Unsupported action');
  if(command.symbol && command.symbol!==SYMBOL) throw new Error('Only ETHUSDT execution is enabled');

  if(command.action==='SET_LEVERAGE'){
    const leverage=Number(command.leverage);
    if(!Number.isFinite(leverage)||leverage<1||leverage>100) throw new Error('leverage must be between 1 and 100');
  }

  if(command.action==='OPEN'){
    const orderType=String(command.orderType||'Market');
    if(!['Market','Limit'].includes(orderType)) throw new Error('OPEN orderType must be Market or Limit');
    if(!['LONG','SHORT','BUY','SELL'].includes(String(command.side||'').toUpperCase())) throw new Error('OPEN requires side');
    assertFinitePositive(command.qty,'qty');
    if(orderType==='Limit') assertFinitePositive(command.price,'price');
  }

  if(command.action==='CLOSE'){
    if(!['Buy','Sell'].includes(command.positionSide)) throw new Error('CLOSE requires positionSide=Buy/Sell');
    if(command.qty!=null) assertFinitePositive(command.qty,'qty');
  }

  if(command.action==='REDUCE'){
    if(!['Buy','Sell'].includes(command.positionSide)) throw new Error('REDUCE requires positionSide=Buy/Sell');
    assertFinitePositive(command.qty,'qty');
  }

  if(command.action==='CANCEL'){
    if(!command.orderId && !command.orderLinkId) throw new Error('CANCEL requires orderId or orderLinkId');
  }

  if(command.action==='AMEND'){
    if(!command.orderId && !command.orderLinkId) throw new Error('AMEND requires orderId or orderLinkId');
    const amendable=['qty','price','takeProfit','stopLoss'];
    if(!amendable.some(k=>command[k]!=null)) throw new Error('AMEND requires qty, price, takeProfit, or stopLoss');
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

    if(command.action==='SET_LEVERAGE'){
      body={category:CATEGORY,symbol:SYMBOL,buyLeverage:String(command.leverage),sellLeverage:String(command.leverage)};
    }else if(command.action==='OPEN'){
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
      body={
        category:CATEGORY,
        symbol:SYMBOL,
        side:positionSide==='Buy'?'Sell':'Buy',
        orderType:'Market',
        qty:command.qty==null?'0':String(assertFinitePositive(command.qty,'qty')),
        positionIdx:Number(command.positionIdx??0),
        reduceOnly:true,
        closeOnTrigger: command.action==='CLOSE'
      };
      if(command.decisionId) body.orderLinkId=String(command.decisionId).slice(0,36);
    }else if(command.action==='CANCEL'){
      body={category:CATEGORY,symbol:SYMBOL};
      if(command.orderId) body.orderId=String(command.orderId);
      else body.orderLinkId=String(command.orderLinkId);
    }else if(command.action==='AMEND'){
      body={category:CATEGORY,symbol:SYMBOL};
      if(command.orderId) body.orderId=String(command.orderId);
      else body.orderLinkId=String(command.orderLinkId);
      for(const [k,n] of [['qty','qty'],['price','price'],['takeProfit','takeProfit'],['stopLoss','stopLoss']]){
        if(command[k]!=null) body[k]=String(assertFinitePositive(command[k],n));
      }
    }

    const data=await privatePost(
      command.action==='SET_LEVERAGE'?'/v5/position/set-leverage':
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
  leverage:true,
  withdrawal:false
};
