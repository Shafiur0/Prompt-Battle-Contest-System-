"use client";
import { useEffect, useState } from "react";
import type { AnnouncementView } from "@/lib/views";
import { getMemberAnnouncements } from "@/lib/backend";
import { Icon, date } from "./ui";
export default function MemberAnnouncements({competitionId,member}:{competitionId:string;member:boolean}) {
 const [items,setItems]=useState<AnnouncementView[]>([]);
 useEffect(()=>{if(!member){setItems([]);return;}let alive=true;async function load(){try{const data=await getMemberAnnouncements(competitionId);if(alive)setItems(data.announcements.filter(item=>!item.withdrawn));}catch{}}void load();const timer=setInterval(()=>{if(document.visibilityState==="visible")void load();},6000);return()=>{alive=false;clearInterval(timer);};},[competitionId,member]);
 if(!member||!items.length)return null;
 return <section className="card pad" style={{marginBottom:22}}><div className="section-head"><h2>Organizer announcements</h2><Icon name="document"/></div><div className="stack">{items.map(item=><article key={item.id}><small>{date(item.createdAt)}</small><p className="problem-text space-top" style={{marginTop:6}}>{item.message}</p></article>)}</div></section>;
}
