# Official model qualification

The local application starts in calibration mode. A working OpenRouter key enables real model calls, but does not certify the provider's complete token bounds or reviewer performance.

Before official use, obtain authoritative evidence for all counted input/output bounds, reasoning/cache semantics, per-request recovery, fixed provider routing and the exact generation/judge/reviewer configuration. Benchmark the solution judge and prepared integrity reviewer on independent, human-labeled cases. Unit tests and model-catalog availability are not those benchmarks.

A reviewed approval manifest must be a JSON file inside this project. MODEL_QUALIFICATION_MANIFEST points to its relative path; OFFICIAL_PROVIDER_QUALIFIED remains false until actual approval. The backend validates APPROVED status, an approver and timestamp, exact model identifiers/bounds, all-output/recovery assertions, authoritative HTTPS references and quality/reviewer benchmark digests. Frozen competition manifests must match the approved models, providers, bounds and reviewer package; a global flag cannot approve a different old draft.

Do not fabricate evidence, benchmark digests or approvals. Missing or invalid evidence leaves the application in local calibration mode. Keep all API keys exclusively in private server configuration.

The authoritative implementation contract is apps/api/src/config.ts and its manifest-matching helpers; the architecture's stronger fairness, privacy, audit and operational requirements still apply to an official deployment.