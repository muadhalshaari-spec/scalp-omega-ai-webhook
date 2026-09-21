import {runEngine} from "./kernel.js";

export const MODULE=Object.freeze({
  id:"TITAN-46",
  slug:"decision-contract",
  title:"Deterministic Decision Contract",
  version:"1.0.0",
  modes:["LIVE","PAPER","BACKTEST","RESEARCH","AUDIT"],
  inputs:["decision","probability","risk","evidence"],
  outputs:["schema","constraints","allowedValues","validation"],
  gates:["json","ranges","noOverride"],
  lifecycle:["OBSERVE","NORMALIZE","DERIVE","GATE","DECIDE","AUDIT"],
  invariants:["no lookahead","domain-specific math","fail closed","traceable evidence"]
});

function derive(input={}){
  const allowed={direction:["LONG","SHORT","NO_TRADE"],entryMode:["MARKET","LIMIT","STOP","NONE"]};
  const d=input.decision||{};
  const p=input.probability?.probability??input.probability;
  const validDir=d.direction==null||allowed.direction.includes(d.direction);
  const validP=p==null||Number.isFinite(Number(p))&&Number(p)>=0&&Number(p)<=1;
  const valid=validDir&&validP;
  return {
    status:valid?"READY":"REJECT",
    direction:d.direction??"NO_TRADE",
    score:valid?.98:.02,
    confidence:valid?.999:0,
    signals:[valid?"DECISION_SCHEMA_VALID":"DECISION_SCHEMA_INVALID"],
    gates:{json:valid,ranges:validP,noOverride:true},
    metrics:{decisionKeys:Object.keys(d).length,evidenceKeys:Object.keys(input.evidence||{}).length},
    schema:{type:"object",required:["direction"],properties:{direction:{enum:allowed.direction},probability:{minimum:0,maximum:1}}},
    constraints:{deterministicOverride:false,priceInvention:false},
    allowedValues:allowed,
    validation:{valid,errors:[!validDir&&"DIRECTION",!validP&&"PROBABILITY"].filter(Boolean)}
  };
}
export function evaluate(input={}){return runEngine({module:MODULE,input,derive});}
export function selfTest(){
  const t=1700000000000;
  const a=evaluate({mode:"RESEARCH",timestamp:t,decisionTimestamp:t,sourceTimestamp:t-1,decision:{direction:"NO_TRADE"}});
  const b=evaluate({mode:"RESEARCH",timestamp:t,decisionTimestamp:t,sourceTimestamp:t+1,decision:{direction:"NO_TRADE"}});
  return {module:MODULE.id,passed:a.provenance.lookaheadSafe&&b.diagnostics.errors.includes("LOOKAHEAD_VIOLATION")};
}
export default evaluate;
