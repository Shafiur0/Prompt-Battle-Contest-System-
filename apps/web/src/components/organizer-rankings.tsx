"use client";
import { useEffect, useState } from "react";
import type { LeaderboardView } from "@/lib/views";
import { getLeaderboard } from "@/lib/backend";
import { errorMessage } from "@/lib/api";
import RankingBoard from "./ranking-board";
export default function OrganizerRankings({competitionId,active,alias,data,onInspect}:{competitionId:string;active:boolean;alias?:string|null;data?:LeaderboardView|null;onInspect?:(alias:string)=>void}) {
 const [loaded,setLoaded]=useState<{id:string;board:LeaderboardView}|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!active||data!==undefined)return;
  let alive=true,inFlight=false;
  setError(null);
  async function refresh(){
   if(inFlight)return;inFlight=true;setLoading(true);
   try{const board=await getLeaderboard(competitionId);if(alive){setLoaded({id:competitionId,board});setError(null);}}
   catch(reason){if(alive)setError(errorMessage(reason));}
   finally{inFlight=false;if(alive)setLoading(false);}
  }
  void refresh();const interval=setInterval(()=>void refresh(),6000);
  return()=>{alive=false;clearInterval(interval);};
 },[competitionId,active,data]);
 if(!active)return null;
 return <RankingBoard key={competitionId} data={data!==undefined?data:loaded?.id===competitionId?loaded.board:null} alias={alias} onInspect={onInspect} error={error} loading={data===undefined&&loading}/>;
}