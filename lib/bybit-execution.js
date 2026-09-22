import crypto from 'crypto';
import { getBybitPrivateAccount, getBybitOrderHistory } from './bybit-private.js';
import { executionStoreConfigured, getExecutionAudit, insertExecutionAudit, updateExecutionAudit, getExecutionGuard } from './bybit-execution-store.js';

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

function activePosition(account){
  const p=account?.position;
  return p && Number(p.size||0)!==0 ? p : null;
}

function sanitizeCommand(command){
  return JSON.parse(JSON.stringify(command||{}));
}

function validateCommand(command){
  if(!command || command.authority!=='CHATGPT') throw new Error('Execution requires authority=CHATGPT');
  if(!command.decisionId) throw new Error('decisionId is required');
  if(!/^[A-Za-z0-9_-]{1,36}$/.test(String(command.decisionId))) throw new Error('decisionId must be 1-36 chars using letters, numbers, dash, or underscore');
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
    assertFinitePositive(command.leverage,'leverage');
    if(orderType==='Limit') assertFinitePositive(command.price,'price');
    else assertFinitePositive(command.referencePrice,'referencePrice');
    if(command.takeProfit!=null) assertFinitePositive(command.takeProfit,'takeProfit');
    if(command.stopLoss!=null) assertFinitePositive(command.stopLoss,'stopLoss');
    const entry=orderType==='Limit'?Number(command.price):Number(command.referencePrice);
    const tp=command.takeProfit==null?null:Number(command.takeProfit);
    const sl=command.stopLoss==null?null:Number(command.stopLoss);
    const isLong=['LONG','BUY'].includes(String(command.side).toUpperCase());
    if(tp!=null && ((isLong && tp<=entry) || (!isLong && tp>=entry))) throw new Error('takeProfit is on the wrong side of entry');
    if(sl!=null && ((isLong && sl>=entry) || (!isLong && sl<=entry))) throw new Error('stopLoss is on the wrong side of entry');
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
    if(!['qty','price','takeProfit','stopLoss'].some(k=>command[k]!=null)) throw new Error('AMEND requires qty, price, takeProfit, or stopLoss');
  }
}

