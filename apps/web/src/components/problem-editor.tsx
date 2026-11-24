"use client";
import {useEffect,useRef,useState} from "react";
import type {CompetitionView} from "@/lib/views";
import {getProblemEditor,saveProblemEditor,deleteProblemEditor} from "@/lib/backend";
import {errorMessage} from "@/lib/api";
import {blankProblem,formFromDraft,serializeProblem,type CheckForm,type ProblemEditorView,type ProblemForm,type RequirementForm} from "@/lib/problem-editor-model";
import {createSimpleProblem,buildSimpleProblem,inferSimpleProblem,type SimpleProblemForm} from "@/lib/simple-problem-model";
import {Badge,Empty,Icon,Modal,Notice} from "./ui";
import AdvancedProblemFields from "./advanced-problem-fields";
import DeleteDraftProblem from "./delete-draft-problem";
import styles from "./problem-editor.module.css";
const REFERENCE_METADATA="Organizer-provided reference answer.";
export default function ProblemEditor({competition,active,hideDelete=false,onDirtyChange,onSaved}:{competition:CompetitionView;active:boolean;hideDelete?:boolean;onDirtyChange?:(dirty:boolean)=>void;onSaved?:(view:ProblemEditorView)=>void}){
 const [view,setView]=useState<ProblemEditorView|null>(null),[simple,setSimple]=useState<SimpleProblemForm>(()=>createSimpleProblem()),[form,setForm]=useState<ProblemForm>(()=>blankProblem());
 const [mode,setMode]=useState<"simple"|"advanced">("simple");
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[dirty,setDirty]=useState(false),[replaceOpen,setReplaceOpen]=useState(false);
 const [error,setError]=useState<string|null>(null),[saved,setSaved]=useState<string|null>(null);
 const loadedId=useRef<string|null>(null),inFlight=useRef(false);
 useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
 function apply(data:ProblemEditorView){
  const inferred=data.draft?inferSimpleProblem(data.draft):null;
  setView(data);setForm(data.draft?formFromDraft(data.draft):blankProblem(competition.title));
  setSimple(inferred?{...inferred,explanation:inferred.explanation===REFERENCE_METADATA?"":inferred.explanation}:{...createSimpleProblem(data.draft?.title||competition.title),statement:data.draft?.statement||"",objectives:data.draft?.objectives.join("\n")||"",constraints:data.draft?.constraints.join("\n")||""});
  setMode(data.draft&&!inferred?"advanced":"simple");setDirty(false);
 }
 useEffect(()=>{if(!active||loadedId.current===competition.id)return;let alive=true;setLoading(true);setError(null);setSaved(null);getProblemEditor(competition.id).then(data=>{if(alive){loadedId.current=competition.id;apply(data);}}).catch(reason=>{if(alive)setError(errorMessage(reason));}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[active,competition.id]);
 function changed(){setDirty(true);setSaved(null);setError(null);}
 function editSimple(patch:Partial<SimpleProblemForm>){setSimple(current=>({...current,...patch}));changed();}
 function editAdvanced(patch:Partial<ProblemForm>){setForm(current=>({...current,...patch}));changed();}
 function editPublic(patch:Partial<Pick<SimpleProblemForm,"title"|"statement"|"objectives"|"constraints">>){if(mode==="simple")editSimple(patch);else editAdvanced(patch);}
 function requirement(index:number,patch:Partial<RequirementForm>){setForm(current=>{const old=current.requirements[index];return {...current,requirements:current.requirements.map((row,n)=>n===index?{...row,...patch}:row),checks:patch.id===undefined?current.checks:current.checks.map(row=>row.requirementId===old.id?{...row,requirementId:patch.id!}:row)};});changed();}
 function check(index:number,patch:Partial<CheckForm>){editAdvanced({checks:form.checks.map((row,n)=>n===index?{...row,...patch}:row)});}
 function simpleDraft(){return buildSimpleProblem({...simple,explanation:simple.explanation.trim()?simple.explanation:REFERENCE_METADATA});}
 function draft(){return mode==="simple"?simpleDraft():serializeProblem(form);}
 async function reload(){if(dirty||inFlight.current)return;setLoading(true);setError(null);try{const data=await getProblemEditor(competition.id);loadedId.current=competition.id;apply(data);setSaved(null);}catch(reason){setError(errorMessage(reason));}finally{setLoading(false);}}
 async function save(){if(inFlight.current)return;let payload;try{payload=draft();}catch(reason){setError(reason instanceof Error?reason.message:"Check the problem fields.");return;}inFlight.current=true;setSaving(true);setError(null);try{const data=await saveProblemEditor(competition.id,payload);loadedId.current=competition.id;apply(data);setSaved("Saved.");onSaved?.(data);}catch(reason){setError(errorMessage(reason));}finally{inFlight.current=false;setSaving(false);}}
 async function remove(){if(competition.status!=="DRAFT"||inFlight.current)return;inFlight.current=true;setSaving(true);try{await deleteProblemEditor(competition.id);setView(await getProblemEditor(competition.id));setDirty(true);setSaved("Deleted. Your fields remain available to save again.");}catch(reason){setError(errorMessage(reason));throw reason;}finally{inFlight.current=false;setSaving(false);}}
 function advanced(){let target:ProblemForm;try{target=formFromDraft(simpleDraft());}catch{target={...blankProblem(simple.title),statement:simple.statement,objectives:simple.objectives,constraints:simple.constraints};}setForm(target);setMode("advanced");setError(null);}
 function replace(){setSimple({...createSimpleProblem(form.title),statement:form.statement,objectives:form.objectives,constraints:form.constraints});setMode("simple");setReplaceOpen(false);changed();}
 const publicForm=mode==="simple"?simple:form,words=simple.explanation.trim().split(/\s+/).filter(Boolean).length;
 const deleted=Boolean(view?.deleted||view?.problemKind==="NONE");
 if(loading||loadedId.current!==competition.id)return <section className="card pad">{error?<><Notice error>{error}</Notice><button className="button" onClick={reload}>Try again</button></>:<Empty icon="document" title="Loading your problem">Your saved fields will appear here.</Empty>}</section>;
 if(!view)return <section className="card pad"><Notice error>Your problem could not be loaded.</Notice><button className="button" onClick={reload}>Try again</button></section>;
 return <section className={"card "+styles.editor} aria-label="Problem editor">
  <header className={styles.header}><h2>Problem</h2>{dirty&&<Badge tone="amber">Unsaved</Badge>}</header>
  <div className={styles.body}>
   {error&&<Notice error>{error}</Notice>}{saved&&<p className={styles.saved} role="status">{saved}</p>}
   <fieldset className={styles.fieldset} disabled={saving}>
    <div className="field"><label htmlFor="problem-title">Problem title</label><input id="problem-title" value={publicForm.title} onChange={e=>editPublic({title:e.target.value})} maxLength={160} placeholder="Problem title" aria-required="true"/></div>
    <div className="field"><label htmlFor="problem-statement">Problem statement</label><textarea id="problem-statement" className={styles.statement} value={publicForm.statement} onChange={e=>editPublic({statement:e.target.value})} placeholder="Describe the task and include the information participants need." aria-required="true"/></div>
    <details className={styles.optional}><summary>Goals and restrictions <span>Optional</span></summary><div className="form-grid"><div className="field"><label htmlFor="problem-objectives">Goals</label><textarea id="problem-objectives" value={publicForm.objectives} onChange={e=>editPublic({objectives:e.target.value})}/></div><div className="field"><label htmlFor="problem-constraints">Restrictions</label><textarea id="problem-constraints" value={publicForm.constraints} onChange={e=>editPublic({constraints:e.target.value})}/></div></div></details>
    {mode==="simple"?<div className={styles.answer}>
     <div className={styles.answerHeading}><Icon name="lock" size={14}/><strong>Private answer</strong></div>
     <div className={styles.answerRow}><div className="field"><label htmlFor="answer-type">Answer type</label><select id="answer-type" value={simple.answerType} onChange={e=>editSimple({answerType:e.target.value as "number"|"text"})}><option value="number">Number</option><option value="text">Text</option></select></div><div className="field"><label htmlFor="expected-answer">Correct answer</label>{simple.answerType==="number"?<input id="expected-answer" type="text" inputMode="decimal" value={simple.expectedAnswer} onChange={e=>editSimple({expectedAnswer:e.target.value})} placeholder="For example: 42" aria-required="true"/>:<textarea id="expected-answer" className={styles.shortText} value={simple.expectedAnswer} onChange={e=>editSimple({expectedAnswer:e.target.value})} placeholder="Exact correct text" aria-required="true"/>}{simple.answerType==="text"&&<small>Matches exact capitals, spaces and punctuation.</small>}</div></div>
     <div className="field"><label htmlFor="answer-explanation">Explanation (optional)</label><textarea id="answer-explanation" className={styles.explanation} value={simple.explanation} onChange={e=>editSimple({explanation:e.target.value})} maxLength={2000} placeholder="Add a short explanation if helpful."/>{words>0&&<small className={words>120?styles.invalid:""}>{words} / 120 words</small>}</div>
    </div>:<details className={styles.advancedPanel}><summary>Advanced settings</summary><div><AdvancedProblemFields form={form} onEdit={editAdvanced} onRequirement={requirement} onCheck={check}/><button type="button" className={styles.textButton} disabled={saving} onClick={()=>setReplaceOpen(true)}>Use one simple answer instead</button></div></details>}
   </fieldset>
  </div>
  <footer className={styles.footer}><div>{mode==="simple"&&<button type="button" className={styles.textButton} disabled={saving} onClick={advanced}>Advanced settings</button>}{!hideDelete&&competition.status==="DRAFT"&&!deleted&&<DeleteDraftProblem disabled={saving} onDelete={remove}/>}</div><button type="button" className="button primary" disabled={saving||!dirty} onClick={save}>{saving?<span className="spinner"/>:<Icon name="check" size={15}/>} {saving?"Saving…":"Save problem"}</button></footer>
  {replaceOpen&&<Modal title="Replace the custom answer rules?" onClose={()=>setReplaceOpen(false)}><p>This replaces the current custom answer format and checks with one exact answer. Saved versions remain unchanged. The replacement takes effect only when you save.</p><div className="actions"><button type="button" className="button" onClick={()=>setReplaceOpen(false)}>Keep custom rules</button><button type="button" className="button primary" onClick={replace}>Replace answer setup</button></div></Modal>}
 </section>;
}