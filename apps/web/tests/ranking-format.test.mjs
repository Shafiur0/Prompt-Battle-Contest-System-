import test from "node:test";
import assert from "node:assert/strict";
import { firstCorrectSolvers, formatCompletionTime, formatRankingPosition, rankingResultsVisible, rankingStatus, rankingViewRows } from "../src/lib/ranking-format.ts";
const rows = [
 {alias:"Alice",rank:1,solveOrder:2,score:98,status:"FINALIZED",eligible:true,solveElapsedMs:220000,tokens:250},
 {alias:"Bob",rank:2,solveOrder:1,score:97,status:"FINALIZED",eligible:true,solveElapsedMs:200000,tokens:180},
 {alias:"Carol",rank:null,solveOrder:null,score:null,status:"PENDING",eligible:null,solveElapsedMs:null,tokens:100},
 {alias:"Dave",rank:null,solveOrder:null,score:null,status:"BANNED",eligible:null,solveElapsedMs:null,tokens:90},
 {alias:"Eve",rank:null,solveOrder:null,score:null,status:"NO_SUBMISSION",eligible:null,solveElapsedMs:null,tokens:0}
];
test("correct-completion formatting uses readable units and never fabricates missing time",()=>{
 for(const [input,expected] of [[null,"—"],[undefined,"—"],[-1,"—"],[Infinity,"—"],[NaN,"—"],[0,"0s"],[950,"Under 1s"],[200000,"3m 20s"],[3601000,"1h 1s"],[90061000,"1d 1h 1m 1s"]])assert.equal(formatCompletionTime(input),expected);
});
test("positions remain pending unless the server supplies a positive integer",()=>{
 assert.equal(formatRankingPosition(1),"#1");assert.equal(formatRankingPosition(10),"#10");
 for(const value of [null,undefined,0,-1,1.5,NaN,Infinity])assert.equal(formatRankingPosition(value),"—");
});
test("overall and solved-first views use their separate server positions without regrading",()=>{
 const before=structuredClone(rows);
 assert.deepEqual(rankingViewRows(rows,{order:"overall",resultsVisible:true}).map(row=>row.alias),["Alice","Bob","Carol","Dave","Eve"]);
 assert.deepEqual(rankingViewRows(rows,{order:"solved",resultsVisible:true}).map(row=>row.alias),["Bob","Alice","Carol","Dave","Eve"]);
 assert.deepEqual(rows,before);assert.equal(rows[1].rank,2);
});
test("sealed scores never enable solving order or first-solver labels",()=>{
 const data={mode:"OFFICIAL",resultsVisible:false,firstSolverAliases:["Bob"],rows};
 assert.equal(rankingResultsVisible(data),false);
 assert.deepEqual(firstCorrectSolvers(data),[]);
 assert.deepEqual(rankingViewRows(rows,{order:"solved",resultsVisible:false}),rows);
 assert.deepEqual(rankingViewRows(rows,{filter:"solved",resultsVisible:false}),[]);
 assert.equal(rankingStatus(rows[0],false),"Results pending");
});
test("search and filters preserve every actual participant and distinguish pending from withheld entries",()=>{
 assert.equal(rankingViewRows(rows,{resultsVisible:true}).length,5);
 assert.deepEqual(rankingViewRows(rows,{filter:"solved",resultsVisible:true}).map(row=>row.alias),["Alice","Bob"]);
 assert.deepEqual(rankingViewRows(rows,{filter:"pending",resultsVisible:true}).map(row=>row.alias),["Carol"]);
 assert.deepEqual(rankingViewRows(rows,{query:"  bOB ",resultsVisible:true}).map(row=>row.alias),["Bob"]);
 assert.equal(rankingStatus(rows[3],true),"Ranking withheld");assert.equal(rankingStatus(rows[4],true),"No final answer");
 assert.equal(rankingStatus({...rows[0],eligible:false},true),"Not eligible");
});
test("shared first place uses explicit solve-order data and stable ties",()=>{
 const tied=[{...rows[0],solveOrder:1},rows[1],rows[2]];
 assert.deepEqual(firstCorrectSolvers({mode:"OFFICIAL",resultsVisible:true,rows:tied}),["Alice","Bob"]);
 assert.deepEqual(firstCorrectSolvers({mode:"OFFICIAL",resultsVisible:true,firstSolverAliases:["Bob","Alice"],rows:tied}),["Bob","Alice"]);
 assert.deepEqual(rankingViewRows(tied,{order:"solved",resultsVisible:true}),tied);
});