"use client";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { CompetitionView } from "@/lib/views";
import { Icon } from "./ui";
import styles from "./competition-switcher.module.css";

const sampleTitles = new Set(["local verification draft", "problem editor verification", "supply allocation · local calibration"]);
export function isSampleCompetition(title: string) {
 const value = title.trim().toLocaleLowerCase();
 return /^system test\b/.test(value) || sampleTitles.has(value);
}
function groupFor(competition: CompetitionView): "Draft" | "Open" | "Completed" {
 if (competition.status === "DRAFT") return "Draft";
 return competition.status.includes("OPEN") ? "Open" : "Completed";
}
const groupNames = ["Draft", "Open", "Completed"] as const;

export default function CompetitionSwitcher({ competitions, selectedId, onSelect }: {
 competitions: CompetitionView[]; selectedId: string; onSelect: (id: string) => void;
}) {
 const [open, setOpen] = useState(false);
 const [query, setQuery] = useState("");
 const [showSamples, setShowSamples] = useState(() => competitions.length > 0 && competitions.every(c => isSampleCompetition(c.title)));
 const [activeIndex, setActiveIndex] = useState(0);
 const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
 const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
 const id = useId(), listId = id + "-competitions";
 const selected = competitions.find(c => c.id === selectedId);
 const available = useMemo(() => {
  const filtered = competitions.filter(c => showSamples || !isSampleCompetition(c.title) || c.id === selectedId);
  return filtered.length ? filtered : competitions;
 }, [competitions, showSamples, selectedId]);
 const groups = useMemo(() => {
  const text = query.trim().toLocaleLowerCase();
  return groupNames.map(name => ({ name, items: available.filter(c => groupFor(c) === name && (!text || c.title.toLocaleLowerCase().includes(text))) })).filter(group => group.items.length > 0);
 }, [available, query]);
 const options = useMemo(() => groups.flatMap(group => group.items), [groups]);
 const hiddenCount = competitions.length - available.length;
 function dismiss(returnFocus = false) { setOpen(false); if (returnFocus) trigger.current?.focus(); }
 function choose(id: string) { onSelect(id); dismiss(true); }
 function reveal() { setQuery(""); setOpen(true); }

 useEffect(() => {
  const index = options.findIndex(c => c.id === selectedId);
  setActiveIndex(index >= 0 ? index : 0);
 }, [options, selectedId]);
 useEffect(() => {
  if (!open) return;
  function place() {
   const rect = trigger.current?.getBoundingClientRect(); if (!rect) return;
   const width = Math.min(420, window.innerWidth - 32);
   const left = Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16));
   const below = window.innerHeight - rect.bottom - 24, above = rect.top - 24;
   const upward = below < 220 && above > below;
   const maxHeight = Math.max(140, Math.min(480, upward ? above : below));
   const top = upward ? Math.max(16, rect.top - maxHeight - 8) : rect.bottom + 8;
   setPosition({ left, top, width, maxHeight });
  }
  place();
  const focus = requestAnimationFrame(() => search.current?.focus());
  function outside(event: PointerEvent) {
   const target = event.target as Node;
   if (!trigger.current?.contains(target) && !panel.current?.contains(target)) dismiss();
  }
  document.addEventListener("pointerdown", outside);
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);
  return () => { cancelAnimationFrame(focus); document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
 }, [open]);
 useEffect(() => {
  if (open && options[activeIndex]) document.getElementById(id + "-" + options[activeIndex].id)?.scrollIntoView({ block: "nearest" });
 }, [activeIndex, options, open, id]);
 function navigate(event: KeyboardEvent<HTMLInputElement>) {
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
   event.preventDefault();
   if (!options.length) return;
   setActiveIndex(current => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
  } else if (event.key === "Enter" && options[activeIndex]) { event.preventDefault(); choose(options[activeIndex].id); }
 }
 return <div className={styles.root}>
  <button ref={trigger} type="button" className={styles.trigger} aria-label="Current competition" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id + "-panel" : undefined} title={selected?.title || "Choose a competition"} onClick={() => open ? dismiss() : reveal()} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); reveal(); } }}>
   <Icon name="arena" size={16}/><span className={styles.triggerText}><span className={styles.caption}>Current competition</span><span className={styles.title}>{selected?.title || "Choose a competition"}</span></span>
   <svg className={styles.chevron} width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg>
  </button>
  {open && position && createPortal(<div ref={panel} id={id + "-panel"} role="dialog" aria-label="Choose a competition" className={styles.popover} style={position} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(true); } }}>
   <div className={styles.searchRow}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input ref={search} type="search" aria-label="Search competitions" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={options[activeIndex] ? id + "-" + options[activeIndex].id : undefined} placeholder="Search competitions…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={navigate}/><button type="button" className={styles.close} aria-label="Close competition menu" onClick={() => dismiss(true)}><Icon name="close" size={15}/></button></div>
   <div id={listId} role="listbox" aria-label="Competitions" className={styles.list}>
    {groups.map(group => <div key={group.name} role="group" aria-labelledby={id + "-" + group.name}><div id={id + "-" + group.name} className={styles.groupHeading}><span>{group.name}</span><span>{group.items.length}</span></div>{group.items.map(c => {
     const index = options.findIndex(option => option.id === c.id), current = c.id === selectedId;
     return <button type="button" role="option" aria-selected={current} id={id + "-" + c.id} tabIndex={-1} className={styles.option + (index === activeIndex ? " " + styles.active : "")} key={c.id} onPointerMove={() => setActiveIndex(index)} onClick={() => choose(c.id)}><span className={styles.optionText}><span>{c.title}</span>{isSampleCompetition(c.title) && <small>Sample or test round</small>}</span>{current && <Icon name="check" size={17}/>}</button>;
    })}</div>)}
    {!options.length && <div className={styles.empty}><strong>No competitions found</strong><span>Try another title or show samples and tests.</span>{query && <button type="button" onClick={() => { setQuery(""); search.current?.focus(); }}>Clear search</button>}</div>}
   </div>
   <div className={styles.footer}><label><input type="checkbox" checked={showSamples} onChange={event => setShowSamples(event.target.checked)}/>Show samples and tests</label>{hiddenCount > 0 && <span>{hiddenCount} hidden</span>}</div>
   <span className="sr-only" role="status">{options.length} competitions available</span>
  </div>, document.body)}
 </div>;
}
