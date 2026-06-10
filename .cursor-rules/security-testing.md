# Security And Testing Cursor Rules

## Overview

Use these rules for API routes, auth checks, project hierarchy, billing, licensing, audit logs, and tests.

## Authorization

- Server routes must enforce authorization. UI checks are not authorization.
- Project routes must validate organisation membership.
- Enterprise routes must enforce entitlement or billing-admin checks on the server.
- Database config selection must be scoped to the current project.

## Input Handling

- Parse JSON with a helper or try/catch.
- Malformed JSON should return `400`.
- Validate names and identifiers before calling library mutation functions.
- Use messages from `src/client/src/constants/messages/en.ts` for user-facing validation errors.

## Audit And Secrets

- Do not persist raw passwords, tokens, cookies, API keys, license keys, authorization headers, or session values.
- Audit metadata must redact sensitive request fields.

## Tests

- Add focused tests for every security boundary changed.
- Include invalid JSON tests for new mutation routes.
- Include cross-project denial tests for project-scoped DB config behavior.
- Run full local validation before handoff:

```bash
cd src/client
npm test -- --runInBand
npm run lint
npx prisma validate --schema prisma/schema.prisma
```
