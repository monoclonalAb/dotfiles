# Reference PRs and files

Use the `gh` CLI when viewing GitHub content, as it allows you to view (with authentication) the content.

If a required reference is inaccessible, report the exact missing source and
whether the cause is authentication, permission, or a moved path; ask for access
or a supplied copy rather than guessing. Do not implement reference-dependent
changes until the required evidence is available. Report the blocker in the
requested output format.

These private references are inputs when implementing KPIs in a consuming
project, not prerequisites for editing this skill's wording. Record the resolved
commit when using a moving `main` URL; fetch related source from that same commit.

## Required references

- Please read https://github.com/everyday-artificial-intelligence/base-DE-template/blob/main/src/utils/kpi.ts. This contains the base logic implemented to get KPIs added.
- In addition to this, review https://github.com/everyday-artificial-intelligence/base-DE-template/blob/main/src/utils/logger.ts and compare against the internal `logger.ts` implementation.
- Please read https://github.com/everyday-artificial-intelligence/base-DE-template/pull/23 as it gives you an high-level overview of what needs to change in this project to support KPIs.

### Example repositories adding KPIs
The following are high-quality PRs that added KPI tracking to existing DE projects.

While not your project you can read here, they are similar enough that you should be able to understand an idea of what KPIs were considered valuable enough to add.

You should read **all** of them to get as much context as possible. The habithealth-de03 one, in particular, lists a table in the PR body of all the KPIs it added, which is good guidance for you to think about!

- https://github.com/everyday-artificial-intelligence/RayWhite-DE03/pull/62
- https://github.com/everyday-artificial-intelligence/habithealth-de03/pull/76
- https://github.com/everyday-artificial-intelligence/ckc-de05/pull/23

## Notes to capture while reading references

- Which files changed for KPI support
- KPI naming and units
- Where `workflow` is assigned
- Error/failure handling KPI behavior
- Any required dependency additions
