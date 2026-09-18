import{clamp,mean,safeDiv}from'./quant-core.js';
import{calibratedProbability}from'./calibration-engine.js';

function betaUncertainty(p,n){
  const N=Math.max(0,Number(n)||0);
  if(N<1)return .25;
  const variance=(p*(1-p))/(N+3);
  return Math.min(.25,1.96*Math.sqrt(Math.max(0,variance)));
}

export function buildProbability({ensemble,calibration,thresholds,setupQuality=.5,sequenceQuality=.5,analog=null,metaProbability=.5}={}){
  const direction=ensemble.longProbability>=ensemble.shortProbability?'LONG':'SHORT';
  const raw=direction==='LONG'?ensemble.longProbability:ensemble.shortProbability;
  const modelEvidence=clamp(mean([raw,metaProbability,setupQuality,sequenceQuality])??.5,.01,.99);
  const calibrated=calibration?.ready?calibratedProbability(modelEvidence,calibration):null;
  const analogP=analog?.bayesianProbability;
  const probability=calibrated!=null?calibrated:(analogP!=null?clamp(.7*modelEvidence+.3*analogP,.01,.99):modelEvidence);
  const sampleSize=calibration?.sampleSize||analog?.count||0;
  const uncertainty=calibration?.ready
    ? betaUncertainty(probability,calibration.sampleSize)
    : Math.min(.25,.18+0.04*Math.max(0,1-Math.min(1,sampleSize/50)));
  const threshold=thresholds?.[direction==='LONG'?'long':'short']??.72;
  return{
    direction,rawProbability:raw,modelEvidence,
    calibratedProbability:calibrated,
    probability,
    probabilityKind:calibrated!=null?'CALIBRATED':'MODEL_ESTIMATE',
    calibrationReady:Boolean(calibration?.ready),
    sampleSize,
    uncertainty,
    threshold,
    edge:ensemble.edge,
    quality:mean([setupQuality,sequenceQuality,ensemble.edge])??.5,
    analogContribution:analogP!=null?analogP:null,
    note:calibrated!=null?'Probability is derived from resolved historical outcomes and calibration.':'Probability is not yet calibrated; do not interpret it as a validated win probability.'
  };
}
