---
description: Explain a topic like I'm five with a disposable visual HTML preview
argument-hint: "<topic>"
---
# ELI5 visual explainer

Explain this topic to someone with no background knowledge:

Topic: ${ARGUMENTS:-the topic I provide next}

Create a self-contained HTML explainer with big, clear visuals and very few
words. Prefer simple diagrams, labels, arrows, and one idea per visual. Keep
CSS, SVG, and JavaScript inline; do not fetch external assets or make network
requests.

The HTML is disposable. Handle its lifecycle exactly as follows:

1. Set `umask 077`, then create one private temporary directory outside the
   current project with `mktemp -d "${TMPDIR:-/tmp}/pi-eli5.XXXXXX"`. Keep the
   path in a shell variable and register an `EXIT`/`INT`/`TERM` cleanup trap
   immediately, so errors and interruptions also attempt cleanup.
2. Write the page only to `index.html` inside that directory. Do not write it
   into the repository, a project output directory, `~/.pi`, or any other
   persistent location, and do not make copies.
3. Preview or open the page while it exists if a supported local/browser
   mechanism is available.
4. Before finishing, remove the exact temporary directory and verify that it no
   longer exists. If a preview process needs the file, close or stop that
   process first. Never use a broad wildcard or delete a directory you did not
   create.
5. If cleanup fails, retry using only the recorded directory path and report the
   failure prominently; never claim that the artifact was deleted when it was
   not.

After cleanup, give a concise explanation in the response. Do not leave an HTML
copy or a persistent file link in the project.
