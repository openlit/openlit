// Committed type declarations for Next.js static asset imports (e.g. `*.png`,
// `*.svg`, `*.jpg`). Next normally provides these through the generated
// `next-env.d.ts`, but that file is gitignored and is not present in CI before
// a Next build runs, so `tsc --noEmit` would otherwise fail to resolve image
// imports. Referencing the types here keeps `npm run typecheck` consistent
// between local and CI environments. Duplicate reference directives are safe.
/// <reference types="next/image-types/global" />
