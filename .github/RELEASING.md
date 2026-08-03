# Automated releases

Repository administrators initiate releases manually from **Actions → Release
packages → Run workflow** on `main`. Select a tool and enter a stable SemVer
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
The `Release packages` workflow generates notes for merged PRs that changed
the selected tool, validates the tool, updates persistent version files when
configured, publishes the artifact, and creates the GitHub Release.

The workflow shows friendly tool names in its dropdown and derives both the tag
and release title from the registry. For example, **Python SDK** version
`1.45.0` creates tag `py-1.45.0` with release title `python-sdk: 1.45.0`.
Release notes end with deduplicated contributor profile avatars for human PR
authors; bot accounts are excluded.

After a PR is merged into `main`, `Cache merged PR release summary` partitions
its files using the same registry, generates one bounded summary per affected
tool, and writes a structured bot comment on the merged PR. Release preparation
validates the comment's merge SHA, changed-file digest, schema, tool, category,
and summary before reuse. Missing, stale, malformed, or non-bot comments are
ignored and regenerated during the release, so this cache cannot block releases.
Patch evidence is capped per file and per tool; filenames and change statistics
remain available for large PRs without sending the complete diff to the model.

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

Create a separate `release-notes` environment for the post-merge cache workflow:

- Environment secret `OPENROUTER_API_KEY`: the OpenRouter API key
- Optional environment variables `RELEASE_LLM_PRIMARY_MODEL` and
  `RELEASE_LLM_FALLBACK_MODEL`, or use the repository variables above

Do not put the release App private key or publishing credentials in the
`release-notes` environment. Restrict its deployment branch policy to `main`.

`Release packages` checks the triggering actor's repository permission before
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

Run `Release packages` manually, select the tool, enter its next `X.Y.Z`
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
