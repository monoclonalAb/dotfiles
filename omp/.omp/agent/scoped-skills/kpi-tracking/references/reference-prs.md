# Reference PRs and files

Use the `gh` CLI when viewing GitHub content, as it allows you to view (with authentication) the content.

If you cannot view the content, you should exit early and tell the user they must authenticate the `gh` CLI tool for you to use. The rest of this skill CANNOT be done unless you view all required reference.

This is more important than any desired output format requested later, as you cannot meet a high quality output if you have bad inputs!

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
