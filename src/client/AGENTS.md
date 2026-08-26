# Client instructions

These instructions supplement the repository-root `AGENTS.md`.

- The Next.js client lives here; preserve project-scoped data access and the
  CE/OSS boundary from the root instructions.
- Keep user-facing strings in `src/constants/messages/en.ts`.
- Validate affected client work with `npm run lint`, `npm run typecheck`, and
  relevant Jest tests (`npm test -- --runInBand <path>`).
