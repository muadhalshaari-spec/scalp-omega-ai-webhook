const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function baseUrl(){
  return rawUrl ? rawUrl.replace(/\/+$/,'').replace(/\/rest\/v1$/i,'') : '';
}

function headers(extra={}){
  return { apikey:key, Authorization:`Bearer ${key}`, ...extra };
}

export async function persistBybitAccountSnapshot(data){
  const base = baseUrl();
  if(!base || !key) return {configured:false,persisted:false,status:'NOT_CONFIGURED'};

  const w=data.wallet||{};
  const u=w.usdt||{};
  const row={
    event_ts:data.fetchedAt || new Date().toISOString(),
    source:'BYBIT_PRIVATE',
    environment:data.environment || null,
    account_type:data.accountType || 'UNIFIED',
    total_equity:w.totalEquity,
    total_wallet_balance:w.totalWalletBalance,
    total_margin_balance:w.totalMarginBalance,
    total_available_balance:w.totalAvailableBalance,
    total_perp_upl:w.totalPerpUPL,
    usdt_equity:u.equity,
    usdt_wallet_balance:u.walletBalance,
    usdt_unrealised_pnl:u.unrealisedPnl,
    position:data.position || null,
    open_orders:data.openOrders || null,
    capabilities:data.capabilities || null
  };

  const response=await fetch(base+'/rest/v1/bybit_account_snapshots',{
    method:'POST',
    headers:headers({'Content-Type':'application/json',Prefer:'return=minimal'}),
    body:JSON.stringify(row),
    cache:'no-store'
  });
  if(!response.ok){
    const text=await response.text();
    throw new Error('Supabase bybit_account_snapshots HTTP '+response.status+': '+text.slice(0,500));
  }
  return {configured:true,persisted:true,status:'PERSISTED',eventTs:row.event_ts};
}

export async function getLatestBybitAccountSnapshot(){
  const base=baseUrl();
  if(!base || !key) return {configured:false,row:null};
  const q=new URLSearchParams({
    select:'id,event_ts,source,environment,account_type,total_equity,total_wallet_balance,total_margin_balance,total_available_balance,total_perp_upl,usdt_equity,usdt_wallet_balance,usdt_unrealised_pnl,position,open_orders,capabilities,created_at',
    order:'event_ts.desc',
    limit:'1'
  });
  const response=await fetch(base+'/rest/v1/bybit_account_snapshots?'+q.toString(),{
    headers:headers({Accept:'application/json'}),
    cache:'no-store'
  });
  if(!response.ok) throw new Error('Supabase bybit_account_snapshots read HTTP '+response.status);
  const rows=await response.json();
  return {configured:true,row:Array.isArray(rows)?(rows[0]||null):null};
}
