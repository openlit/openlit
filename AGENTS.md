# OpenLIT Agent Rules

## CE/OSS Boundary

- This repository is the open-source CE/OSS codebase.
- Do not add enterprise implementation here.
- CE may contain shared contracts, neutral extension hook types, empty feature lists, disabled feature placeholders, upgrade-required responses, and OSS-safe no-op extension fallbacks.
- CE must not contain enterprise permission names, RBAC policy maps, entitlement feature maps, paid-plan branching, enterprise imports, or private implementation details.
- Enterprise implementation belongs in `openlit-enterprise/src/client/src/ee/`.
- RBAC, audit log, billing, licensing, seats, entitlements, enterprise stores/selectors, enterprise route handlers, and enterprise UI must stay out of CE and live under `openlit-enterprise/src/client/src/ee/**`.
- Common/shared behavior must be implemented here in CE first, then synced into `openlit-enterprise`; enterprise `app/**` route/page files should be thin wrappers only when they need Next.js filesystem routing.

## Extension Points

- Shared code may import a stable extension hook only when CE provides a no-op fallback.
- Shared imports must use neutral paths such as `@/lib/access/route-access`, `@/components/rbac/feature-access`, or `@/store/enterprise`. Enterprise implementations are selected by the enterprise repo's path aliases or thin wrappers.
- Never import `@/ee/**` from CE or from shared/common files. `@/ee/**` imports are allowed only inside `src/client/src/ee/**` and EE-only tests.
- CE fallback APIs should expose feature-agnostic keys such as `dashboard.read`, not permission literals such as `dashboard:read`.
- Do not import private enterprise modules from CE.
- Keep CE messages in `src/client/src/constants/messages/en.ts`; enterprise-only messages belong in `src/client/src/ee/constants/messages/en.ts` in the private repo.

## Project Hierarchy

- The hierarchy is `Organisation -> Project -> Database configuration`.
- Database config reads, writes, selection, and ping state must be scoped by current project.
- Billing, licensing, seats, and entitlements are organisation-scoped in enterprise.

## Validation

- Add tests for changed security boundaries.
- Run focused tests and `npm run lint` from `src/client` before handoff.
- Before handoff, scan CE for accidental enterprise leakage:

```bash
rg -n "@/ee/" src/client/src
rg -n '"[a-z_]+:[a-z_]+"' src/client/src
```

The second scan may find non-RBAC strings such as CSS variants, cache keys, or encrypted-value prefixes. Review every match and keep RBAC permission literals out of CE.
