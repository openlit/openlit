# Project Hierarchy Check

Use this command before changing organisation, project, or database config behavior.

1. Confirm the code follows `Organisation -> Project -> Database configuration`.
2. Check that database config reads and writes are scoped by current project.
3. Check that project list and switch routes validate organisation membership.
4. Check that switching organisation refreshes projects and database config state.
5. Add or update tests for membership denial, selected project, cross-project denial, and invalid JSON.
6. Run:

```bash
cd src/client
npm test -- --runInBand src/__tests__/lib/db-config.test.ts src/__tests__/lib/organisation.test.ts src/__tests__/app/api/organisation/projects-route.test.ts
```
