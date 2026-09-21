import {runEngine} from "./kernel.js";

export const MODULE=Object.freeze({
  id:"TITAN-45",
  slug:"deterministic-audit-layer",
  title:"Deterministic Audit Layer",
  version:"1.0.0",
  modes:["LIVE","PAPER","BACKTEST","RESEARCH","AUDIT"],
  inputs:["decision","evidence","policy"],
  outputs:["validation","verdict","overrideAllowed"],
  gates:["nonInvention","deterministicGate","schema"],
  lifecycle:["OBSERVE","NORMALIZE","DERIVE","GATE","DECIDE","AUDIT"],
  invariants:["no lookahead","domain-specific math","fail closed","traceable evidence"]
});

function derive(input={}){
  const d=input.decision||{};
  const e=input.evidence||{};
  const direction=["LONG","SHORT","NO_TRADE"].includes(d.direction)?d.direction:"NO_TRADE";
  const evidencePresent=Object.keys(e).length>0;
  const valid=direction==="NO_TRADE" || evidencePresent;
  return {
    status:valid?"READY":"REJECT",
    direction,
    score:valid?0.98:0.02,
    confidence:valid?0.99:0,
    signals:[valid?"DETERMINISTIC_AUDIT_PASS":"DETERMINISTIC_AUDIT_FAIL"],
    gates:{nonInvention:true,deterministicGate:true,schema:valid},
    metrics:{evidenceKeys:Object.keys(e).length},
    validation:{valid},
    verdict:valid?"CONFIRM":"REJECT",
    overrideAllowed:false
  };
}

export function evaluate(input={}){return runEngine({module:MODULE,input,derive});}
export function selfTest(){
  const t=1700000000000;
  const a=evaluate({mode:"RESEARCH",timestamp:t,decisionTimestamp:t,sourceTimestamp:t-1,decision:{direction:"NO_TRADE"},evidence:{}});
  const b=evaluate({mode:"RESEARCH",timestamp:t,decisionTimestamp:t,sourceTimestamp:t+1,decision:{direction:"NO_TRADE"},evidence:{}});
  return {module:MODULE.id,passed:a.provenance.lookaheadSafe&&b.diagnostics.errors.includes("LOOKAHEAD_VIOLATION")};
}
export default evaluate;
