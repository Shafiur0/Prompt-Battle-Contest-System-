"use client";
import {useEffect,useState} from "react";
import {Icon,Notice} from "./ui";
type SignInReason="expired"|"failed";
export default function SignInNotice({reason}:{reason?:SignInReason}={}){
 const [queryReason,setQueryReason]=useState<SignInReason|null>(null),[dismissed,setDismissed]=useState(false);
 useEffect(()=>{const value=new URL(window.location.href).searchParams.get("auth");setQueryReason(value==="expired"||value==="failed"?value:null);},[]);
 const current=reason??queryReason;
 function dismiss(){setDismissed(true);const url=new URL(window.location.href);url.searchParams.delete("auth");window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);}
 if(!current||dismissed)return null;
 return <div style={{padding:"14px 20px 0"}}><Notice><div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}><span>{current==="expired"?"Sign-in session expired. Start a new sign-in.":"Sign-in could not be completed. Please try again."}</span><a className="button small" href="/api/v1/auth/login">Sign in again</a><button type="button" className="icon-button" aria-label="Dismiss sign-in message" onClick={dismiss}><Icon name="close" size={16}/></button></div></Notice></div>;
}
