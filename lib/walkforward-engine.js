export function buildWalkForwardWindows(length,{trainBars=800,testBars=200,step=200}={}){
  const o=[];
  for(let s=0;s+trainBars+testBars<=length;s+=step){
    o.push({
      window:s/step,
      trainStart:s,
      trainEnd:s+trainBars,
      testStart:s+trainBars,
      testEnd:s+trainBars+testBars
    });
  }
  return o;
}

export function summarizeWalkForward(windows,rows){
  return(windows||[]).map((w,i)=>{
    const train=(rows||[]).filter(x=>x.index>=w.trainStart&&x.index<w.trainEnd);
    const test=(rows||[]).filter(x=>x.index>=w.testStart&&x.index<w.testEnd);
    const closedTrain=train.filter(x=>x.outcome!=='TIMEOUT');
    const closedTest=test.filter(x=>x.outcome!=='TIMEOUT');
    const trainWins=closedTrain.filter(x=>x.outcome==='WIN').length;
    const testWins=closedTest.filter(x=>x.outcome==='WIN').length;
    const trainNetR=train.reduce((s,x)=>s+(x.pnlR||0),0);
    const testNetR=test.reduce((s,x)=>s+(x.pnlR||0),0);
    return{
      window:i,
      ...w,
      trainTrades:train.length,
      trainClosed:closedTrain.length,
      trainWinRate:closedTrain.length?trainWins/closedTrain.length:null,
      trainNetR,
      trainAvgR:train.length?trainNetR/train.length:null,
      testTrades:test.length,
      testClosed:closedTest.length,
      testWinRate:closedTest.length?testWins/closedTest.length:null,
      testNetR,
      testAvgR:test.length?testNetR/test.length:null
    };
  });
}