function buildBody(command){
  const side=command.side?normalizeSide(command.side):null;
  const orderType=command.orderType||'Market';

  if(command.action==='SET_LEVERAGE'){
    return {
      category:CATEGORY,
      symbol:SYMBOL,
      buyLeverage:String(command.leverage),
      sellLeverage:String(command.leverage)
    };
  }

  if(command.action==='OPEN'){
    const body={
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
    return body;
  }

  if(command.action==='CLOSE'||command.action==='REDUCE'){
    const positionSide=command.positionSide;
    return {
      category:CATEGORY,
      symbol:SYMBOL,
      side:positionSide==='Buy'?'Sell':'Buy',
      orderType:'Market',
      qty:command.qty==null?'0':String(assertFinitePositive(command.qty,'qty')),
      positionIdx:Number(command.positionIdx??0),
      reduceOnly:true,
      closeOnTrigger:command.action==='CLOSE',
      orderLinkId:String(command.decisionId).slice(0,36)
    };
  }

  if(command.action==='CANCEL'){
    return {
      category:CATEGORY,
      symbol:SYMBOL,
      ...(command.orderId?{orderId:String(command.orderId)}:{orderLinkId:String(command.orderLinkId)})
    };
  }

  if(command.action==='AMEND'){
    const body={
      category:CATEGORY,
      symbol:SYMBOL,
      ...(command.orderId?{orderId:String(command.orderId)}:{orderLinkId:String(command.orderLinkId)})
    };
    for(const [k,n] of [['qty','qty'],['price','price'],['takeProfit','takeProfit'],['stopLoss','stopLoss']]){
      if(command[k]!=null) body[k]=String(assertFinitePositive(command[k],n));
    }
    return body;
  }

  throw new Error('Unsupported action');
}

function endpointFor(action){
  if(action==='SET_LEVERAGE') return '/v5/position/set-leverage';
  if(action==='CANCEL') return '/v5/order/cancel';
  if(action==='AMEND') return '/v5/order/amend';
  return '/v5/order/create';
}

async function wait(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

async function verifyExecution(command, providerResult, preState){
  const orderId=providerResult?.orderId||null;
  const orderLinkId=providerResult?.orderLinkId||String(command.decisionId).slice(0,36);
  let last={account:null,history:[],verified:false,reason:'NOT_CHECKED'};

  for(const delay of [250,500,1000]){
    await wait(delay);
    const [account,history] = await Promise.all([
      getBybitPrivateAccount(),
      getBybitOrderHistory({orderId:orderId||undefined,orderLinkId:orderLinkId||undefined,limit:10})
    ]);
    last={account,history:history.orders||[],verified:false,reason:'PENDING'};
    const post=account;
    const prePos=activePosition(preState);
    const postPos=activePosition(post);
    const h=(history.orders||[]).find(o=>(orderId&&o.orderId===orderId)||(orderLinkId&&o.orderLinkId===orderLinkId)) || null;
    last.order=h;

    if(command.action==='OPEN'){
      if(command.orderType==='Limit'){
        const active=(post.openOrders?.items||[]).some(o=>o.orderId===orderId||o.orderLinkId===orderLinkId);
        const terminal=['New','PartiallyFilled','Filled','Untriggered','Triggered'];
        last.verified=Boolean(active||(h&&terminal.includes(h.orderStatus)));
        last.reason=last.verified?'ORDER_CONFIRMED':'ORDER_NOT_CONFIRMED';
      }else{
        const filled=h?.orderStatus==='Filled' || h?.orderStatus==='PartiallyFilled';
        const positionGrew=!prePos && Boolean(postPos) || Boolean(prePos&&postPos&&Number(postPos.size)>Number(prePos.size));
        last.verified=Boolean(filled||positionGrew);
        last.reason=last.verified?'FILL_OR_POSITION_CONFIRMED':'FILL_NOT_CONFIRMED';
      }
    }else if(command.action==='CLOSE'||command.action==='REDUCE'){
      const before=Number(prePos?.size||0);
      const after=Number(postPos?.size||0);
      last.verified=after<before;
      last.reason=last.verified?'POSITION_REDUCED':'POSITION_NOT_REDUCED';
    }else if(command.action==='CANCEL'){
      last.verified=h?.orderStatus==='Cancelled';
      last.reason=last.verified?'CANCEL_CONFIRMED':'CANCEL_NOT_CONFIRMED';
    }else if(command.action==='AMEND'){
      const match=(post.openOrders?.items||[]).find(o=>o.orderId===orderId||o.orderLinkId===orderLinkId) || h;
      const checks=[];
      for(const k of ['qty','price','takeProfit','stopLoss']){
        if(command[k]!=null) checks.push(String(match?.[k])===String(command[k]));
      }
      last.verified=Boolean(match)&&checks.length>0&&checks.every(Boolean);
      last.reason=last.verified?'AMEND_CONFIRMED':'AMEND_NOT_CONFIRMED';
    }else if(command.action==='SET_LEVERAGE'){
      last.verified=postPos ? Number(postPos.leverage)===Number(command.leverage) : true;
      last.reason=postPos?'LEVERAGE_CONFIRMED':'NO_ACTIVE_POSITION_TO_VERIFY';
    }

    if(last.verified) return { ...last, postState:post };
  }

  return { ...last, postState:last.account };
}

function riskCheck(command, guard, account){
  const checks={guardLoaded:true,guardConfig:true,envEnabled:false,killSwitchClear:false,guardEnabled:false,withinMaxLeverage:true,availableBalance:true,positionState:true,notional:true};
  if(Number(guard.max_leverage)<1 || Number(guard.max_leverage)>100 || Number(guard.max_equity_pct)<=0 || Number(guard.max_equity_pct)>1 || Number(guard.min_available_usdt)<0 || (guard.max_notional_usdt!=null && Number(guard.max_notional_usdt)<=0)){
    checks.guardConfig=false;
    return {allowed:false,checks,reasons:['INVALID_GUARD_CONFIG']};
  }
  const reasons=[];

  checks.envEnabled=String(process.env.BYBIT_EXECUTION_ENABLED||'false').toLowerCase()==='true';
  if(!checks.envEnabled) reasons.push('ENV_EXECUTION_DISABLED');

  checks.killSwitchClear=guard.kill_switch===false;
  if(!checks.killSwitchClear) reasons.push('KILL_SWITCH_ACTIVE');

  checks.guardEnabled=guard.enabled===true;
  if(!checks.guardEnabled) reasons.push('GUARD_DISABLED');

  if(command.action==='SET_LEVERAGE'){
    checks.withinMaxLeverage=Number(command.leverage)<=Number(guard.max_leverage);
    if(!checks.withinMaxLeverage) reasons.push('MAX_LEVERAGE');
    return {allowed:reasons.length===0,checks,reasons};
  }

  const available=Number(account?.wallet?.totalAvailableBalance);
  checks.availableBalance=Number.isFinite(available)&&available>=Number(guard.min_available_usdt);
  if(!checks.availableBalance) reasons.push('INSUFFICIENT_AVAILABLE_BALANCE');

  const pos=activePosition(account);
  if(command.action==='OPEN'){
    checks.positionState=!pos && Number(account?.openOrders?.count||0)===0;
    if(!checks.positionState) reasons.push('EXISTING_POSITION_OR_OPEN_ORDER');

    const price=command.orderType==='Limit'?Number(command.price):Number(command.referencePrice);
    const notional=Number(command.qty)*price;
    const equity=Number(account?.wallet?.totalEquity);
    const equityCap=Number.isFinite(equity)&&equity>0 ? equity*Number(guard.max_equity_pct) : 0;
    const absoluteCap=guard.max_notional_usdt==null ? Infinity : Number(guard.max_notional_usdt);
    const cap=Math.min(absoluteCap,equityCap||Infinity);
    checks.notional=Number.isFinite(notional)&&notional>0&&notional<=cap;
    if(!checks.notional) reasons.push('MAX_NOTIONAL');

    checks.withinMaxLeverage=Number(command.leverage)<=Number(guard.max_leverage);
    if(!checks.withinMaxLeverage) reasons.push('MAX_LEVERAGE');
  }else if(command.action==='CLOSE'||command.action==='REDUCE'){
    checks.positionState=Boolean(pos)&&pos.side===command.positionSide;
    if(!checks.positionState) reasons.push('POSITION_MISMATCH');
    if(command.action==='REDUCE'&&Boolean(pos)&&Number(command.qty)>Number(pos.size)) reasons.push('REDUCE_QTY_GT_POSITION');
  }else if(command.action==='CANCEL'||command.action==='AMEND'){
    const id=command.orderId||command.orderLinkId;
    const found=(account?.openOrders?.items||[]).some(o=>o.orderId===id||o.orderLinkId===id);
    checks.positionState=found;
    if(!found) reasons.push('TARGET_ORDER_NOT_OPEN');
  }

  return {allowed:reasons.length===0,checks,reasons};
}

export async function executeBybitCommand(command,{signal}={}){
  validateCommand(command);

  const existing=executionStoreConfigured()?await getExecutionAudit(command.decisionId):null;
  if(existing){
    return {executed:false,dryRun:existing.status==='DRY_RUN',status:'IDEMPOTENT_REPLAY',decisionId:command.decisionId,existing};
  }

  const executionEnabled=String(process.env.BYBIT_EXECUTION_ENABLED||'false').toLowerCase()==='true';
  if(!executionEnabled){
    if(executionStoreConfigured()){
      try{
        await insertExecutionAudit({
          decision_id:String(command.decisionId),
          action:String(command.action),
          symbol:SYMBOL,
          status:'DRY_RUN',
          command:sanitizeCommand(command),
          risk_checks:{envEnabled:false},
          created_at:new Date().toISOString(),
          completed_at:new Date().toISOString()
        });
      }catch(e){}
    }
    return {executed:false,dryRun:true,status:'EXECUTION_DISABLED',decisionId:command.decisionId};
  }

  if(!executionStoreConfigured()) throw new Error('Execution requires Supabase audit store');

  const guard=await getExecutionGuard();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  if(signal){
    if(signal.aborted) controller.abort();
    else signal.addEventListener('abort',()=>controller.abort(),{once:true});
  }

  let preState=null;
  let auditInserted=false;
  const startedAt=new Date().toISOString();

  try{
    try{
      await insertExecutionAudit({
        decision_id:String(command.decisionId),
        action:String(command.action),
        symbol:SYMBOL,
        status:'PENDING',
        command:sanitizeCommand(command),
        risk_checks:{guard},
        created_at:startedAt
      });
      auditInserted=true;
    }catch(e){
      const replay=await getExecutionAudit(command.decisionId);
      if(replay) return {executed:false,dryRun:false,status:'IDEMPOTENT_REPLAY',decisionId:command.decisionId,existing:replay};
      throw e;
    }

    preState=await getBybitPrivateAccount({signal:controller.signal});
    const risk=riskCheck(command,guard,preState);
    if(!risk.allowed){
      await updateExecutionAudit(command.decisionId,{
        status:'BLOCKED_RISK',
        pre_state:preState,
        risk_checks:risk,
        completed_at:new Date().toISOString()
      });
      return {executed:false,dryRun:false,status:'BLOCKED_RISK',decisionId:command.decisionId,risk,account:preState};
    }

    const body=buildBody(command);
    const data=await privatePost(endpointFor(command.action),body,controller.signal);
    const providerResult={
      retMsg:data?.retMsg||'OK',
      orderId:data?.result?.orderId||null,
      orderLinkId:data?.result?.orderLinkId||body.orderLinkId||null
    };

    const verification=await verifyExecution(command,providerResult,preState);
    const status=verification.verified?'VERIFIED':'ACCEPTED_UNVERIFIED';
    const output={
      executed:true,
      dryRun:false,
      status,
      decisionId:command.decisionId,
      action:command.action,
      symbol:SYMBOL,
      orderId:providerResult.orderId,
      orderLinkId:providerResult.orderLinkId,
      verification:{verified:verification.verified,reason:verification.reason},
      postState:verification.postState||null
    };

    await updateExecutionAudit(command.decisionId,{
      status,
      provider_result:providerResult,
      post_state:verification.postState||null,
      verification,
      completed_at:new Date().toISOString()
    });

    return output;
  }catch(e){
    if(auditInserted){
      await updateExecutionAudit(command.decisionId,{
        status:'ERROR',
        pre_state:preState,
        error:e?.message||String(e),
        completed_at:new Date().toISOString()
      }).catch(()=>{});
    }
    throw e;
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
