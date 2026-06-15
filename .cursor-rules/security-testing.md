# Security And Testing Cursor Rules

## Overview

Use these rules for API routes, auth checks, project hierarchy, billing, licensing, audit logs, and tests.

## Authorization

- Server routes must enforce authorization. UI checks are not authorization.
- Project routes must validate organisation membership.
- Enterprise routes in the private repo must enforce entitlement or billing-admin checks on the server.
- RBAC, audit, billing, licensing, seats, and entitlement route implementations must stay out of CE and live under `openlit-enterprise/src/client/src/ee/**`; enterprise `app/api/**` files should be thin Next.js wrappers only.
- Database config selection must be scoped to the current project.
- CE must not contain enterprise audit, billing, licensing, or entitlement implementation beyond OSS-safe contracts and disabled/no-op fallbacks.

## Input Handling

- Parse JSON with a helper or try/catch.
- Malformed JSON should return `400`.
- Validate names and identifiers before calling library mutation functions.
- Use messages from `src/client/src/constants/messages/en.ts` for user-facing validation errors.
- Enterprise-only validation messages belong in the private repo's `src/client/src/ee/constants/messages/en.ts`.

## Audit And Secrets

- Do not persist raw passwords, tokens, cookies, API keys, license keys, authorization headers, or session values.
- Audit metadata must redact sensitive request fields.

## Extension Points

- Shared code may import stable extension hooks only when CE provides an OSS-safe no-op fallback.
- Common/shared behavior belongs in CE first, then should be synced into `openlit-enterprise`.
- Enterprise implementations for those hooks must live under `src/client/src/ee/**` in `openlit-enterprise`.
- Keep tests covering the CE fallback behavior when a shared hook is added.

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
