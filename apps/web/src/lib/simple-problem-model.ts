import type { StructuredProblemDraft } from "./problem-editor-model";

export interface SimpleProblemForm {
 title: string;
 statement: string;
 objectives: string;
 constraints: string;
 answerType: "number" | "text";
 expectedAnswer: string;
 explanation: string;
}

const OUTPUT_CONSTRAINT = "Return one JSON object containing result and rationale, with no additional fields.";
const EXPLANATION_REQUIREMENT = "Include a brief explanation in rationale using 1 to 2,000 characters and at most 120 words.";
const EXACT_TEXT_CONSTRAINT = "The text result is graded by exact capitalization, spacing and punctuation; alternative wording does not satisfy the answer check.";

export function createSimpleProblem(title = ""): SimpleProblemForm {
 return { title, statement: "", objectives: "", constraints: "", answerType: "number", expectedAnswer: "", explanation: "" };
}

function text(value: unknown, name: string, max: number, required = true): asserts value is string {
 if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
  throw new Error(name + (required ? " is required and must be " : " must be ") + "no longer than " + max.toLocaleString("en-US") + " characters.");
 }
}
function lines(value: string, name: string, maxItems: number): string[] {
 const items = value.split(/\r\n|\r|\n/).filter(item => item.trim().length > 0);
 if (items.length > maxItems) throw new Error(name + " has too many lines.");
 for (const item of items) text(item, name + " line", 2000);
 return items;
}
function templateConstraints(answerType: SimpleProblemForm["answerType"]): string[] {
 return [OUTPUT_CONSTRAINT, EXPLANATION_REQUIREMENT, ...(answerType === "text" ? [EXACT_TEXT_CONSTRAINT] : [])];
}
function numericAnswer(value: string): number {
 const input = value.trim();
 if (!input || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(input)) {
  throw new Error("Enter one numeric answer, such as 42 or -2.5. Expressions and code are not accepted.");
 }
 const parsed = Number(input);
 if (!Number.isFinite(parsed)) throw new Error("The expected numeric answer must be finite.");
 if (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)) throw new Error("The expected whole-number answer exceeds the safely supported range.");
 return parsed;
}

export function buildSimpleProblem(form: SimpleProblemForm): StructuredProblemDraft {
 if (!form || (form.answerType !== "number" && form.answerType !== "text")) throw new Error("Choose a numeric or text answer.");
 text(form.title, "Problem title", 160);
 text(form.statement, "Problem statement", 32000);
 text(form.objectives, "Objectives", 100000, false);
 text(form.constraints, "Constraints", 100000, false);
 text(form.expectedAnswer, "Expected answer", form.answerType === "number" ? 100 : 2000);
 text(form.explanation, "Reference explanation", 2000);
 const wordCount = form.explanation.trim().split(/\s+/u).filter(Boolean).length;
 if (wordCount < 1 || wordCount > 120) throw new Error("The reference explanation must contain 1 to 120 words.");
 const expected = form.answerType === "number" ? numericAnswer(form.expectedAnswer) : form.expectedAnswer;
 const fixedConstraints = templateConstraints(form.answerType);
 return {
  kind: "STRUCTURED_JSON",
  title: form.title.trim(),
  statement: form.statement,
  objectives: lines(form.objectives, "Objectives", 50),
  constraints: [...lines(form.constraints, "Constraints", 50 - fixedConstraints.length), ...fixedConstraints],
  requirements: [
   { id: "correct-answer", text: form.answerType === "number" ? "Return the correct numeric answer to the stated problem." : "Return the exact correct text answer to the stated problem, including capitalization, spacing and punctuation.", group: "C" },
   { id: "explanation", text: EXPLANATION_REQUIREMENT, group: "K" }
  ],
  outputSchema: {
   type: "object",
   properties: {
    result: form.answerType === "number" ? { type: "number" } : { type: "string", minLength: 1, maxLength: 2000 },
    rationale: { type: "string", minLength: 1, maxLength: 2000 }
   },
   required: ["result", "rationale"],
   additionalProperties: false
  },
  checks: [
   { id: "correct-answer", name: "Correct answer", requirementId: "correct-answer", path: "/result", operator: "equals", expected, weight: 1, essential: true, visibility: "private" },
   { id: "explanation", name: "Explanation included", requirementId: "explanation", path: "/rationale", operator: "exists", weight: 1, essential: true, visibility: "private" }
  ],
  referenceAnswer: { result: expected, rationale: form.explanation }
 };
}

function canonical(value: unknown, depth = 0): string {
 if (depth > 24) throw new Error("Draft nesting is too deep.");
 if (Array.isArray(value)) return "[" + value.map(item => canonical(item, depth + 1)).join(",") + "]";
 if (value !== null && typeof value === "object") {
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key], depth + 1)).join(",") + "}";
 }
 const encoded = JSON.stringify(value);
 if (encoded === undefined) throw new Error("Draft contains non-JSON data.");
 return encoded;
}

export function inferSimpleProblem(draft: StructuredProblemDraft | null | undefined): SimpleProblemForm | null {
 try {
  if (!draft || draft.kind !== "STRUCTURED_JSON" || !Array.isArray(draft.objectives) || !Array.isArray(draft.constraints)) return null;
  const reference = draft.referenceAnswer;
  if (!reference || typeof reference !== "object" || Array.isArray(reference) || typeof reference.rationale !== "string") return null;
  const answerType = typeof reference.result === "number" ? "number" : typeof reference.result === "string" ? "text" : null;
  if (!answerType) return null;
  const fixedConstraints = templateConstraints(answerType);
  if (draft.constraints.length < fixedConstraints.length) return null;
  const form: SimpleProblemForm = {
   title: draft.title,
   statement: draft.statement,
   objectives: draft.objectives.join("\n"),
   constraints: draft.constraints.slice(0, -fixedConstraints.length).join("\n"),
   answerType,
   expectedAnswer: String(reference.result),
   explanation: reference.rationale
  };
  // A structural comparison prevents guided mode from dropping any advanced rule.
  return canonical(buildSimpleProblem(form)) === canonical(draft) ? form : null;
 } catch {
  return null;
 }
}