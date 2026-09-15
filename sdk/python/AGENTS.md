# Python SDK instructions

These instructions supplement the repository-root `AGENTS.md`.

- Package metadata and release version live in `pyproject.toml`; do not change
  versions outside the release workflow.
- Run `pylint $(git ls-files '*.py')`, `poetry check`, and `poetry build` for
  relevant changes.
- Provider tests currently need credentials; do not treat them as hermetic CI
  coverage.
