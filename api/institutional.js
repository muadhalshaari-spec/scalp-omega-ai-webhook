export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({ok:false});
 const tests=[
  ['quant-core',()=>import('../lib/quant-core.js')],
  ['data-intelligence',()=>import('../lib/data-intelligence.js')],
  ['market-structure',()=>import('../lib/market-structure-engine.js')],
  ['liquidity',()=>import('../lib/liquidity-engine.js')],
  ['microstructure',()=>import('../lib/microstructure-engine.js')],
  ['derivatives',()=>import('../lib/derivatives-engine.js')],
  ['regime',()=>import('../lib/regime-engine.js')],
  ['setups',()=>import('../lib/setup-engine.js')],
  ['sequence',()=>import('../lib/sequence-engine.js')],
  ['zones',()=>import('../lib/zone-engine.js')],
  ['adaptive-risk',()=>import('../lib/adaptive-risk-engine.js')],
  ['excursion',()=>import('../lib/excursion-engine.js')],
  ['meta-label',()=>import('../lib/meta-label-engine.js')],
  ['calibration',()=>import('../lib/calibration-engine.js')],
  ['walkforward',()=>import('../lib/walkforward-engine.js')],
  ['overfitting',()=>import('../lib/overfitting-engine.js')],
  ['execution',()=>import('../lib/execution-simulator.js')],
  ['session',()=>import('../lib/session-engine.js')],
  ['event-risk',()=>import('../lib/event-risk-engine.js')],
  ['journal',()=>import('../lib/journal-engine.js')],
  ['counterfactual',()=>import('../lib/counterfactual-engine.js')],
  ['ensemble',()=>import('../lib/ensemble-engine.js')],
  ['threshold',()=>import('../lib/threshold-engine.js')],
  ['probability',()=>import('../lib/probability-engine.js')],
  ['institutional-engine',()=>import('../lib/institutional-engine.js')]
 ];
 const results=[];
 for(const [name,fn] of tests){
  try{const mod=await fn();results.push({name,ok:true,exports:Object.keys(mod)})}
  catch(e){results.push({name,ok:false,errorName:e?.name||'Error',message:e?.message||String(e),stack:e?.stack||null});break}
 }
 return res.status(results.at(-1)?.ok?200:500).json({ok:results.every(x=>x.ok),results});
}