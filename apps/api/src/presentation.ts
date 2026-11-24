export function publishedResultVisible(competitionStatus:string,submissionStatus:string,scoreDecisionId:string|null|undefined,effectiveDecisionId:string|null|undefined){
 return ['REVEALED','CALIBRATION_REVEALED'].includes(competitionStatus)&&submissionStatus==='FINALIZED'&&!!scoreDecisionId&&scoreDecisionId===effectiveDecisionId;
}
function exactCompare(a:string,b:string){
 if(!/^\d+(\.\d+)?$/.test(a)||!/^\d+(\.\d+)?$/.test(b))return Number(a)-Number(b);
 const [ai,af='']=a.split('.'),[bi,bf='']=b.split('.'),width=Math.max(af.length,bf.length);
 const x=BigInt(ai+af.padEnd(width,'0')),y=BigInt(bi+bf.padEnd(width,'0'));return x<y?-1:x>y?1:0;
}
export function compareLeaderboardRows(a:any,b:any){
 const ae=!!a.score?.eligible,be=!!b.score?.eligible;
 if(ae!==be)return be?1:-1;
 const score=exactCompare(String(b.score?.finalScoreExact??b.score?.finalScore??0),String(a.score?.finalScoreExact??a.score?.finalScore??0));
 return score||Number(b.score?.quality||0)-Number(a.score?.quality||0)||Number(b.score?.correctness||0)-Number(a.score?.correctness||0)||Number(a.consumed)-Number(b.consumed);
}
