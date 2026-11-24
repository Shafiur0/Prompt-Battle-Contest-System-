import test from "node:test";
import assert from "node:assert/strict";
import { buildSimpleProblem, createSimpleProblem, inferSimpleProblem } from "../src/lib/simple-problem-model.ts";
import { buildStructuredProblem, evaluateStructuredJsonAnswer, stableUuid } from "@prompt-battle/core";

const ids = Object.fromEntries(["problemId", "versionId", "registryId", "registryVersionId", "policyVersionId"].map(key => [key, stableUuid("simple-problem-test:" + key)]));
function numberForm(expectedAnswer = "42") {
 return { ...createSimpleProblem("  A manually written task  "), statement: "  Calculate six times seven.\r\nKeep this original text.  ", objectives: "Find the product", constraints: "Use the supplied operands", expectedAnswer, explanation: "Six groups of seven make forty-two." };
}
function textForm() {
 return { ...numberForm(), answerType: "text", statement: "Return the stated code phrase with its original punctuation.", expectedAnswer: "  Team \"Blue\" \\ ready!  ", explanation: "This preserves the exact code phrase given in the public task." };
}
function problem(form) { return buildStructuredProblem(buildSimpleProblem(form), ids); }

test("the simple form starts blank and never authors a reference answer", () => {
 assert.deepEqual(createSimpleProblem("Example"), { title: "Example", statement: "", objectives: "", constraints: "", answerType: "number", expectedAnswer: "", explanation: "" });
 assert.throws(() => buildSimpleProblem(createSimpleProblem()), /title/i);
});

test("numeric templates accept negative and decimal answers while real checking rejects wrong values", () => {
 for (const [input, value] of [["42", 42], ["-7", -7], ["-2.5", -2.5], [".125", 0.125], ["1e-3", 0.001]]) {
  const p = problem(numberForm(input));
  assert.equal(p.structured.referenceAnswer.result, value);
  const correct = evaluateStructuredJsonAnswer(JSON.stringify({ result: value, rationale: "The calculation gives this value." }), p);
  assert.equal(correct.C, 1); assert.equal(correct.K, 1); assert.equal(correct.eligible, true);
  const wrong = evaluateStructuredJsonAnswer(JSON.stringify({ result: value + 1, rationale: "This is a wrong-answer control." }), p);
  assert.equal(wrong.eligible, false); assert.ok(wrong.C < 1);
 }
});

test("text templates preserve quotes, backslashes and surrounding spaces with exact public matching rules", () => {
 const f = textForm(), draft = buildSimpleProblem(f), p = problem(f);
 assert.equal(draft.referenceAnswer.result, f.expectedAnswer);
 assert.ok(draft.constraints.some(value => /exact capitalization, spacing and punctuation/.test(value)));
 assert.equal(evaluateStructuredJsonAnswer(JSON.stringify({ result: f.expectedAnswer, rationale: "The text is copied from the required public facts." }), p).eligible, true);
 assert.equal(evaluateStructuredJsonAnswer(JSON.stringify({ result: f.expectedAnswer.trim(), rationale: "Spacing has changed." }), p).eligible, false);
 assert.equal(evaluateStructuredJsonAnswer(JSON.stringify({ result: f.expectedAnswer.toLowerCase(), rationale: "Capitalization has changed." }), p).eligible, false);
});

test("the exact raw public statement and manually supplied explanation remain unchanged", () => {
 const f = numberForm(); f.explanation = "  A manual explanation with its original spacing.  ";
 const draft = buildSimpleProblem(f);
 assert.equal(draft.title, "A manually written task");
 assert.equal(draft.statement, f.statement);
 assert.equal(draft.referenceAnswer.rationale, f.explanation);
 assert.equal(problem(f).structured.baseStatement, f.statement);
});

test("private expected answers never enter the generated public statement or public schema", () => {
 const f = { ...textForm(), expectedAnswer: "PRIVATE-ANSWER-9XQ", explanation: "PRIVATE-REFERENCE-8YZ" }, p = problem(f);
 assert.equal(p.statement.includes(f.expectedAnswer), false);
 assert.equal(p.statement.includes(f.explanation), false);
 assert.equal(JSON.stringify(p.structured.outputSchema).includes(f.expectedAnswer), false);
 assert.equal(p.structured.checks[0].visibility, "private");
 assert.equal(evaluateStructuredJsonAnswer(JSON.stringify(p.structured.referenceAnswer), p).publicTests.some(check => check.id === "correct-answer"), false);
});

