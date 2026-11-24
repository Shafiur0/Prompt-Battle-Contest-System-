# Organizer problem authoring

Select a competition and open Organizer → Problem. You can author a draft or save a new revision after publication. Every attempt retains its original problem, schema, tests, registry and rules; later revisions apply to new attempts. Saving does not reopen a closed workspace, reset tokens or change final answers.

## What to enter

- A problem title and complete public statement.
- Public objectives, constraints and scored requirements. Each requirement has a stable ID and belongs to correctness C or critical requirements K.
- The public JSON output schema. The first custom type requires a `rationale` string for the existing qualitative score.
- Public or hidden deterministic checks: requirement ID, JSON Pointer, operator, expected JSON value where relevant, weight and essential flag.
- A private reference answer used to validate the schema/check configuration. It is never supplied to participants or the generation model.

Save validates the entire configuration and appends a problem version. It does not generate an AI answer or train a reviewer. The reference is a validation fixture, not an exact full-answer target; different correct rationales can pass.

## Small configuration example

Public statement: Calculate the product of 6 and 7. Return the result and briefly explain it.

Objective: Return the correct product.

Constraint: The result must be a nonnegative integer.

Scored requirements:

| ID | Public requirement | Group |
|---|---|---|
| PRODUCT | Return the product of 6 and 7 | C |
| NONNEGATIVE | Return a nonnegative result | K |

Public output schema:

```json
{
  "type": "object",
  "properties": {
    "result": { "type": "integer" },
    "rationale": { "type": "string", "maxLength": 2000 }
  },
  "required": ["result", "rationale"],
  "additionalProperties": false
}
```

Checks:

| Requirement | Pointer | Operator | Expected JSON | Visibility | Essential |
|---|---|---|---|---|---|
| PRODUCT | /result | equals | 42 | private | yes |
| NONNEGATIVE | /result | gte | 0 | public | yes |

Private reference answer:

```json
{"result":42,"rationale":"Multiplying 6 by 7 gives 42, which is a nonnegative integer."}
```

Do not include private reference/check values in the public statement unless they are intentionally public. Hidden checks must implement requirements stated in the public task; they must not add secret mandatory business rules.

## Safe checks and publication

The initial editor supports bounded JSON shape/type rules and a fixed literal check vocabulary. It does not execute scripts, regular expressions, remote schema references or arbitrary expressions. JSON Pointers select values in the saved answer, not executable code.

Configure the Information Registry separately after saving the problem. Required facts remain reusable. Any protected passage must be an exact, nonessential public source quote under an explicitly published rule. Changing the statement cannot silently carry invalid old protected ranges.

Review the problem, reference/check validation, information registry, deadlines and AI configuration before publishing. Publication records problem and policy versions. Later saves append linked revisions without changing the frozen model, review mode, budget or deadlines. Participants still manually write prompts and use the fixed model and allowance. New-round copying decisions and published deductions are automatic after whole-competition closure; uncertainty remains pending. Manual bans are separate. Removal is draft-only.

## Correct-completion timing

The earliest correct answer for the selected task revision breaks equal-score new-round rankings. It must pass the original schema and have C=1 and K=1; eligibility alone is insufficient. Timing uses server receipt measured from the frozen competition start, adds no points, and cannot come from a different task revision.
