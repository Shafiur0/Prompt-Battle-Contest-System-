# OpenRouter integration decisions

Verified source: https://openrouter.ai/api/v1/models and the selected model endpoint catalogs, 20 November 2026.

Generation model: deepseek/deepseek-v4.1-flash-1017. Independent contextual reviewer recommendation: anthropic/claude-sonnet-5.5. Both advertise structured-output support. Sonnet 5.5 does not advertise temperature/top-p/seed in the checked catalog; unsupported parameters must be omitted rather than silently ignored.

Use one server-held OpenRouter key with distinct fixed model profiles, conversations, schemas, purpose and payer records. The shared API credential is the user's chosen transport arrangement; it does not authorize registry/reviewer information in generation context or participant access to the key. Worker/database permissions and case-scoped DTOs maintain the application data boundaries.

Pin provider selection where qualified, disable fallback, and validate reported model/usage identity. Provider availability may change; missing endpoints must become an explicit configuration/incident state, never silent substitution.

Usage receipts and recovery must distinguish missing usage from zero usage. Retain original evidence. Cached and reasoning tokens can be subsets and must not be counted twice. Router-reported and native-provider token fields must be normalized under one frozen, documented accounting policy. A sample success or advertised context window is not proof of a universal charged-token bound.

No key was supplied by the developer or committed in the project. Private key setup is an operator action in .env. Reviewer preparation consists of versioned instructions and examples plus qualification work; this project does not claim custom model fine-tuning.