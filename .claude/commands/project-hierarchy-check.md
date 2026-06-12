# Project Hierarchy Check

Use this command before changing organisation, project, or database config behavior.

1. Confirm this is shared CE behavior. Enterprise-only implementation must stay in `openlit-enterprise/src/client/src/ee/`.
2. Confirm any enterprise extension point has only an OSS-safe no-op fallback in CE.
3. Confirm CE strings go in `src/client/src/constants/messages/en.ts`; enterprise-only strings stay in the private EE message file.
4. Confirm the code follows `Organisation -> Project -> Database configuration`.
5. Check that database config reads and writes are scoped by current project.
6. Check that project list and switch routes validate organisation membership.
7. Check that switching organisation refreshes projects and database config state.
8. Add or update tests for membership denial, selected project, cross-project denial, and invalid JSON.
9. Run:

```bash
cd src/client
npm test -- --runInBand src/__tests__/lib/db-config.test.ts src/__tests__/lib/organisation.test.ts src/__tests__/app/api/organisation/projects-route.test.ts
```
