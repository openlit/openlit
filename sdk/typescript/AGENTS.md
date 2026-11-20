# TypeScript SDK instructions

These instructions supplement the repository-root `AGENTS.md`.

- Read the applicable GenAI instrumentation guide in `../../agent-guides/`
  before changing provider or framework instrumentation.
- Validate with `npm run lint`, `npm run build`, and `npm test`. After changing
  anything that runs on the edge, also run `npm run test:runtimes`.
- Shared code must not import `async_hooks`, `crypto` or `js-tiktoken` directly.
  Use `src/platform`, which the edge build swaps for `platform/index.edge.ts`.
  Files with an `.edge.ts` version must keep the same public API.
- Keep `package.json` and `package-lock.json` consistent; releases own version
  mutation.
