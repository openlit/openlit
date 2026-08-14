# Project Hierarchy Check

Use this command before changing organisation, project, or database config behavior.

1. Confirm this is shared CE behavior. Enterprise-only implementation must stay in `openlit-enterprise/src/client/src/ee/`.
2. Confirm any enterprise extension point has only an OSS-safe no-op fallback in CE.
3. Confirm shared imports use neutral extension paths, not `@/ee/**`.
4. Confirm CE fallback hooks do not expose RBAC permission literals or enterprise entitlement maps.
5. Confirm CE strings go in `src/client/src/constants/messages/en.ts`; enterprise-only strings stay in the private EE message file.
6. Confirm the code follows `Organisation -> Project -> Database configuration`.
7. Check that database config reads and writes are scoped by current project.
8. Check that project list and switch routes validate organisation membership.
9. Check that switching organisation refreshes projects and database config state.
10. Add or update tests for membership denial, selected project, cross-project denial, and invalid JSON.
11. Run:

```bash
cd src/client
npm test -- --runInBand src/__tests__/lib/db-config.test.ts src/__tests__/lib/organisation.test.ts src/__tests__/app/api/organisation/projects-route.test.ts
rg -n "@/ee/" src
rg -n '"[a-z_]+:[a-z_]+"' src
```
