import crypto from 'crypto';

const BASE = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
const API_KEY = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_API_SECRET;
const RECV_WINDOW = String(process.env.BYBIT_RECV_WINDOW || '5000');
const SYMBOL = 'ETHUSDT';

function requireCredentials(){
  if(!API_KEY || !API_SECRET) throw new Error('Bybit private API credentials are not configured');
}

function sign(timestamp, queryString=''){
  return crypto
    .createHmac('sha256', API_SECRET)
    .update(String(timestamp) + API_KEY + RECV_WINDOW + queryString)
    .digest('hex');
}

async function privateGet(path, params={}, signal){
  requireCredentials();
  const u = new URL(BASE + path);
  const entries = Object.entries(params).filter(([,v])=>v!==undefined && v!==null && v!=='');
  for(const [k,v] of entries) u.searchParams.set(k,String(v));
  const queryString = new URLSearchParams(entries.map(([k,v])=>[k,String(v)])).toString();
  const timestamp = Date.now();
  const response = await fetch(u, {
    method:'GET',
    headers:{
      Accept:'application/json',
      'User-Agent':'SCALP-Omega-Bybit-Private-Adapter/1.0',
      'X-BAPI-API-KEY':API_KEY,
      'X-BAPI-TIMESTAMP':String(timestamp),
      'X-BAPI-RECV-WINDOW':RECV_WINDOW,
      'X-BAPI-SIGN':sign(timestamp,queryString)
    },
    cache:'no-store',
    signal
  });
  const text = await response.text();
  let data=null;
  try{ data=JSON.parse(text); }catch{}
  if(!response.ok || data?.retCode!==0){
    throw new Error('Bybit private '+path+' HTTP '+response.status+': '+(data?.retMsg||text.slice(0,300)));
  }
  return data;
}

function safeNumber(v){ const n=Number(v); return Number.isFinite(n)?n:null; }

function linkAbortSignal(signal){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 12000);
  if(signal){
    if(signal.aborted) controller.abort();
    else signal.addEventListener('abort',()=>controller.abort(),{once:true});
  }
  return {controller,timer};
}

function normalizeOrder(o){
  if(!o) return null;
  return {
    orderId:o.orderId,
    orderLinkId:o.orderLinkId,
    symbol:o.symbol,
    side:o.side,
    orderType:o.orderType,
    qty:safeNumber(o.qty),
    leavesQty:safeNumber(o.leavesQty),
    cumExecQty:safeNumber(o.cumExecQty),
    avgPrice:safeNumber(o.avgPrice),
    price:safeNumber(o.price),
    triggerPrice:safeNumber(o.triggerPrice),
    orderStatus:o.orderStatus,
    reduceOnly:o.reduceOnly,
    closeOnTrigger:o.closeOnTrigger,
    takeProfit:safeNumber(o.takeProfit),
    stopLoss:safeNumber(o.stopLoss),
    updatedTime:o.updatedTime,
    createdTime:o.createdTime
  };
}

export async function getBybitPrivateAccount({signal}={}){
  const {controller,timer}=linkAbortSignal(signal);
  try{
    const [wallet, position, orders] = await Promise.all([
      privateGet('/v5/account/wallet-balance',{accountType:'UNIFIED',coin:'USDT'},controller.signal),
      privateGet('/v5/position/list',{category:'linear',symbol:SYMBOL},controller.signal),
      privateGet('/v5/order/realtime',{category:'linear',symbol:SYMBOL},controller.signal)
    ]);

    const w = wallet?.result?.list?.[0] || {};
    const usdt = (w.coin||[]).find(c=>c.coin==='USDT') || {};
    const positions = position?.result?.list || [];
    const activePosition = positions.find(p=>safeNumber(p.size)!==0) || positions[0] || null;
    const openOrders = orders?.result?.list || [];

    return {
      configured:true,
      available:true,
      source:'BYBIT_PRIVATE',
      environment:BASE.includes('testnet')?'testnet':'production',
      fetchedAt:new Date().toISOString(),
      accountType:w.accountType || 'UNIFIED',
      wallet:{
        totalEquity:safeNumber(w.totalEquity),
        totalWalletBalance:safeNumber(w.totalWalletBalance),
        totalMarginBalance:safeNumber(w.totalMarginBalance),
        totalAvailableBalance:safeNumber(w.totalAvailableBalance),
        totalPerpUPL:safeNumber(w.totalPerpUPL),
        usdt:{
          equity:safeNumber(usdt.equity),
          walletBalance:safeNumber(usdt.walletBalance),
          unrealisedPnl:safeNumber(usdt.unrealisedPnl),
          totalOrderIM:safeNumber(usdt.totalOrderIM),
          totalPositionIM:safeNumber(usdt.totalPositionIM),
          totalPositionMM:safeNumber(usdt.totalPositionMM)
        }
      },
      position:activePosition?{
        symbol:activePosition.symbol,
        side:activePosition.side,
        size:safeNumber(activePosition.size),
        avgPrice:safeNumber(activePosition.avgPrice),
        markPrice:safeNumber(activePosition.markPrice),
        positionValue:safeNumber(activePosition.positionValue),
        leverage:safeNumber(activePosition.leverage),
        unrealisedPnl:safeNumber(activePosition.unrealisedPnl),
        takeProfit:safeNumber(activePosition.takeProfit),
        stopLoss:safeNumber(activePosition.stopLoss),
        liquidationPrice:safeNumber(activePosition.liqPrice),
        tradeMode:activePosition.tradeMode,
        positionStatus:activePosition.positionStatus
      }:null,
      openOrders:{
        count:openOrders.length,
        items:openOrders.map(normalizeOrder)
      },
      capabilities:{
        readWallet:true,
        readPosition:true,
        readOpenOrders:true,
        readOrderHistory:true,
        orderExecutionEnabled:false,
        withdrawalEnabled:false
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getBybitOrderHistory({orderId,orderLinkId,startTime,endTime,limit=20,signal}={}){
  const {controller,timer}=linkAbortSignal(signal);
  try{
    const data=await privateGet('/v5/order/history',{
      category:'linear',
      symbol:SYMBOL,
      orderId:orderId||undefined,
      orderLinkId:orderLinkId||undefined,
      startTime:startTime||undefined,
      endTime:endTime||undefined,
      limit:Math.max(1,Math.min(50,Number(limit)||20))
    },controller.signal);
    const rows=data?.result?.list||[];
    return {
      configured:true,
      available:true,
      source:'BYBIT_PRIVATE',
      environment:BASE.includes('testnet')?'testnet':'production',
      orders:Array.isArray(rows)?rows.map(normalizeOrder):[]
    };
  } finally {
    clearTimeout(timer);
  }
}
