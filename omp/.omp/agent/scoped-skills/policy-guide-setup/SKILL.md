---
name: policy-guide-setup
description: >-
  Adds the customer-facing policy guide pattern to an established digital employee (DE):
  copies the policy interface from base-DE-template, then mines the DE's existing code to
  generate the settings file and inline policyAssumption markers. Use when asked to add a
  policy guide, policy doc, policy settings, or customer policy page to a DE, or to wire a
  DE up to Deploy Guardian's policy checks.
---

# Add the policy guide pattern to an existing DE

Every DE declares its configurable behaviour in one typed settings file. The DE reads that
file at runtime; Deploy Guardian publishes it to Firestore on deploy (or manually), where
it is served as a password-gated web page for the customer. Because the page is generated
from the file the DE actually runs on, it cannot describe behaviour that doesn't exist.

This skill assumes the DE already has working code. The job is: copy the interface, then
**describe what the code already does** — never change what it does.

## The cardinal rule

Wiring a setting must not change the DE's behaviour. Every `.default()` must equal the
value currently hardcoded, bug-for-bug: if the code matches on a quirky substring or has
an off-by-one nobody noticed, the setting preserves it and the description describes it.
Pin the current behaviour with differential tests before wiring, so the refactor is
provably a no-op. Behaviour fixes are separate PRs.

## Step 1 — Copy the interface from base-DE-template

Pull these from GitHub — `everyday-artificial-intelligence/base-DE-template` — never
from memory and never from a local checkout, which may be stale:

```sh
gh api repos/everyday-artificial-intelligence/base-DE-template/contents/src/policy/index.ts --jq .content | base64 -d
```

(or `gh repo clone` to a temp directory and copy from there). If `gh` is not
authenticated or the fetch 404s, stop and ask the user — for access (`gh auth login`),
or for where the template now lives if it has moved. Do not substitute hand-written
versions of these files.

What to take:

| From template | Purpose |
|---|---|
| `src/policy/index.ts` | `initPolicy()` / `getPolicy()` / `policyAssumption()` — identical for every DE, do not modify |
| `src/policy/settings.ts` | Stub to fill in (step 3) |
| `src/policy/assumptions.ts` | Staging file for pre-code assumptions — on an established DE it stays empty; markers go next to real code |
| `src/policy/README.md` | Dev docs, copy as-is |
| `.github/workflows/publish-policy.yml` | Manual publish workflow (`workflow_dispatch`) |
| `infra/publish-policy.sh` | Local trigger for it (`gh workflow run`); add `"policy:publish": "bash infra/publish-policy.sh"` to package.json scripts |

Placement: TypeScript DEs use `src/policy/` (imported as `@/policy/index.js`); older
JavaScript/Next DEs use root-level `policy/` with `.js` files (convert types to JSDoc —
see `ckc-ai/policy/` for a worked example). Deploy Guardian looks in both places.

Constraints the pipeline enforces on `settings.{ts,js}`: it may only import `zod` (the
publisher executes it standalone), and TS must be erasable syntax only (no enums or
namespaces — it runs under Node type stripping, not tsc).

## Step 2 — Mine the code for settings candidates

Read the DE's workflows, services, and prompts looking for hardcoded behaviour knobs:

- **Numbers**: thresholds, confidence cutoffs, day/month windows, retry counts, batch
  caps, lookback periods.
- **Lists**: council/customer/category names given special treatment.
- **Booleans**: behaviour that is on but could conceivably be turned off — greetings,
  rewriting, BCC copies, tag honouring, feature branches in prompts.
- **Records**: the same window/threshold varied by category (system type, region).

A candidate qualifies as a **setting** only if all three hold:

1. It is a choice a customer could meaningfully want changed (not plumbing).
2. The alternative actually works — flipping it must not break the DE. A "setting" whose
   other value is untested is a lie on the page.
3. The code reads it. Deploy Guardian **blocks any deploy** with a declared setting that
   nothing reads.

Five types: `boolean`, `number`, `enum`, `list`, `record`. Every setting carries
`.meta()` with `group` (one of `scope | checks | limits | behaviour`), `label` (plain
language, no camelCase), `description` (written for the customer, consequences included),
`unit` for numbers/records, `keyLabels` for records, `itemType` for lists, and
`customerVisible: false` for internal plumbing that still deserves declaring.

Fill `policyConfig` while there: `customerSlug` (kebab-case, no DE name in it,
**permanent** — it is the Firestore doc id and changing it orphans the changelog),
`customerAlias`, `deAlias`, `accessPassword` (soft gate, not a security boundary; deploys
block while it is empty).

## Step 3 — Wire the settings in

At the top of each entry point (every API route in a per-request runtime):

```ts
await initPolicy();
```

Then replace each hardcoded value with a read:

```ts
const { signatureConfidenceThreshold } = getPolicy();
```

Work one setting at a time, running the DE's tests between each. Where the hardcoded
value had a quirk, keep the quirk (see the cardinal rule) and add a short do-not-fix
comment at the site.

## Step 4 — Mark the assumptions

Behaviour with no off switch is an **assumption**, not a setting. Hunt especially for
silent-skip paths — records dropped with no trace, missing data treated as "skip", error
paths that swallow work — those are exactly what customers get surprised by. Declare each
next to the code that implements it:

```ts
policyAssumption({
  statement: "Reminder emails are saved as drafts. The agent never sends them.",
  consequence: "Nothing reaches the customer until a person presses send.",
});
```

Rules: the statement is the identity — unique, no ids; every marker states a
`consequence` (what the customer would not otherwise know); `group` only when it
genuinely belongs in another section — most assumptions stay ungrouped or the
Assumptions section hollows out; `customerVisible: false` exists but is rare.

## Step 5 — Verify

- Combined budget: settings + assumptions ≤ 40 items, or the page stops being readable.
- Run Deploy Guardian's check (`gh repo clone everyday-artificial-intelligence/deploy-guardian`
  to a temp directory if it isn't already local):
  `node <deploy-guardian>/policy-guardian/check.mjs --repo . --manual`
  (`--manual` waives only the "setting never read" rule; structural failures still block).
- Copy the policy test patterns from `ckc-ai/policy/__tests__/` — metadata completeness,
  every-setting-is-read, marker uniqueness, and differential tests pinning behaviour.
- To see the rendered page, publish to the dev collection (`policies-dev`) and view it
  through the policy viewer — there is no local render mode.

## Step 6 — Publish

- Manually, any time (works before wiring is finished): `pnpm run policy:publish` —
  needs the `gh` CLI; credentials stay in org secrets.
- Automatically on every tagged deploy through Deploy Guardian, which also blocks on
  declaration failures and Slack-warns (never blocks) when its AI review finds code
  changes the page doesn't describe.

Both paths write the same Firestore document; identical content writes nothing.
