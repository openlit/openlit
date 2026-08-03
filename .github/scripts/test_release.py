import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).with_name("release.py")
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("release", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = release.load_config()

    def test_all_supported_tags(self):
        expected = {
            "py-1.2.3": ("python", "1.2.3"),
            "ts-2.0.0": ("typescript", "2.0.0"),
            "go-0.3.0": ("go", "0.3.0"),
            "cli-1.0.0": ("cli", "1.0.0"),
            "controller-1.2.0": ("controller", "1.2.0"),
            "otel-gpu-collector-0.0.8": ("gpu-collector", "0.0.8"),
            "openlit-2.0.0": ("openlit", "2.0.0"),
        }
        for tag, parsed in expected.items():
            key, version, _ = release.parse_tag(tag, self.config)
            self.assertEqual((key, version), parsed)

    def test_workflow_inventory_and_publishers_are_standardized(self):
        workflow_directory = release.ROOT / ".github" / "workflows"
        components = {
            "python",
            "typescript",
            "go",
            "cli",
            "controller",
            "gpu-collector",
            "openlit",
        }
        expected = {
            *(f"ci-{component}.yml" for component in components),
            *(f"release-{component}.yml" for component in components),
            "admin-enterprise-sync.yml",
            "admin-pr-management.yml",
            "admin-pr-summary.yml",
            "ci-automation.yml",
            "ci-pricing.yml",
            "release-packages.yml",
            "security-oss-boundary.yml",
        }
        actual = {path.name for path in workflow_directory.iterdir()}
        self.assertEqual(actual, expected)

        orchestrator = (workflow_directory / "release-packages.yml").read_text(encoding="utf-8")
        for tool in self.config.values():
            publisher = tool["publisher"]
            self.assertIn(f"./.github/workflows/release-{publisher}.yml", orchestrator)

        pr_summary = (workflow_directory / "admin-pr-summary.yml").read_text(encoding="utf-8")
        self.assertIn("pull-requests: write", pr_summary)
        self.assertNotIn("issues: write", pr_summary)
        self.assertIn("workflow_dispatch:", pr_summary)
        self.assertIn("pr_number:", pr_summary)
        self.assertIn("environment: release-notes", pr_summary)

        pr_management = (workflow_directory / "admin-pr-management.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("environment: release-notes", pr_management)
        self.assertIn("OPENROUTER_API_KEY is not configured", pr_management)

        for tool in self.config.values():
            self.assertIn(f"- {tool['display_name']}", orchestrator)

    def test_tool_and_version_construct_release_tag(self):
        tag, key, version, tool = release.resolve_release_identity(
            self.config, tool_key="gpu-collector", version="0.0.8"
        )
        self.assertEqual(tag, "otel-gpu-collector-0.0.8")
        self.assertEqual((key, version, tool["publisher"]), ("gpu-collector", "0.0.8", "gpu-collector"))

        tag, key, version, tool = release.resolve_release_identity(
            self.config, tool_key="OTel GPU Collector", version="0.0.8"
        )
        self.assertEqual(tag, "otel-gpu-collector-0.0.8")
        self.assertEqual((key, version, tool["release_name"]), ("gpu-collector", "0.0.8", "otel-gpu-collector"))

    def test_tool_and_version_reject_unknown_tool_or_invalid_version(self):
        with self.assertRaises(release.ReleaseError):
            release.resolve_release_identity(self.config, tool_key="unknown", version="1.2.3")
        with self.assertRaises(release.ReleaseError):
            release.resolve_release_identity(self.config, tool_key="python", version="v1.2.3")

    def test_rejects_unstable_or_malformed_tags(self):
        for tag in ("py-1.2", "py-v1.2.3", "py-1.2.3-rc.1", "unknown-1.2.3", "otel-gpu-collector-trigger.github.action"):
            with self.subTest(tag=tag), self.assertRaises(release.ReleaseError):
                release.parse_tag(tag, self.config)

    def test_path_matching_includes_renames(self):
        self.assertTrue(release.path_matches("docs/old.md", ["sdk/python/**"], "sdk/python/old.py"))
        self.assertFalse(release.path_matches("sdk/typescript/index.ts", ["sdk/python/**"]))

    def test_summary_validation_requires_exact_pr_set(self):
        valid = {"items": [{"number": 10, "category": "Fixes", "summary": "Corrects streaming output."}]}
        self.assertEqual(release.validate_summaries(valid, {10})[0]["number"], 10)
        with self.assertRaises(release.ReleaseError):
            release.validate_summaries(valid, {10, 11})
        with self.assertRaises(release.ReleaseError):
            release.validate_summaries({"items": valid["items"] * 2}, {10})

    def test_component_summary_validation_requires_exact_component_set(self):
        value = {
            "items": [
                {"tool": "python", "category": "Fixes", "summary": "Corrects tracing."},
                {"tool": "typescript", "category": "Features", "summary": "Adds tracing."},
            ]
        }
        validated = release.validate_component_summaries(
            value,
            {"python", "typescript"},
        )
        self.assertEqual(set(validated), {"python", "typescript"})
        with self.assertRaises(release.ReleaseError):
            release.validate_component_summaries(value, {"python"})

    def test_merged_pr_summary_cache_round_trips_multiple_tools(self):
        pr = {"number": 10, "merge_commit_sha": "a" * 40}
        components = {
            "python": {
                "tool_name": "Python SDK",
                "category": "Features",
                "summary": "Adds provider instrumentation.",
            },
            "openlit": {
                "tool_name": "OpenLIT",
                "category": "Fixes",
                "summary": "Corrects project selection.",
            },
        }
        body = release.render_summary_comment(pr, components, self.config)
        decoded = release.decode_summary_cache(body, 10, "a" * 40, self.config)
        self.assertEqual(decoded, components)
        self.assertIn("Python SDK · Features", body)
        self.assertIn("OpenLIT · Fixes", body)

    def test_summary_cache_rejects_the_wrong_merge_commit(self):
        pr = {"number": 10, "merge_commit_sha": "a" * 40}
        components = {
            "python": {
                "tool_name": "Python SDK",
                "category": "Fixes",
                "summary": "Corrects streaming output.",
            }
        }
        body = release.render_summary_comment(pr, components, self.config)
        with self.assertRaisesRegex(release.ReleaseError, "merge commit"):
            release.decode_summary_cache(body, 10, "b" * 40, self.config)

    def test_summary_cache_rejects_changed_tool_path_configuration(self):
        pr = {"number": 10, "merge_commit_sha": "a" * 40}
        components = {
            "python": {
                "tool_name": "Python SDK",
                "category": "Fixes",
                "summary": "Corrects streaming output.",
            }
        }
        body = release.render_summary_comment(pr, components, self.config)
        changed_config = json.loads(json.dumps(self.config))
        changed_config["python"]["paths"] = ["different/**"]
        with self.assertRaisesRegex(release.ReleaseError, "configuration"):
            release.decode_summary_cache(body, 10, "a" * 40, changed_config)

    def test_summary_cache_ignores_non_bot_comments(self):
        pr = {"number": 10, "merge_commit_sha": "a" * 40}
        components = {
            "python": {
                "tool_name": "Python SDK",
                "category": "Fixes",
                "summary": "Corrects streaming output.",
            }
        }
        body = release.render_summary_comment(pr, components, self.config)

        class UserCommentGitHub:
            @staticmethod
            def paginated(_endpoint, **_kwargs):
                return [{"user": {"login": "contributor", "type": "User"}, "body": body}]

        self.assertIsNone(
            release.load_cached_pr_components(
                UserCommentGitHub(), 10, "a" * 40, self.config
            )
        )

    def test_release_uses_bot_cache_without_fetching_pr_files(self):
        pr = {
            "number": 10,
            "title": "feat: add provider",
            "html_url": "https://github.test/pulls/10",
            "merged_at": "2026-08-03T00:00:00Z",
            "merge_commit_sha": "a" * 40,
            "base": {"ref": "main"},
        }
        components = {
            "python": {
                "tool_name": "Python SDK",
                "category": "Features",
                "summary": "Adds provider instrumentation.",
            }
        }
        cache_body = release.render_summary_comment(pr, components, self.config)

        class CachedGitHub:
            def get(self, endpoint):
                if endpoint == "/commits/commit-sha/pulls":
                    return [pr]
                raise AssertionError(f"unexpected GET: {endpoint}")

            def paginated(self, endpoint, **_kwargs):
                if endpoint == "/issues/10/comments":
                    return [
                        {
                            "user": {"login": "github-actions[bot]", "type": "Bot"},
                            "body": cache_body,
                        }
                    ]
                raise AssertionError(f"release should not fetch PR files: {endpoint}")

        with mock.patch.object(release, "run", return_value="commit-sha"):
            prs, direct = release.collect_prs(
                CachedGitHub(),
                "py-1.0.0",
                "source-sha",
                self.config["python"]["paths"],
                tool_key="python",
                config=self.config,
            )
        self.assertEqual(direct, [])
        self.assertEqual(prs[0]["cached_summary"], components["python"])

    def test_invalid_cache_falls_back_to_bounded_file_evidence(self):
        pr = {
            "number": 10,
            "title": "fix: correct provider",
            "body": "details",
            "html_url": "https://github.test/pulls/10",
            "merged_at": "2026-08-03T00:00:00Z",
            "merge_commit_sha": "a" * 40,
            "base": {"ref": "main"},
            "user": {"login": "contributor"},
        }
        stale_pr = {**pr, "merge_commit_sha": "b" * 40}
        components = {
            "python": {
                "tool_name": "Python SDK",
                "category": "Fixes",
                "summary": "Corrects provider instrumentation.",
            }
        }
        stale_body = release.render_summary_comment(stale_pr, components, self.config)

        class FallbackGitHub:
            file_api_used = False

            def get(self, endpoint):
                if endpoint == "/commits/commit-sha/pulls":
                    return [pr]
                raise AssertionError(f"unexpected GET: {endpoint}")

            def paginated(self, endpoint, **_kwargs):
                if endpoint == "/issues/10/comments":
                    return [
                        {
                            "user": {"login": "github-actions[bot]", "type": "Bot"},
                            "body": stale_body,
                        }
                    ]
                if endpoint == "/pulls/10/files":
                    self.file_api_used = True
                    return [
                        {
                            "filename": "sdk/python/src/openlit/provider.py",
                            "status": "modified",
                            "additions": 2,
                            "deletions": 1,
                            "patch": "+fix",
                        }
                    ]
                raise AssertionError(f"unexpected pagination: {endpoint}")

        github = FallbackGitHub()
        with mock.patch.object(release, "run", return_value="commit-sha"):
            prs, _ = release.collect_prs(
                github,
                "py-1.0.0",
                "source-sha",
                self.config["python"]["paths"],
                tool_key="python",
                config=self.config,
            )
        self.assertTrue(github.file_api_used)
        self.assertNotIn("cached_summary", prs[0])
        self.assertEqual(prs[0]["files"][0]["filename"], "sdk/python/src/openlit/provider.py")

    def test_post_merge_summary_caches_every_affected_tool(self):
        pr = {
            "number": 10,
            "title": "feat: update both SDKs",
            "body": "details",
            "html_url": "https://github.test/pulls/10",
            "merged_at": "2026-08-03T00:00:00Z",
            "merge_commit_sha": "a" * 40,
            "base": {"ref": "main"},
            "user": {"login": "contributor"},
        }
        files = [
            {"filename": "sdk/python/src/openlit/provider.py", "status": "modified", "patch": "+py"},
            {"filename": "sdk/typescript/src/provider.ts", "status": "modified", "patch": "+ts"},
        ]

        class SummaryGitHub:
            @staticmethod
            def get(endpoint):
                if endpoint == "/pulls/10":
                    return pr
                raise AssertionError(f"unexpected GET: {endpoint}")

            @staticmethod
            def paginated(endpoint, **_kwargs):
                if endpoint == "/pulls/10/files":
                    return files
                raise AssertionError(f"unexpected pagination: {endpoint}")

        class SummaryRouter:
            calls = 0

            def __init__(self, *_args):
                pass

            @classmethod
            def summarize_components(cls, evidence_by_component):
                cls.calls += 1
                return {
                    key: {
                        "category": "Features",
                        "summary": f"Updates {value['component_name']}.",
                    }
                    for key, value in evidence_by_component.items()
                }

        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "summary.md"
            with (
                mock.patch.object(release, "GitHub", return_value=SummaryGitHub()),
                mock.patch.object(release, "OpenRouter", SummaryRouter),
                mock.patch.dict(
                    release.os.environ,
                    {"GITHUB_TOKEN": "token", "OPENROUTER_API_KEY": "key"},
                ),
            ):
                release.summarize_pr(
                    Namespace(
                        config=str(release.DEFAULT_CONFIG),
                        repository="openlit/openlit",
                        pr_number=10,
                        output=str(output),
                    )
                )
            body = output.read_text(encoding="utf-8")
        decoded = release.decode_summary_cache(body, 10, "a" * 40, self.config)
        self.assertEqual(set(decoded), {"python", "typescript"})
        self.assertEqual(SummaryRouter.calls, 1)

    def test_large_pr_evidence_is_component_scoped_and_bounded(self):
        pr = {
            "number": 10,
            "title": "feat: large change",
            "body": "details",
            "user": {"login": "contributor"},
            "html_url": "https://github.test/pulls/10",
            "merged_at": "2026-08-03T00:00:00Z",
        }
        files = [
            {
                "filename": f"sdk/python/src/openlit/file_{index}.py",
                "status": "modified",
                "additions": 10,
                "deletions": 2,
                "patch": "+change\n" * 1000,
            }
            for index in range(release.MAX_FILES_PER_PR_EVIDENCE + 50)
        ]
        files.append(
            {
                "filename": "sdk/typescript/src/unrelated.ts",
                "status": "modified",
                "additions": 1,
                "deletions": 0,
                "patch": "+unrelated",
            }
        )
        evidence = release.build_pr_evidence(pr, files, self.config["python"]["paths"])
        self.assertIsNotNone(evidence)
        assert evidence
        self.assertEqual(
            evidence["change_summary"]["changed_files"],
            release.MAX_FILES_PER_PR_EVIDENCE + 50,
        )
        self.assertEqual(len(evidence["files"]), release.MAX_FILES_PER_PR_EVIDENCE)
        self.assertLessEqual(
            sum(len(file["patch"]) for file in evidence["files"]),
            release.MAX_PATCH_CHARS_PER_PR,
        )
        self.assertNotIn("sdk/typescript/src/unrelated.ts", [file["filename"] for file in evidence["files"]])

    def test_component_evidence_suppresses_cross_component_body_and_noisy_patches(self):
        pr = {
            "number": 10,
            "title": "feat: update SDKs",
            "body": "Adds a TypeScript exporter that must not leak into Python notes.",
            "user": {"login": "contributor"},
            "html_url": "https://github.test/pulls/10",
            "merged_at": "2026-08-03T00:00:00Z",
        }
        files = [
            {
                "filename": "sdk/python/package-lock.json",
                "status": "modified",
                "patch": "+very noisy lockfile",
            },
            {
                "filename": "sdk/python/src/openlit/provider.py",
                "status": "modified",
                "patch": "+provider fix",
            },
            {
                "filename": "sdk/typescript/src/exporter.ts",
                "status": "modified",
                "patch": "+exporter",
            },
        ]
        evidence = release.build_pr_evidence(pr, files, self.config["python"]["paths"])
        assert evidence
        self.assertEqual(evidence["body"], "")
        by_name = {file["filename"]: file for file in evidence["files"]}
        self.assertEqual(by_name["sdk/python/package-lock.json"]["patch"], "")
        self.assertEqual(
            by_name["sdk/python/src/openlit/provider.py"]["patch"],
            "+provider fix",
        )

    def test_release_notes_include_deduplicated_human_contributors(self):
        prs = [
            {"number": 1, "html_url": "https://github.test/1", "author": "Octo-Cat"},
            {"number": 2, "html_url": "https://github.test/2", "author": "octo-cat"},
            {"number": 3, "html_url": "https://github.test/3", "author": "dependabot[bot]"},
            {"number": 4, "html_url": "https://github.test/4", "author": "invalid_login!"},
        ]
        summaries = [
            {"number": number, "category": "Maintenance", "summary": f"Updates item {number}."}
            for number in range(1, 5)
        ]
        notes = release.render_notes("Python SDK", "1.2.3", prs, summaries)
        self.assertIn("## Contributors", notes)
        self.assertIn("@Octo-Cat", notes)
        self.assertNotIn("@octo-cat", notes)
        self.assertNotIn("dependabot", notes)
        self.assertNotIn("invalid_login", notes)

    def test_pr_file_list_is_capped_without_git_reconstruction(self):
        pr = {
            "number": 10,
            "changed_files": release.MAX_PR_FILES + 200,
        }

        class FilesGitHub:
            requested_max = None

            def paginated(self, endpoint, *, max_items=None):
                self.requested_max = max_items
                self.assert_endpoint = endpoint
                return [
                    {"filename": f"file-{index}", "patch": ""}
                    for index in range(max_items)
                ]

        github = FilesGitHub()
        with mock.patch.object(release, "run") as run:
            files = release.pull_request_files(github, pr)
        run.assert_not_called()
        self.assertEqual(github.requested_max, release.MAX_PR_FILES)
        self.assertEqual(len(files), release.MAX_PR_FILES)

    def test_paginator_stops_at_explicit_item_limit(self):
        github = release.GitHub("openlit/openlit", "token")
        requested = []

        def get(endpoint):
            requested.append(endpoint)
            return list(range(100))

        with mock.patch.object(github, "get", side_effect=get):
            items = github.paginated("/pulls/10/files", max_items=release.MAX_PR_FILES)
        self.assertEqual(len(items), release.MAX_PR_FILES)
        self.assertEqual(len(requested), 30)
        self.assertIn("page=30", requested[-1])

    def test_model_fallback_is_bounded_for_workflow_timeout(self):
        router = release.OpenRouter("key", "primary-model", "fallback-model")
        pr = {"number": 10, "title": "fix: correct release behavior", "files": []}
        with (
            mock.patch.object(
                release.urllib.request,
                "urlopen",
                side_effect=TimeoutError("model timed out"),
            ) as urlopen,
            mock.patch.object(release.time, "sleep") as sleep,
            self.assertRaisesRegex(release.ReleaseError, "primary and fallback"),
        ):
            router.summarize("Python SDK", [pr])
        self.assertEqual(urlopen.call_count, 2)
        self.assertTrue(
            all(
                call.kwargs["timeout"] == release.MODEL_TIMEOUT_SECONDS
                for call in urlopen.call_args_list
            )
        )
        sleep.assert_not_called()

    def test_summary_rejects_links_and_unknown_categories(self):
        cases = [
            ("unknown category", "Other", "Fine"),
            ("link", "Fixes", "See https://bad.test"),
            ("whitespace only", "Fixes", "   "),
            ("overlong", "Fixes", "a" * 241),
            ("square bracket", "Fixes", "Contains [ bracket"),
            ("angle bracket", "Fixes", "Contains < angle"),
        ]
        for description, category, summary in cases:
            with self.subTest(description=description), self.assertRaises(release.ReleaseError):
                release.validate_summaries(
                    {"items": [{"number": 1, "category": category, "summary": summary}]},
                    {1},
                )

    def test_summary_validation_explains_forbidden_dependency_constraint(self):
        with self.assertRaisesRegex(release.ReleaseError, "forbidden character '<'"):
            release.validate_summaries(
                {
                    "items": [
                        {
                            "number": 1389,
                            "category": "Dependencies",
                            "summary": "Updates langchain to >=1.3.14,<2.0.0.",
                        }
                    ]
                },
                {1389},
            )

    def test_poetry_version_is_scoped_to_tool_poetry(self):
        content = 'version = "wrong"\n\n[tool.poetry]\nname = "demo"\nversion = "1.2.3"\n\n[other]\nversion = "also-wrong"\n'
        self.assertEqual(release.extract_poetry_version(content), "1.2.3")

    def test_persisted_version_accepts_previous_or_exact_requested_version(self):
        self.assertFalse(release.version_already_set("1.0.0", "1.0.0", "1.1.0", "demo"))
        self.assertTrue(release.version_already_set("1.1.0", "1.0.0", "1.1.0", "demo"))
        with self.assertRaises(release.ReleaseError):
            release.version_already_set("1.2.0", "1.0.0", "1.1.0", "demo")

    def test_npm_version_state_accepts_stale_lock_entries_for_repair(self):
        self.assertFalse(release.npm_version_already_set(("1.0.0", "1.0.0", "1.0.0"), "1.0.0", "1.1.0", "demo"))
        self.assertFalse(release.npm_version_already_set(("1.1.0", "1.0.0", "1.1.0"), "1.0.0", "1.1.0", "demo"))
        self.assertTrue(release.npm_version_already_set(("1.1.0", "1.1.0", "1.1.0"), "1.0.0", "1.1.0", "demo"))
        with self.assertRaises(release.ReleaseError):
            release.npm_version_already_set(("1.2.0", "1.0.0", "1.0.0"), "1.0.0", "1.1.0", "demo")

    def test_poetry_and_go_version_updates(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            pyproject = directory / "pyproject.toml"
            pyproject.write_text('[tool.poetry]\nname = "demo"\nversion = "1.0.0"\n', encoding="utf-8")
            release.replace_poetry_version(pyproject, "1.2.0")
            self.assertIn('version = "1.2.0"', pyproject.read_text(encoding="utf-8"))
            go_file = directory / "version.go"
            go_file.write_text('package demo\n\nconst Version = "1.0.0"\n', encoding="utf-8")
            release.replace_go_version(go_file, "1.2.0")
            self.assertIn('const Version = "1.2.0"', go_file.read_text(encoding="utf-8"))

    def test_npm_version_verification_checks_both_lock_entries(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "package.json").write_text(json.dumps({"version": "1.2.0"}), encoding="utf-8")
            (directory / "package-lock.json").write_text(
                json.dumps({"version": "1.2.0", "packages": {"": {"version": "1.2.0"}}}), encoding="utf-8"
            )
            release.verify_npm_versions(directory, "1.2.0")
            for lock_path in (("version",), ("packages", "", "version")):
                lock = json.loads((directory / "package-lock.json").read_text(encoding="utf-8"))
                target = lock
                for part in lock_path[:-1]:
                    target = target[part]
                target[lock_path[-1]] = "1.2.1"
                (directory / "package-lock.json").write_text(json.dumps(lock), encoding="utf-8")
                with self.subTest(lock_path=lock_path), self.assertRaises(release.ReleaseError):
                    release.verify_npm_versions(directory, "1.2.0")
                target[lock_path[-1]] = "1.2.0"
                (directory / "package-lock.json").write_text(json.dumps(lock), encoding="utf-8")

    def test_npm_same_version_repairs_both_stale_lock_entries(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "package.json").write_text(
                json.dumps({"name": "demo", "version": "1.2.0"}), encoding="utf-8"
            )
            (directory / "package-lock.json").write_text(
                json.dumps(
                    {
                        "name": "demo",
                        "version": "1.0.0",
                        "lockfileVersion": 3,
                        "requires": True,
                        "packages": {"": {"name": "demo", "version": "1.0.0"}},
                    }
                ),
                encoding="utf-8",
            )
            release.run(
                "npm",
                "version",
                "1.2.0",
                "--no-git-tag-version",
                "--ignore-scripts",
                "--allow-same-version",
                cwd=directory,
            )
            release.verify_npm_versions(directory, "1.2.0")

    def test_registry_tracks_openlit_package_and_lock(self):
        openlit = self.config["openlit"]
        self.assertEqual(openlit["version_strategy"], "npm")
        self.assertEqual(
            openlit["version_files"],
            ["src/client/package.json", "src/client/package-lock.json"],
        )

    def test_prebumped_npm_release_is_a_validated_noop(self):
        original_root = release.ROOT
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                release.ROOT = root
                work = root / "component"
                work.mkdir()
                (work / "package.json").write_text(
                    json.dumps({"name": "demo", "version": "1.2.0"}), encoding="utf-8"
                )
                (work / "package-lock.json").write_text(
                    json.dumps(
                        {
                            "name": "demo",
                            "version": "1.2.0",
                            "lockfileVersion": 3,
                            "packages": {"": {"name": "demo", "version": "1.2.0"}},
                        }
                    ),
                    encoding="utf-8",
                )
                subprocess.run(["git", "init", "-q"], cwd=root, check=True)
                subprocess.run(["git", "add", "."], cwd=root, check=True)
                subprocess.run(
                    ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"],
                    cwd=root,
                    check=True,
                )
                metadata = root / "metadata.json"
                metadata.write_text(
                    json.dumps(
                        {
                            "version_strategy": "npm",
                            "version": "1.2.0",
                            "version_already_set": True,
                            "working_directory": "component",
                            "version_files": ["component/package.json", "component/package-lock.json"],
                        }
                    ),
                    encoding="utf-8",
                )
                release.bump(Namespace(metadata=str(metadata)))
                self.assertEqual(subprocess.run(
                    ["git", "diff", "--name-only"], cwd=root, check=True, text=True, capture_output=True
                ).stdout, "")
        finally:
            release.ROOT = original_root

    def test_previous_tag_uses_semver_and_ignores_malformed_tags(self):
        original_root = release.ROOT
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                release.ROOT = root
                subprocess.run(["git", "init", "-q"], cwd=root, check=True)
                (root / "file").write_text("one\n", encoding="utf-8")
                subprocess.run(["git", "add", "file"], cwd=root, check=True)
                subprocess.run(
                    ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "one"],
                    cwd=root,
                    check=True,
                )
                subprocess.run(["git", "tag", "py-1.0.0"], cwd=root, check=True)
                subprocess.run(["git", "tag", "py-not-a-version"], cwd=root, check=True)
                (root / "file").write_text("two\n", encoding="utf-8")
                subprocess.run(
                    ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qam", "two"],
                    cwd=root,
                    check=True,
                )
                source = subprocess.run(
                    ["git", "rev-parse", "HEAD"], cwd=root, check=True, text=True, capture_output=True
                ).stdout.strip()
                tool = {"tag_prefix": "py-"}
                self.assertEqual(release.previous_tag("py-1.2.0", "1.2.0", tool, source), "py-1.0.0")
                subprocess.run(["git", "tag", "py-1.3.0"], cwd=root, check=True)
                with self.assertRaises(release.ReleaseError):
                    release.previous_tag("py-1.2.0", "1.2.0", tool, source)
        finally:
            release.ROOT = original_root

    def test_missing_tag_does_not_resolve_as_a_commit(self):
        original_root = release.ROOT
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                release.ROOT = root
                subprocess.run(["git", "init", "-q"], cwd=root, check=True)
                (root / "file").write_text("fixture\n", encoding="utf-8")
                subprocess.run(["git", "add", "file"], cwd=root, check=True)
                subprocess.run(
                    ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"],
                    cwd=root,
                    check=True,
                )
                self.assertIsNone(release.tag_commit_at("py-1.45.0"))
                subprocess.run(["git", "tag", "py-1.45.0"], cwd=root, check=True)
                expected = subprocess.run(
                    ["git", "rev-parse", "HEAD"], cwd=root, check=True, text=True, capture_output=True
                ).stdout.strip()
                self.assertEqual(release.tag_commit_at("py-1.45.0"), expected)
        finally:
            release.ROOT = original_root

    def test_direct_commit_diagnostics_are_tool_scoped(self):
        class NoPullRequests:
            @staticmethod
            def get(_endpoint):
                return []

        original_root = release.ROOT
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                release.ROOT = root
                subprocess.run(["git", "init", "-q"], cwd=root, check=True)
                (root / "README.md").write_text("initial\n", encoding="utf-8")
                subprocess.run(["git", "add", "."], cwd=root, check=True)
                commit = ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm"]
                subprocess.run([*commit, "initial"], cwd=root, check=True)
                subprocess.run(["git", "tag", "gpu-0.0.1"], cwd=root, check=True)
                (root / "README.md").write_text("docs\n", encoding="utf-8")
                subprocess.run(
                    ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qam", "docs"],
                    cwd=root,
                    check=True,
                )
                gpu = root / "gpu"
                gpu.mkdir()
                (gpu / "collector.go").write_text("package gpu\n", encoding="utf-8")
                subprocess.run(["git", "add", "."], cwd=root, check=True)
                subprocess.run([*commit, "gpu change"], cwd=root, check=True)
                source = subprocess.run(
                    ["git", "rev-parse", "HEAD"], cwd=root, check=True, text=True, capture_output=True
                ).stdout.strip()
                prs, direct = release.collect_prs(NoPullRequests(), "gpu-0.0.1", source, ["gpu/**"])
                self.assertEqual(prs, [])
                self.assertEqual([item["subject"] for item in direct], ["gpu change"])
        finally:
            release.ROOT = original_root

    def test_bump_strategies_only_change_allowlisted_files(self):
        original_root = release.ROOT
        try:
            for strategy in ("poetry", "npm", "go-const", "none"):
                with self.subTest(strategy=strategy), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    release.ROOT = root
                    work = root / "component"
                    work.mkdir()
                    if strategy == "poetry":
                        version_files = ["component/pyproject.toml"]
                        (work / "pyproject.toml").write_text(
                            '[tool.poetry]\nname = "demo"\nversion = "1.0.0"\n', encoding="utf-8"
                        )
                    elif strategy == "npm":
                        version_files = ["component/package.json", "component/package-lock.json"]
                        (work / "package.json").write_text(
                            json.dumps({"name": "demo", "version": "1.0.0"}), encoding="utf-8"
                        )
                        (work / "package-lock.json").write_text(
                            json.dumps(
                                {
                                    "name": "demo",
                                    "version": "1.0.0",
                                    "lockfileVersion": 3,
                                    "requires": True,
                                    "packages": {"": {"name": "demo", "version": "1.0.0"}},
                                }
                            ),
                            encoding="utf-8",
                        )
                    elif strategy == "go-const":
                        version_files = ["component/version.go"]
                        (work / "version.go").write_text(
                            'package component\n\nconst Version = "1.0.0"\n', encoding="utf-8"
                        )
                    else:
                        version_files = []
                        (work / "README.md").write_text("fixture\n", encoding="utf-8")
                    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
                    subprocess.run(["git", "add", "."], cwd=root, check=True)
                    subprocess.run(
                        ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"],
                        cwd=root,
                        check=True,
                    )
                    metadata = root / "metadata.json"
                    metadata.write_text(
                        json.dumps(
                            {
                                "version_strategy": strategy,
                                "version": "1.2.0",
                                "working_directory": "component",
                                "version_files": version_files,
                            }
                        ),
                        encoding="utf-8",
                    )
                    release.bump(Namespace(metadata=str(metadata)))
                    changed = subprocess.run(
                        ["git", "diff", "--name-only"], cwd=root, check=True, text=True, capture_output=True
                    ).stdout.splitlines()
                    self.assertEqual(set(changed), set(version_files))
        finally:
            release.ROOT = original_root


if __name__ == "__main__":
    unittest.main()
