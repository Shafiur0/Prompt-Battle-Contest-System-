"use client";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import { runGenerationAction } from "@/lib/generation";
import { Icon } from "./ui";
export default function GenerateControl({ disabled, pending, blockReason, resetKey, onGenerate }: { disabled: boolean; pending: boolean; blockReason: string | null; resetKey: string; onGenerate: () => Promise<unknown> }) {
 const [error,setError]=useState<string|null>(null); const [submitting,setSubmitting]=useState(false);
 const inFlight=useRef(false); const latestKey=useRef(resetKey); latestKey.current=resetKey;
 useEffect(()=>{setError(null);},[resetKey]);
 async function generate() {
  if(disabled||pending||inFlight.current)return;
  inFlight.current=true; const submittedKey=resetKey;
  try { await runGenerationAction(onGenerate,{clearError:()=>setError(null),setSubmitting,reportError:reason=>{if(latestKey.current===submittedKey)setError(errorMessage(reason)||"The generation request could not be confirmed.");}}); }
  finally { inFlight.current=false; }
 }
 return <div className="generation-action"><button className="button primary" disabled={disabled||pending||submitting} onClick={generate}>{pending||submitting?<span className="spinner"/>:<Icon name="bolt" size={16}/>}{submitting?"Submitting request":pending?"Request in progress":"Generate answer"}<Icon name="arrow" size={15}/></button>{error&&<div className="generation-error" role="alert"><Icon name="shield" size={16}/><span>{error}</span></div>}{blockReason&&<p className="generation-block" role="status">{blockReason}</p>}</div>;
}
