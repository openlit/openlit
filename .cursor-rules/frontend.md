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
- Use existing message keys before adding new ones.

## Project Hierarchy UI

- Header should show organisation and project switching.
- Breadcrumbs belong below the header.
- Settings should present `Organisation -> Project -> Database configuration` in that order.
- Project switching must refresh database config list and active ping state.

## Quality Checklist

- [ ] Light and dark mode are both checked.
- [ ] Text uses `messages/en.ts`.
- [ ] Project-scoped UI refreshes after organisation or project changes.
- [ ] Loading, empty, disabled, and error states are covered.
