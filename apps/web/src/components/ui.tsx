"use client";
import { useEffect, useRef, type ReactNode } from "react";
export type IconName = "bolt" | "arena" | "trophy" | "history" | "arrow" | "check" | "lock" | "refresh" | "settings" | "people" | "close" | "document" | "shield" | "logout";
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
 const paths: Record<IconName, ReactNode> = {
 bolt: <path d="M13 2 4 14h7l-1 8 10-13h-7l1-7Z"/>,
 arena: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m8 9 3 3-3 3m5 0h3"/></>,
 trophy: <><path d="M8 3h8v7a4 4 0 0 1-8 0V3Zm4 11v5m-4 2h8M8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4"/></>,
 history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/><path d="M12 7v5l3 2"/></>,
 arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
 check: <path d="m5 12 4 4L19 6"/>,
 lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
 refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12 0l2 5M4 12l2 5a7 7 0 0 0 12 0"/></>,
 settings: <><path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2"/><circle cx="12" cy="12" r="4"/></>,
 people: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/></>,
 close: <path d="m6 6 12 12M6 18 18 6"/>,
 document: <><path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h5"/></>,
 shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
 logout: <><path d="M10 4H4v16h6m3-14 6 6-6 6M8 12h11"/></>
 };
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "blue" }) { return <span className={"badge " + tone}>{children}</span>; }
export function Empty({ icon = "document", title, children }: { icon?: IconName; title: string; children: ReactNode }) { return <div className="empty"><span className="empty-icon"><Icon name={icon} size={25}/></span><h3>{title}</h3><p>{children}</p></div>; }
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div className={"notice " + (error ? "error" : "")} role={error ? "alert" : "status"}><Icon name={error ? "shield" : "document"}/><span>{children}</span></div>; }
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
 const panel = useRef<HTMLElement>(null); const close = useRef(onClose); close.current = onClose;
 useEffect(() => {
  const previous = document.activeElement as HTMLElement | null;
  const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || []);
  const targets = focusable(); (panel.current?.querySelector<HTMLElement>("input,textarea,select") || targets[0])?.focus();
  const key = (event: KeyboardEvent) => { if (event.key === "Escape") close.current(); if (event.key === "Tab") { const list=focusable(); const first=list[0],last=list[list.length-1]; if(!first)return; if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();} } };
  document.addEventListener("keydown",key); const overflow=document.body.style.overflow; document.body.style.overflow="hidden";
  return () => { document.removeEventListener("keydown",key); document.body.style.overflow=overflow; previous?.focus(); };
 },[]);
 return <div className="modal-backdrop" onClick={onClose}><section ref={panel} className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}><div className="section-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close"/></button></div>{children}</section></div>;
}
export const number = (value: number | undefined | null) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("en-US").format(value);
export function date(value?: string | null) { return value ? new Date(value).toLocaleString("en-GB", { day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Dhaka" }) + " · Dhaka" : "Not scheduled"; }
export function status(value?: string) { return (value || "pending").toLowerCase().replaceAll("_", " "); }
