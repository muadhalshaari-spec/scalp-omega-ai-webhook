export const maxDuration = 60;

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const base=`https://${req.headers.host}`;
  try{
    const r=await fetch(`${base}/api/institutional?audit=${Date.now()}`,{headers:{Accept:'application/json'},cache:'no-store'});
    const body=await r.text();
    let data=null;try{data=JSON.parse(body)}catch{}
    if(!r.ok||!data?.ok)return res.status(502).json({ok:false,stage:'INSTITUTIONAL',error:data?.error||body.slice(0,500)});
    const t=data.institutional?.titan;
    const outputs=t?.outputs||{};
    const traces=Array.isArray(t?.traces)?t.traces:[];
    const moduleContractCoverage=traces.map((trace)=>{
      const out=outputs[trace.id]||{};
      return {
        id:trace.id,status:trace.status,direction:trace.direction,score:trace.score,
        confidence:trace.confidence,blockers:trace.blockers||[],
        inputs:out.contract?.inputs||[],outputs:out.contract?.outputs||[],
        errors:out.diagnostics?.errors||[],warnings:out.diagnostics?.warnings||[],
        lookaheadSafe:out.provenance?.lookaheadSafe??null
      };
    });
    const missing=moduleContractCoverage.filter(x=>x.blockers.some(b=>String(b).startsWith('MISSING_INPUTS')));
    const errors=moduleContractCoverage.filter(x=>x.errors.length>0);
    const blocked=moduleContractCoverage.filter(x=>x.status==='BLOCKED');
    return res.status(200).json({
      ok:true,engine:'SCALP-Ω TITAN 55 Audit',
      fetchedAt:data.fetchedAt||new Date().toISOString(),
      decision:t?.decision||'NO_TRADE',
      architecture:{
        total:55,
        executed:traces.length,
        healthy:moduleContractCoverage.filter(x=>x.status!=='BLOCKED'&&x.errors.length===0).length,
        blocked:blocked.length,
        withMissingInputs:missing.length,
        withRuntimeErrors:errors.length,
        allLookaheadSafe:moduleContractCoverage.every(x=>x.lookaheadSafe!==false)
      },
      moduleContractCoverage,
      summary:t?.summary||null,
      blockers:t?.blockers||[],
      research:{
        analog:T('TITAN-13'),walkForward:T('TITAN-31'),pbo:T('TITAN-32'),
        calibration:T('TITAN-11'),dataset:T('TITAN-33'),drift:T('TITAN-30')
      }
    });

    function T(id){
      const x=outputs[id];
      return x?{status:x.state?.status,direction:x.state?.direction,score:x.state?.score,confidence:x.state?.confidence,result:x.result?.metrics||null,blockers:x.state?.blockers||[]} : null;
    }
  }catch(e){return res.status(502).json({ok:false,error:e?.message||String(e)})}
}
