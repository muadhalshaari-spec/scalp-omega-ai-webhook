const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function baseUrl(){
  return (rawUrl || '').replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

function headers(extra={}){
  return { apikey:key, Authorization:'Bearer '+key, ...extra };
}

export function executionStoreConfigured(){
  return Boolean(baseUrl() && key);
}

async function request(path, init={}){
  const base=baseUrl();
  if(!base || !key) return {configured:false,data:null};
  const response=await fetch(base+'/rest/v1/'+path,{...init,headers:headers(init.headers||{}),cache:'no-store'});
  const text=await response.text();
  let data=null;
  try{data=JSON.parse(text)}catch{}
  if(!response.ok) throw new Error('Supabase execution store HTTP '+response.status+': '+text.slice(0,500));
  return {configured:true,data};
}

export async function getExecutionAudit(decisionId){
  if(!decisionId) return null;
  const q=new URLSearchParams({select:'*',decision_id:'eq.'+String(decisionId),limit:'1'});
  const result=await request('bybit_execution_audit?'+q.toString(),{headers:{Accept:'application/json'}});
  return Array.isArray(result.data) ? (result.data[0]||null) : null;
}

export async function insertExecutionAudit(row){
  const result=await request('bybit_execution_audit',{
    method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:JSON.stringify(row)
  });
  return Array.isArray(result.data) ? (result.data[0]||row) : row;
}

export async function updateExecutionAudit(decisionId,patch){
  const q=new URLSearchParams({decision_id:'eq.'+String(decisionId)});
  const result=await request('bybit_execution_audit?'+q.toString(),{
    method:'PATCH',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:JSON.stringify(patch)
  });
  return Array.isArray(result.data) ? (result.data[0]||patch) : patch;
}

export async function getExecutionGuard(){
  const result=await request('bybit_execution_guard?select=*&id=eq.true&limit=1',{headers:{Accept:'application/json'}});
  const row=Array.isArray(result.data) ? (result.data[0]||null) : null;
  if(!row) throw new Error('Execution guard row is missing');
  return row;
}
