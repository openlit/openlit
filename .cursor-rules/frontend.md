# Frontend Cursor Rules

## Overview

Use these rules for OpenLIT client UI work in `src/client/src`.

## Styling

- Match the existing settings and telemetry page classes for light and dark mode.
- Avoid one-off palettes and hard-coded colors unless the surrounding component already uses them.
- Keep filter and pagination controls compact on data-heavy pages.
- Do not place cards inside cards.
- Keep headers, toolbars, tables, and empty states readable in both themes.

## Text

- Do not hard-code user-facing strings.
- Add strings to `src/client/src/constants/messages/en.ts`.
- Do not add enterprise-only strings here; those belong in `src/client/src/ee/constants/messages/en.ts` in `openlit-enterprise`.
- Use existing message keys before adding new ones.

## Enterprise Boundary

- Do not add enterprise implementation to CE.
- Common/shared behavior belongs in CE first, then should be synced into `openlit-enterprise`.
- CE may include OSS-safe no-op extension fallbacks used by shared code.
- Enterprise-only UI, providers, stores, selectors, types, and feature pages belong under `src/client/src/ee/` in `openlit-enterprise`.
- RBAC UI must stay out of CE and live under `openlit-enterprise/src/client/src/ee/**`; enterprise `app/**` pages should be thin wrappers only.

## Project Hierarchy UI

- Header should show organisation and project switching.
- Breadcrumbs belong below the header.
- Settings should present `Organisation -> Project -> Database configuration` in that order.
- Project switching must refresh database config list and active ping state.

## Quality Checklist

- [ ] Light and dark mode are both checked.
- [ ] Text uses CE `messages/en.ts`, with no enterprise-only copy added to CE.
- [ ] Project-scoped UI refreshes after organisation or project changes.
- [ ] Loading, empty, disabled, and error states are covered.
