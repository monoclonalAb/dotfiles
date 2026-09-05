---
name: llm-eval
description: Select and run evidence-based evaluation for AI features.
---

# LLM evaluation

Identify the project's existing evaluation/tracing system and canonical command
before proposing another. Prefer existing dependencies and configured model IDs;
do not infer an API identifier or capability from a model's display name.

Before live evaluations, establish dataset privacy, external-write isolation,
provider credentials by availability (never their values), and an authorised cost
or call budget. Tracing can export prompts and tool results; do not enable export
or install a platform as an incidental side effect.

- Use `npx promptfoo@latest` for prompt/dataset matrices and red-team plugins.
- Use `deepeval` for Python metric suites.
- Use self-hosted `arize-phoenix` for OTLP tracing without vendor coupling.
- Use `langfuse` when a prompt registry and datasets matter more than self-hosted tracing.

Record the metric, dataset/version, threshold, failure mode, model/provider,
configuration, and exact command. Compare baseline and candidate on the same
inputs; distinguish stochastic variation from a demonstrated regression or gain.
Report failed cases and blocked live runs explicitly. Do not substitute a new
platform for an existing one without a concrete gap.
