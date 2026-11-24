"use client";
import { useState } from "react";
import { Icon, Modal } from "./ui";
export default function DeleteDraftProblem({disabled,onDelete}:{disabled:boolean;onDelete:()=>Promise<void>}) {
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 async function remove(){if(busy)return;setBusy(true);try{await onDelete();setOpen(false);}catch{}finally{setBusy(false);}}
 return <><button className="button small danger" disabled={disabled} onClick={()=>setOpen(true)}><Icon name="close" size={14}/>Delete problem</button>{open&&<Modal title="Delete this draft problem?" onClose={()=>!busy&&setOpen(false)}><p>This removes the active problem from this draft. Earlier saved versions and answers remain in history.</p><p>You can add a new problem afterward.</p><div className="actions"><button className="button" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button><button className="button danger" disabled={busy} onClick={remove}>Delete problem</button></div></Modal>}</>;
}
