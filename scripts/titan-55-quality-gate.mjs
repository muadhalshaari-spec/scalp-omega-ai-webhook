import fs from "node:fs";
import path from "node:path";
const dir=path.resolve("lib/titan");
const files=fs.readdirSync(dir).filter(f=>/^\d{2}_.+\.js$/.test(f)).sort();
if(files.length!==55)throw new Error("EXPECTED_55_MODULE_FILES_GOT_"+files.length);
const keywordSets={
"01":["decision","probability","risk","trade"],"02":["setup","trend","liquidity","trigger"],"03":["layer","micro","momentum","confirmation"],
"04":["slippage","impact","spread","fill"],"05":["limit","fillProbability","expiry","distance"],"06":["breakout","falseBreak","volume","trigger"],
"07":["stopLoss","structural","buffer","volatility"],"08":["targets","rr","liquidity","extension"],"09":["probability","uncertainty","ensemble","regime"],
"10":["metaProbability","logistic","outcomes","feature"],"11":["isotonic","brier","ece","calibr"],"12":["expectedValue","kelly","rr","risk"],
"13":["analogs","similarity","distance","temporal"],"14":["UPTREND","DOWNTREND","volatility","environment"],"15":["session","UTC","overlap","openingRange"],
"16":["event","funding","riskLevel","window"],"17":["quality","freshness","duplicates","coverage"],"18":["exchanges","medianPrice","funding","dispersion"],
"19":["divergence","correlation","spreadZ","leadLag"],"20":["openInterest","fundingRate","taker","crowding"],"21":["options","skew","IV","strike"],
"22":["liquidation","clusters","cascade","pressure"],"23":["microprice","aggression","vpin","depth"],"24":["sequence","heartbeat","reconnect","gap"],
"25":["RSI","VWAP","EMA","ATR"],"26":["ensemble","weights","correlation","agreement"],"27":["utility","candidate","capacity","correlation"],
"28":["quality","subscores","weakLinks","grade"],"29":["taxonomy","primaryCause","secondaryCauses","loss"],"30":["PSI","drift","performance","reference"],
"31":["walk","out-of-sample","profitFactor","sharpe"],"32":["CSCV","PBO","logit","oosRank"],"33":["deduplicated","labels","ordering","horizon"],
"34":["asOf","aligned","coverage","MISSING"],"35":["fills","equity","idempotency","risk"],"36":["sameBar","limitFill","stopSlippage","MAE"],
"37":["trailing","breakeven","timeStop","target"],"38":["cancelled","expiry","stale","conflict"],"39":["KILL_SWITCH","drawdown","errorRate","resume"],
"40":["webhook","auth","idempotency","replay"],"41":["dedupe","backoff","deadLetter","attempt"],"42":["CAS","version","ttl","lock"],
"43":["CREATE TABLE","PRIMARY KEY","schemaHash","migration"],"44":["journal","lifecycle","counterfactual","learningRows"],
"45":["AUDIT","evidence","nonInvention","verdict"],"46":["schema","allowedValues","probability","noOverride"],
"47":["jobId","retry","timeout","idempotency"],"48":["cases","coverage","lookahead","schema"],"49":["releaseReady","security","deployment","tests"],
"50":["deployment","requiredEnv","routes","health"],"51":["repairPlan","CI_FAILURE","integrity","safeActions"],
"52":["p95","errorRate","freshness","alerts"],"53":["moduleDocs","dataFlow","runbook","schemas"],
"54":["blockers","evidence","readiness","production"],"55":["statusMatrix","implemented","integrated","tested"]
};
const forbidden=["TODO","NOT_IMPLEMENTED","placeholder","throw new Error('not implemented')"];
for(const f of files){const s=fs.readFileSync(path.join(dir,f),"utf8");const n=f.slice(0,2);const miss=(keywordSets[n]||[]).filter(k=>!s.toLowerCase().includes(k.toLowerCase()));if(miss.length>2)throw new Error("DOMAIN_DEPTH_FAIL_"+f+"_"+miss.join(","));for(const bad of forbidden)if(s.toLowerCase().includes(bad.toLowerCase()))throw new Error("PLACEHOLDER_FAIL_"+f);if(!s.includes("export const MODULE")||!s.includes("export function evaluate")||!s.includes("export function selfTest"))throw new Error("CONTRACT_FAIL_"+f)}
const idx=await import("../lib/titan/index.js");
if(!Array.isArray(idx.TITAN_MODULES)||idx.TITAN_MODULES.length!==55)throw new Error("REGISTRY_FAIL");
const ids=new Set(idx.TITAN_MODULES.map(m=>m.MODULE.id));if(ids.size!==55)throw new Error("DUPLICATE_IDS");
const visiting=new Set(),visited=new Set(),deps=idx.DEPENDENCIES;
function dfs(id){if(visiting.has(id))throw new Error("DEPENDENCY_CYCLE_"+id);if(visited.has(id))return;visiting.add(id);for(const d of deps[id]||[])if(!ids.has(d))throw new Error("UNKNOWN_DEPENDENCY_"+id+"_"+d);else dfs(d);visiting.delete(id);visited.add(id)}
ids.forEach(dfs);
const self=idx.titanSelfTest();if(!self.passed||self.reports.length!==55)throw new Error("SELF_TEST_GATE_FAILED");
console.log(JSON.stringify({ok:true,moduleCount:files.length,registry:idx.TITAN_MODULES.length,selfTests:self.reports.length,dependencyNodes:visited.size}));
