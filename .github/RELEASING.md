# Automated releases

Releases are initiated by pushing one stable SemVer tag from current `main`:

```text
py-X.Y.Z
ts-X.Y.Z
go-X.Y.Z
cli-X.Y.Z
controller-X.Y.Z
otel-gpu-collector-X.Y.Z
openlit-X.Y.Z
```

The tool definitions and version strategies live in `.github/release-tools.json`.
The `Release packages` workflow generates notes for merged PRs that changed
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
- Repository variable `RELEASE_APP_SLUG`: the App actor login, including the
  `[bot]` suffix shown in Actions events
- Optional repository variable `RELEASE_LLM_PRIMARY_MODEL`
- Optional repository variable `RELEASE_LLM_FALLBACK_MODEL`

The model variables default to the reviewed free OpenRouter models in the
release script. Existing npm, PyPI, GHCR, cosign, and Homebrew secrets remain
configured as required by their publisher workflows.

Allow the App to bypass only the `main` rule needed for release-version commits
and the rule preventing updates to a newly created release tag. Restrict release
tag creation to trusted maintainers.

## Dry run

Run `Release packages` manually, enter the next existing-format tag, and keep
`dry_run` enabled. A dry run uses current `main`, calls the configured LLM,
runs component validation, and uploads release notes, metadata, and the version
diff without creating a tag, commit, package, image, or GitHub Release.

## Failure and recovery

- Before the version commit: fix the failure and rerun the workflow. The
  maintainer-created candidate tag remains on its original commit.
- After the version commit but before the tag update: rerun the original run;
  the release trailer makes this state resumable.
- In a publisher or GitHub Release job: use **Re-run failed jobs** so already
  successful package and image jobs are not repeated.
- To abort before mutation, delete the candidate tag. Do not move or delete a
  tag after artifacts have been published.

The component publisher workflows also support manual dispatch with an exact
final tag and commit SHA for targeted recovery.
