# Releasing OpenLIT

Repository administrators initiate releases manually from
**Actions → Release / Packages → Run workflow** on `main`. Select a tool and
enter a stable SemVer
without a prefix, such as `1.45.0`. The workflow constructs its final tag:

```text
py-X.Y.Z
ts-X.Y.Z
go-X.Y.Z
cli-X.Y.Z
controller-X.Y.Z
otel-gpu-collector-X.Y.Z
openlit-X.Y.Z
```

The tool definitions, tag prefixes, and version strategies live in
`.github/release-tools.json`.
The `Release / Packages` workflow generates notes for merged PRs that changed
the selected tool, validates the tool, updates persistent version files when
configured, publishes the artifact, and creates the GitHub Release.

For tools with a persistent version, the source may either still contain the
previous release version or already contain the exact version named by the new
tag. In the latter case the workflow validates the configured version files and
skips the version commit. For npm tools, a manifest already at the requested
version may still have either lockfile root entry at the previous version; the
workflow repairs and commits those entries. Afterward, `package.json`, the
top-level `package-lock.json` version, and `packages[""].version` in the lockfile
must always agree. Any other version drift fails before mutation.

## Repository configuration

Create a GitHub App installed only on this repository with:

- Repository metadata: read
- Repository contents: read and write

Create a `release` Actions environment without human reviewers and configure:

- Environment variable `RELEASE_APP_ID`: the GitHub App ID
- Environment secret `RELEASE_APP_PRIVATE_KEY`: the App private key
- Environment secret `OPENROUTER_API_KEY`: the OpenRouter API key
- Optional repository variable `RELEASE_LLM_PRIMARY_MODEL`
- Optional repository variable `RELEASE_LLM_FALLBACK_MODEL`

`Release / Packages` checks the triggering actor's repository permission before
entering the release environment and fails unless it is `admin`. GitHub may
still display the manual **Run workflow** control to non-admin collaborators,
but their run stops before checkout, LLM access, version mutation, or publishing.
Configure the `release` environment deployment branch policy to allow only
`main` as an additional safeguard.

The model variables default to the reviewed free OpenRouter models in the
release script. Existing npm, PyPI, GHCR, cosign, and Homebrew secrets remain
configured as required by their publisher workflows.

Allow the App to bypass only the `main` rule needed for release-version commits
and the rule governing creation of release tags. Completed tags are never moved.

## Dry run

Run `Release / Packages` manually, select the tool, enter its next `X.Y.Z`
version, and keep `dry_run` enabled. A dry run uses current `main`, calls the
configured LLM, runs component validation, and uploads release notes, metadata,
and the version diff without creating a tag, commit, package, image, or GitHub
Release. Once the dry run is satisfactory, run it again with `dry_run` disabled.

## Failure and recovery

- Before the version commit: fix the failure and start another manual run.
- After the version commit but before tag creation: rerun with the same tool and
  version; the release trailer makes this state resumable without another commit.
- In a publisher or GitHub Release job: use **Re-run failed jobs** so already
  successful package and image jobs are not repeated.
- Do not move or delete a tag after artifacts have been published.

The component publisher workflows also support manual dispatch with an exact
final tag and commit SHA for targeted recovery.

## Workflow layout

Workflow files use responsibility-first names:

- `ci-*.yml` validates a component on pull requests and `main`, and can be
  called by release workflows with an immutable commit SHA.
- `release-*.yml` validates and publishes one component. `release-packages.yml`
  is the only normal human entry point; component workflows expose manual
  dispatch only for targeted recovery.
- `admin-*.yml` and `security-*.yml` contain repository-wide maintenance and
  boundary jobs. Data validation belongs in `ci-*.yml`.

The Python pytest job remains commented in `ci-python.yml` until provider tests
are split into hermetic unit tests and credentialed integration tests. Python
linting and package validation remain active.
