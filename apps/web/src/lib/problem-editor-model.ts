export type LiteralJson = null | boolean | number | string | LiteralJson[] | { [key: string]: LiteralJson };
export type CheckOperator = "exists" | "equals" | "not_equals" | "gte" | "lte" | "one_of" | "contains" | "length_equals" | "unique" | "sum_equals";
export interface StructuredProblemDraft {
 kind: "STRUCTURED_JSON"; title: string; statement: string; objectives: string[]; constraints: string[];
 requirements: Array<{id:string;text:string;group:"C"|"K"}>;
 outputSchema: Record<string,unknown>;
 checks: Array<{id:string;name:string;requirementId:string;path:string;operator:CheckOperator;expected?:LiteralJson;weight:number;essential:boolean;visibility:"public"|"private"}>;
 referenceAnswer: LiteralJson;
}
export interface ProblemEditorView { deleted?:boolean;problemKind:"ALLOCATION"|"STRUCTURED_JSON"|"NONE";versionId:string|null;draft:StructuredProblemDraft|null;publicProblem:{title:string;statement:string;outputSchema?:Record<string,unknown>}|null; }
export interface RequirementForm { rowId:string;id:string;text:string;group:"C"|"K"; }
export interface CheckForm { rowId:string;id:string;name:string;requirementId:string;path:string;operator:CheckOperator;expectedJson:string;weight:string;essential:boolean;visibility:"public"|"private"; }
export interface ProblemForm { title:string;statement:string;objectives:string;constraints:string;requirements:RequirementForm[];schemaJson:string;checks:CheckForm[];referenceJson:string; }
export const CHECK_OPERATORS: CheckOperator[] = ["exists","equals","not_equals","gte","lte","one_of","contains","length_equals","unique","sum_equals"];
export const DEFAULT_SCHEMA = {type:"object",properties:{result:{type:"integer"},rationale:{type:"string"}},required:["result","rationale"],additionalProperties:false};
export function blankProblem(title=""): ProblemForm { return {title,statement:"",objectives:"",constraints:"",requirements:[],schemaJson:JSON.stringify(DEFAULT_SCHEMA,null,2),checks:[],referenceJson:""}; }
export function formFromDraft(draft:StructuredProblemDraft):ProblemForm {return {title:draft.title,statement:draft.statement,objectives:draft.objectives.join("\n"),constraints:draft.constraints.join("\n"),requirements:draft.requirements.map(row=>({...row,rowId:crypto.randomUUID()})),schemaJson:JSON.stringify(draft.outputSchema,null,2),checks:draft.checks.map(row=>({rowId:crypto.randomUUID(),id:row.id,name:row.name,requirementId:row.requirementId,path:row.path,operator:row.operator,expectedJson:row.expected===undefined?"":JSON.stringify(row.expected,null,2),weight:String(row.weight),essential:row.essential,visibility:row.visibility})),referenceJson:JSON.stringify(draft.referenceAnswer,null,2)}; }
const dangerous = new Set(["__proto__","constructor","prototype"]);
function inspectLiteral(value:unknown,depth=0):void { if(depth>16)throw new Error("JSON nesting is too deep.");if(typeof value==="number"&&!Number.isFinite(value))throw new Error("JSON numbers must be finite.");if(value&&typeof value==="object")for(const [key,item]of Object.entries(value)){if(dangerous.has(key))throw new Error("Prototype-related keys are not allowed.");inspectLiteral(item,depth+1);} }
export function parseLiteral(text:string,label:string):LiteralJson {if(!text.trim())throw new Error(label+" is required.");let value:unknown;try{value=JSON.parse(text);}catch{throw new Error(label+" must be valid JSON. Strings need double quotes.");}inspectLiteral(value);return value as LiteralJson;}
const schemaKeys=new Set(["type","properties","required","additionalProperties","items","enum","minimum","maximum","minLength","maxLength","minItems","maxItems","title","description"]);
export function parseOutputSchema(text:string):Record<string,unknown>{
 const parsed=parseLiteral(text,"Output schema");
 function visit(node:unknown,depth:number):void {
  if(depth>8)throw new Error("Schema nesting is limited to eight levels.");
  if(!node||typeof node!=="object"||Array.isArray(node))throw new Error("Every schema node must be an object.");
  const schema=node as Record<string,unknown>; for(const key of Object.keys(schema))if(!schemaKeys.has(key))throw new Error("Unsupported schema keyword: "+key+". Code, patterns and references are not supported.");
  if(typeof schema.type!=="string"||!["object","array","string","number","integer","boolean","null"].includes(schema.type))throw new Error("Each schema node needs one supported type.");
  if(schema.type==="object"){
   if(!schema.properties||typeof schema.properties!=="object"||Array.isArray(schema.properties))throw new Error("Object schemas need properties.");
   const properties=schema.properties as Record<string,unknown>,keys=Object.keys(properties);
   if(schema.additionalProperties!==false||!Array.isArray(schema.required)||schema.required.length!==keys.length||keys.some(key=>!(schema.required as unknown[]).includes(key)))throw new Error("Every object must require all its properties and set additionalProperties to false.");
   for(const child of Object.values(properties))visit(child,depth+1);
  }
  if(schema.type==="array"){if(!Number.isInteger(schema.maxItems)||Number(schema.maxItems)<0||Number(schema.maxItems)>1000)throw new Error("Arrays need maxItems between 0 and 1,000.");if(!schema.items)throw new Error("Arrays need an items schema.");visit(schema.items,depth+1);}
 }
 visit(parsed,1);
 const schema=parsed as Record<string,unknown>;
 if(schema.type!=="object")throw new Error("The output schema must describe an object.");
 const rationale=(schema.properties as Record<string,Record<string,unknown>>).rationale;
 if(!rationale||rationale.type!=="string")throw new Error("The top-level rationale property must be a required string.");
 return schema;
}
export function needsExpected(operator:CheckOperator){return operator!=="exists"&&operator!=="unique";}
export function parseExpected(row:CheckForm):LiteralJson|undefined {
 if(!needsExpected(row.operator))return undefined;
 const value=parseLiteral(row.expectedJson,"Expected value for "+(row.name||row.id||"check"));
 if(["gte","lte","sum_equals"].includes(row.operator)&&(typeof value!=="number"||!Number.isFinite(value)))throw new Error("This operator needs a finite numeric expected value.");
 if(row.operator==="length_equals"&&(typeof value!=="number"||!Number.isInteger(value)||value<0))throw new Error("Length must be a nonnegative integer.");
 if(row.operator==="one_of"&&(!Array.isArray(value)||value.length===0||value.length>100))throw new Error("One-of needs a nonempty JSON array of at most 100 literal values.");
 return value;
}
export function jsonIssue(text:string,label:string,schema=false):string|null {if(!text.trim())return null;try{if(schema)parseOutputSchema(text);else parseLiteral(text,label);return null;}catch(error){return error instanceof Error?error.message:"Invalid JSON.";}}
const lines=(text:string)=>text.split(/\r?\n/).map(item=>item.trim()).filter(Boolean);
const validId=(id:string)=>/^[A-Za-z0-9_-]{1,64}$/.test(id);
export function serializeProblem(form:ProblemForm):StructuredProblemDraft {
 if(!form.title.trim()||!form.statement.trim())throw new Error("Enter a title and raw problem statement.");
 if(!form.requirements.length)throw new Error("Add the scored public requirements.");
 const ids=new Set<string>();for(const row of form.requirements){if(!validId(row.id)||ids.has(row.id))throw new Error("Requirement IDs must be unique letters, numbers, hyphens or underscores, up to 64 characters.");if(!row.text.trim())throw new Error("Every requirement needs public text.");ids.add(row.id);}
 if(!form.checks.length)throw new Error("Add checks for both correctness and critical requirements.");
 const checkIds=new Set<string>(),groups=new Set<string>();
 const checks=form.checks.map(row=>{
  if(!validId(row.id)||checkIds.has(row.id))throw new Error("Check IDs must be unique and use the same ID format as requirements.");checkIds.add(row.id);
  if(!row.name.trim())throw new Error("Every check needs a name.");
  const requirement=form.requirements.find(item=>item.id===row.requirementId);if(!requirement)throw new Error("Each check must reference a known requirement.");groups.add(requirement.group);
  if(row.path!==""&&(!row.path.startsWith("/")||/~([^01]|$)/.test(row.path)))throw new Error("Paths must be RFC 6901 JSON Pointers, such as /result.");
  if(row.path.split("/").slice(1).some(part=>dangerous.has(part.replace(/~1/g,"/").replace(/~0/g,"~"))))throw new Error("Prototype-related pointer paths are not allowed.");
  const weight=Number(row.weight);if(!Number.isFinite(weight)||weight<=0||weight>1000)throw new Error("Every check needs a positive weight no greater than 1,000.");
  const expected=parseExpected(row);
  return {id:row.id,name:row.name.trim(),requirementId:row.requirementId,path:row.path,operator:row.operator,...(expected===undefined?{}:{expected}),weight,essential:row.essential,visibility:row.visibility};
 });
 if(!groups.has("C")||!groups.has("K"))throw new Error("Author positive-weight checks in both C (correctness) and K (critical requirements).");
 const schema=parseOutputSchema(form.schemaJson),reference=parseLiteral(form.referenceJson,"Private reference answer");
 if(!reference||typeof reference!=="object"||Array.isArray(reference)||typeof reference.rationale!=="string")throw new Error("The private reference answer must be an object with a rationale string.");
 if(reference.rationale.trim().split(/\s+/).filter(Boolean).length>120)throw new Error("The reference rationale must stay within 120 words.");
 return {kind:"STRUCTURED_JSON",title:form.title.trim(),statement:form.statement,objectives:lines(form.objectives),constraints:lines(form.constraints),requirements:form.requirements.map(row=>({id:row.id,text:row.text.trim(),group:row.group})),outputSchema:schema,checks,referenceAnswer:reference};
}
