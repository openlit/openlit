# Contributing to OpenLIT

Thanks for helping improve OpenLIT. Contributions of code, documentation, bug
reports, and integration feedback are all welcome.

## Before you start

- Read the [README](README.md) and the applicable component README for setup.
- Read [AGENTS.md](AGENTS.md) for repository-wide engineering and CE/OSS
  boundaries.
- For a substantial change, open or discuss an issue first so maintainers can
  confirm the scope. Small documentation fixes can go straight to a pull
  request.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development workflow

1. Fork the repository and clone your fork.

   ```bash
   git clone https://github.com/YOUR_USERNAME/openlit.git
   cd openlit
   ```

2. Create a focused branch.

   ```bash
   git switch -c fix/short-description
   ```

3. Make the change, including tests and documentation when they are relevant.
   Keep unrelated formatting and refactors out of the pull request.

4. Run the focused checks for the component you changed. For client changes,
   run at least:

   ```bash
   cd src/client
   npm run lint
   ```

   The relevant README, package scripts, and CI workflow describe additional
   component-specific checks.

5. Commit with a clear subject, push your branch, and open a pull request
   against `main`. PR titles must use Conventional Commit form, for example
   `feat: add trace filters` or `fix(client): handle empty projects`.

   ```bash
   git commit -m "fix: describe the change"
   git push origin fix/short-description
   ```

## Pull requests

- Explain the problem and the solution; link the related issue when one exists.
- Use a title in the form `type: concise lowercase summary` or
  `type(scope): concise lowercase summary`. Allowed types are `feat`, `fix`,
  `docs`, `chore`, `refactor`, `test`, `ci`, `build`, `perf`,
  `style`, and `revert`.
- Include tests for behavior changes and update user-facing documentation.
- Rebase or merge the current `main` before requesting review if your branch is
  behind.
- Complete the pull-request template honestly. Maintainers may ask for changes
  to keep a contribution safe, focused, and maintainable.

## Issues and questions

Search existing [issues](https://github.com/openlit/openlit/issues) before
opening a new one. Bug reports should include reproducible steps, expected and
actual behavior, and relevant non-sensitive logs. For feature ideas or general
questions, use [GitHub Issues](https://github.com/openlit/openlit/issues) or
the community links in the [README](README.md).

Do not report security vulnerabilities in a public issue; follow
[SECURITY.md](SECURITY.md) instead.
