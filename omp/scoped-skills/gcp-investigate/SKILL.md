---
name: gcp-investigate
description: Read-only-first Google Cloud investigation for Everyday AI DE services — resolve the correct project, then check service state, logs, error groups, traces, metrics, and alerts with an explicit --project, recording evidence. Use when asked to investigate production errors, latency, deploys, scheduler runs, or KPI events. Mutations are out of scope without explicit user intent.
---

# GCP investigation

Investigation is read-only. The gcloud MCP allowlist enforces this and the observability MCP is read-only by design; nothing in this procedure changes cloud state.

## Prerequisites

- The tracked OMP defaults enable `gcloud` and `gcp-observability`; check the
  current session's actual tools. If absent, use reviewed read-only CLI equivalents
  when available, with the same explicit project and resource scope. Do not enable
  servers or widen the allowlist as an investigation side effect.
- Working credentials: check with `gcloud auth list` without inspecting token
  stores. On expiry, ask the user to complete `gcloud auth login` (CLI) and
  `gcloud auth application-default login` (observability ADC); the organisation's
  reauthentication policy expires both at once.

## 1. Resolve the project — never trust the default

- Read `.everyday.json` in the repository root for the project id; otherwise use the map: `habithealth-de01`/`habithealth-de02`/`habithealth-de03` → `habithealth`; `de-dashboard` → `eai-internal`; `raywhite-ai` → `raywhite-417614`; `rock-rubble-ai` → `rockandrubble`; `base-DE-template` → the placeholder in `.everyday.json`.
- The gcloud default project is `eai-internal`, so an omitted `--project` silently returns another project's resources. Every gcloud and `bq` invocation carries the project explicitly; observability MCP calls name the project id.
- The known DE Cloud Run convention is `us-central1`; verify against this
  repository's deployment configuration rather than inferring a new service's region.
- State the resolved project once at the start; never switch project or environment mid-investigation without saying so.

## 2. Fix the timeframe

Convert the reported symptom time to UTC and record the window before querying. All evidence is quoted against this window.

## 3. Ordered checks

1. **Service state** — `gcloud run services describe` and `gcloud run revisions
   list`/`describe`: current revision, deploy time, image tag. A symptom starting
   at a deploy boundary makes that deploy the first hypothesis to test, not an
   established cause.
2. **Logs** — `list_log_entries` with project, resource filter, and the UTC window; widen only if empty.
3. **Recurring errors** — `list_group_stats` for stack-trace groups in the window.
4. **Traces** — `list_traces` / `get_trace` for latency and cross-service questions.
5. **Metrics** — `list_time_series` (request count, latency, instance count) around the window.
6. **Alerts** — `list_alerts` / `list_alert_policies` for anything already firing.
7. **Schedulers and queues** — allowlisted `gcloud scheduler jobs describe` / `tasks queues describe` when the symptom involves a scheduled workflow.

## KPI telemetry is separate

KPI events — Pub/Sub topic `kpi-events` and BigQuery `eai-internal.kpi.kpi_events` — always live in `eai-internal`, whatever the service's own project. Query them with `bq --project_id=eai-internal …` from bash; never look for KPI data in the service project.

## Evidence

Every reported finding carries: project id, resource name, UTC time range, the exact filter or query string, and the observed value. A claim without these is not reportable — re-run the query and capture them.

## Safety boundary

- Any mutation — deploy, environment change, scheduler pause, IAM change — is outside this skill. It requires the user to name the action, project, and resource explicitly, and it runs via bash `gcloud` only after that confirmation.
- Never widen `gcloud-mcp-allowlist.json` as a side effect of an investigation; the widening procedure lives in `~/.omp/agent/TOOLING.md`.

## Do not use when

- The system under investigation is not on Google Cloud.
- The task is analytics beyond KPI checks — that is a BigQuery task in its own right.
- The user is asking for a change, not an investigation.
