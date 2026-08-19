---
name: llm-eval
description: Select and run evidence-based evaluation for AI features.
---

# LLM evaluation

State explicitly which evaluation or tracing system the project already uses before adding another.

- Use `npx promptfoo@latest` for prompt/dataset matrices and red-team plugins.
- Use `deepeval` for Python metric suites.
- Use self-hosted `arize-phoenix` for OTLP tracing without vendor coupling.
- Use `langfuse` when a prompt registry and datasets matter more than self-hosted tracing.

Make the metric, dataset, threshold, and failure mode explicit. Do not substitute a new platform for an existing one without a concrete gap.
