---
name: pr-validation
description: Full validation workflow for an OpenLIT pull request (security and auth testing across organisations, projects, connectors, and environments; functionality and shortcomings; scale testing with mock data; hard-coded strings; CE/EE docs and code separation; reusable components; design principles; cross-agent verification). Run it only when the user explicitly asks to validate a PR or run the validation workflow, or types /pr-validation. Never start it on your own - when you open or update a PR, finish and push work on a branch, or the user says their PR is ready, ask once "Your PR looks ready. Should I run the validation workflow?" and wait for a yes.
---

# PR review and validation

Follow the canonical workflow in `agent-guides/pr-validation.md`. Read it in full first; this file only adds how to run it in Claude Code.

Only run it on an explicit request (see "When to run" in the guide). If you loaded this skill because a PR looks ready, ask "Your PR looks ready. Should I run the validation workflow?" and stop until the user says yes.

1. **Scope** (section 0): identify the PR and its paired CE or enterprise PR, then build the inventory of changed files, routes, models, migrations, extension points, and strings. Pass that inventory to every lane.
2. **Fan out:** run lanes D to G as parallel subagents with the Agent tool, one per lane, and run lanes A, B, and C one at a time because they start the app (see "Run the app" in the guide). Give each subagent the lane's section of the guide, the inventory, both repo paths, and the report columns. If the Workflow tool is available, run the lanes as a workflow instead, with the same ordering.
3. **Cross-agent verification** (lane H): send each reported finding to a fresh subagent whose only job is to disprove it by reading the code path and reproducing it. Keep confirmed findings; mark the rest Unconfirmed with the reason.
4. **Required checks** (section 2): run them yourself in each affected repo and quote the results.
5. **Report** (section 3): lead with the verdict, then the findings table, what was verified, scale results, and accepted shortcomings. Don't change code unless the requester asks for fixes.

Use each lane's own throwaway database and port for every running app and scale test, and stop the processes you start before you finish.
