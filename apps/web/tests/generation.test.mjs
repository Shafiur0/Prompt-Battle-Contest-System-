import test from "node:test";
import assert from "node:assert/strict";
import { generationBlockReason, runGenerationAction } from "../src/lib/generation.ts";
const now=Date.parse("2026-11-21T00:00:00Z");
const competition={status:"GENERATION_OPEN",generationCutoff:"2026-11-21T01:00:00Z",modelReady:true,member:true,workspaceState:"OPEN",generationReservationTokens:1_056_768};
const account={allowance:2_000_000,confirmedUsed:0,reserved:0,available:2_000_000,state:"OPEN"};
test("the confirmed open zero-usage account is not spuriously blocked",()=>assert.equal(generationBlockReason(competition,account,false,now),null));
test("drafts and expired generation windows cannot show an enabled request",()=>{
 assert.match(generationBlockReason({...competition,status:"DRAFT"},account,false,now),/not opened/);
 assert.match(generationBlockReason({...competition,generationCutoff:"2026-11-21T00:00:00Z"},account,false,now),/deadline/);
});
test("positive available tokens do not bypass the server's full request reservation",()=>{
 const low={...account,confirmedUsed:1_000_000,available:1_000_000};
 assert.match(generationBlockReason(competition,low,false,now),/1,056,768.*1,000,000/);
 assert.equal(generationBlockReason({...competition,generationReservationTokens:undefined},low,false,now),null);
});
test("closed, frozen, reserved, missing-balance and missing-model states fail closed",()=>{
 assert.ok(generationBlockReason(competition,account,true,now));
 assert.ok(generationBlockReason(competition,{...account,state:"ACCOUNTING_INCIDENT"},false,now));
 assert.ok(generationBlockReason(competition,{...account,reserved:100,available:1_999_900},false,now));
 assert.ok(generationBlockReason(competition,{...account,available:undefined},false,now));
 assert.ok(generationBlockReason({...competition,modelReady:false},account,false,now));
});
test("a server failure is surfaced and clears submitting without automatic retry",async()=>{
 const failure=new Error("Internal server error"); const states=[]; let shown=null,calls=0,cleared=0;
 const result=await runGenerationAction(async()=>{calls++;throw failure;},{clearError:()=>cleared++,setSubmitting:value=>states.push(value),reportError:error=>{shown=error;}});
 assert.equal(result,null);assert.equal(calls,1);assert.equal(cleared,1);assert.equal(shown,failure);assert.deepEqual(states,[true,false]);
});
test("a confirmed attempt passes through and has no failure message",async()=>{
 const states=[];let shown=false;
 const result=await runGenerationAction(async()=>"confirmed-attempt",{clearError:()=>{},setSubmitting:value=>states.push(value),reportError:()=>{shown=true;}});
 assert.equal(result,"confirmed-attempt");assert.equal(shown,false);assert.deepEqual(states,[true,false]);
});

test("a human ban blocks generation using only the public notice and preserves wallet values",()=>{const before=structuredClone(account);assert.equal(generationBlockReason({...competition,moderationStatus:"BANNED",publicModerationNotice:"Contact the organizer about participation."},account,false,now),"Contact the organizer about participation.");assert.deepEqual(account,before);});
test("clearing a ban never reopens a closed competition",()=>{assert.match(generationBlockReason({...competition,status:"CLOSED",moderationStatus:"ACTIVE"},account,false,now),/closed/);});
