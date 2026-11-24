"use client";
import {useEffect,useRef,useState} from "react";
import type {CompetitionView} from "@/lib/views";
import type {ProblemEditorView} from "@/lib/problem-editor-model";
import {getProblemEditor,deleteProblemEditor} from "@/lib/backend";
import {errorMessage} from "@/lib/api";
import {Badge,Modal,Notice} from "./ui";
import {isSampleCompetition} from "./competition-switcher";
import ProblemEditor from "./problem-editor";
import DeleteDraftProblem from "./delete-draft-problem";
import styles from "./problem-manager.module.css";
export default function ProblemManager({competition:c,competitions,active,startEditing=false,compact=false,onSelect,onDirtyChange,onEditingChange}:{competition:CompetitionView;competitions:CompetitionView[];active:boolean;startEditing?:boolean;compact?:boolean;onSelect?:(id:string)=>void;onDirtyChange?:(dirty:boolean)=>void;onEditingChange?:(editing:boolean)=>void}){
 const [editing,setEditing]=useState(startEditing),[definition,setDefinition]=useState<ProblemEditorView|null>(null),[query,setQuery]=useState(""),[examples,setExamples]=useState(false),[dirty,setDirty]=useState(false),[discard,setDiscard]=useState(false),[viewOpen,setViewOpen]=useState(false),[editorKey,setEditorKey]=useState(0),[error,setError]=useState<string|null>(null),[success,setSuccess]=useState<string|null>(null);
 const first=useRef(true),editingCallback=useRef(onEditingChange);editingCallback.current=onEditingChange;
 useEffect(()=>{if(first.current){first.current=false;return;}setEditing(false);setEditorKey(k=>k+1);setDefinition(null);setDirty(false);setSuccess(null);setError(null);},[c.id]);
 useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
 useEffect(()=>{editingCallback.current?.(editing);},[editing]);
 useEffect(()=>{if(!active)return;let alive=true;getProblemEditor(c.id).then(data=>{if(alive)setDefinition(data);}).catch(reason=>{if(alive)setError(errorMessage(reason));});return()=>{alive=false;};},[active,c.id]);
 const hasProblem=definition?definition.problemKind!=="NONE"&&!definition.deleted:!c.problemDeleted&&c.problemKind!=="NONE",draft=c.status==="DRAFT",starter=(definition?.problemKind||c.problemKind)==="ALLOCATION";
 const title=definition?.publicProblem?.title||c.problemTitle,statement=definition?.draft?.statement||definition?.publicProblem?.statement||c.problemStatement;
 const choices=(competitions.length?competitions:[c]).filter(item=>examples||!isSampleCompetition(item.title)||item.id===c.id).filter(item=>(item.title+" "+item.problemTitle).toLowerCase().includes(query.trim().toLowerCase())).slice().reverse();
 async function remove(){try{await deleteProblemEditor(c.id);setDefinition(await getProblemEditor(c.id));setEditing(false);setEditorKey(k=>k+1);setDirty(false);setSuccess("Problem deleted.");setError(null);}catch(reason){setError(errorMessage(reason));throw reason;}}
 function back(){if(dirty)setDiscard(true);else setEditing(false);}
 function discardChanges(){setDirty(false);setEditing(false);setEditorKey(k=>k+1);setDiscard(false);}
 function saved(data:ProblemEditorView){setDefinition(data);setDirty(false);setEditing(false);setEditorKey(k=>k+1);setSuccess("Problem saved.");setError(null);}
 return <>
  {error&&<Notice error>{error}</Notice>}
  {!compact&&!editing&&<div className={styles.heading}><h2>Problems</h2></div>}
  <div className={compact||editing?styles.compactLayout:styles.layout}>
   {!compact&&!editing&&<aside className={styles.picker+" card"}><div className={styles.pickerHead}><strong>Select a problem</strong><input aria-label="Search problems" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search problems"/></div><div className={styles.problemList}>{choices.map(item=><button key={item.id} type="button" aria-label={"Select problem · "+item.title} aria-current={item.id===c.id?"true":undefined} className={styles.choice+" "+(item.id===c.id?styles.selected:"")} onClick={()=>onSelect?.(item.id)}><strong>{item.title}</strong><span>{item.problemDeleted?"No active problem":item.problemTitle}</span></button>)}</div><label className={styles.exampleToggle}><input type="checkbox" checked={examples} onChange={e=>setExamples(e.target.checked)}/>Show samples and tests</label></aside>}
   <div>
    {!editing&&<section className={styles.current+" card"} aria-label="Current problem"><div className={styles.currentHead}><div><small>Problem</small><h3>{hasProblem?title:"No problem added"}</h3></div><Badge tone={draft?"blue":"green"}>{draft?"Draft":"Published"}</Badge></div><p className={styles.excerpt}>{hasProblem?statement:"Add your problem and correct answer."}</p><div className={styles.problemActions}><button className="button primary small" onClick={()=>{setEditing(true);setSuccess(null);}}>{!hasProblem||starter?"Add problem":"Edit problem"}</button><button className="button small" disabled={!hasProblem} onClick={()=>setViewOpen(true)}>View statement</button><span title={draft?"Delete this draft problem":"Deletion is available before publication"}><DeleteDraftProblem disabled={!draft||!hasProblem} onDelete={remove}/></span></div>{success&&<p className={styles.success} role="status">{success}</p>}</section>}
    {editing&&<div className={styles.cancel}><button type="button" className="button small" onClick={back}>Cancel</button></div>}
    <div hidden={!editing} className={styles.editor}><ProblemEditor key={editorKey} competition={c} active={active&&editing} hideDelete onDirtyChange={setDirty} onSaved={saved}/></div>
   </div>
  </div>
  {viewOpen&&<Modal title={title} onClose={()=>setViewOpen(false)}><p className={styles.fullStatement}>{statement}</p>{definition?.draft?.objectives.length?<><h3>Goals</h3><ul>{definition.draft.objectives.map((text,i)=><li key={i}>{text}</li>)}</ul></>:null}{definition?.draft?.constraints.length?<details><summary>Answer instructions and restrictions</summary><ul>{definition.draft.constraints.map((text,i)=><li key={i}>{text}</li>)}</ul></details>:null}</Modal>}
  {discard&&<Modal title="Leave unsaved changes?" onClose={()=>setDiscard(false)}><p>Discard these unsaved changes?</p><div className="actions"><button className="button" onClick={()=>setDiscard(false)}>Keep editing</button><button className="button danger" onClick={discardChanges}>Discard changes</button></div></Modal>}
 </>;
}