test("missing, nonfinite, unsafe and executable numeric inputs are rejected without coercion", () => {
 for (const input of ["", " ", "NaN", "Infinity", "1e999", "9007199254740993", "0x2a", "42 + 1", "1; alert(1)", "{}", "null"]) {
  assert.throws(() => buildSimpleProblem(numberForm(input)), /answer|finite|range/i, input);
 }
 assert.throws(() => buildSimpleProblem({ ...numberForm(), answerType: "script" }), /numeric or text/);
 assert.throws(() => buildSimpleProblem({ ...numberForm(), expectedAnswer: { toString() { throw new Error("Do not execute"); } } }), /Expected answer/);
});

test("references require a real short explanation and public bounds reject malformed model output", () => {
 assert.throws(() => buildSimpleProblem({ ...numberForm(), explanation: " " }), /Reference explanation/);
 assert.throws(() => buildSimpleProblem({ ...numberForm(), explanation: Array(121).fill("word").join(" ") }), /120 words/);
 assert.doesNotThrow(() => problem({ ...numberForm(), explanation: Array(120).fill("word").join(" ") }));
 const p = problem(numberForm());
 for (const answer of [{ result: 42, rationale: "" }, { result: "42", rationale: "Wrong numeric type." }, { result: 42, rationale: "Fine", unexpected: true }]) {
  const result = evaluateStructuredJsonAnswer(JSON.stringify(answer), p); assert.equal(result.eligible, false); assert.equal(result.C, 0);
 }
});

test("numeric and text canonical templates round trip without losing public or private configuration", () => {
 for (const f of [numberForm("-2.5"), textForm()]) {
  const draft = buildSimpleProblem(f), inferred = inferSimpleProblem(draft);
  assert.ok(inferred); assert.equal(inferred.statement, f.statement);
  assert.deepEqual(buildSimpleProblem(inferred), draft);
  const reordered = JSON.parse(JSON.stringify(draft));
  reordered.outputSchema = { additionalProperties: false, required: ["result", "rationale"], properties: reordered.outputSchema.properties, type: "object" };
  assert.ok(inferSimpleProblem(reordered));
 }
});

test("inference refuses advanced checks, schema, score or policy changes rather than dropping them", () => {
 for (const change of [
  draft => draft.checks.push({ ...draft.checks[0], id: "extra-check" }),
  draft => { draft.checks[0].weight = 2; },
  draft => { draft.checks[0].visibility = "public"; },
  draft => { draft.checks[0].expected = 99; },
  draft => { draft.outputSchema.properties.result.type = "integer"; },
  draft => { draft.outputSchema.properties.rationale.maxLength = 1000; },
  draft => { draft.requirements[1].text = "An independently authored critical rule."; },
  draft => { draft.constraints[draft.constraints.length - 1] = "An independently authored constraint."; },
  draft => { draft.referenceAnswer.extra = "custom"; }
 ]) {
  const draft = buildSimpleProblem(numberForm()); change(draft); assert.equal(inferSimpleProblem(draft), null);
 }
 assert.equal(inferSimpleProblem(null), null);
 assert.equal(inferSimpleProblem(undefined), null);
});

test("bounded manual fields reject excessive configuration and treat script-looking text as inert data", () => {
 assert.throws(() => buildSimpleProblem({ ...numberForm(), title: "x".repeat(161) }), /title/);
 assert.throws(() => buildSimpleProblem({ ...numberForm(), objectives: Array(51).fill("Objective").join("\n") }), /too many lines/);
 const f = { ...textForm(), expectedAnswer: "<script>alert('fixture')</script>", statement: "Return the literal test string supplied in the task; do not execute it." };
 assert.equal(buildSimpleProblem(f).referenceAnswer.result, f.expectedAnswer);
 assert.equal(inferSimpleProblem(buildSimpleProblem(f)).expectedAnswer, f.expectedAnswer);
});