import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

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

    def test_tool_and_version_construct_release_tag(self):
        tag, key, version, tool = release.resolve_release_identity(
            self.config, tool_key="gpu-collector", version="0.0.8"
        )
        self.assertEqual(tag, "otel-gpu-collector-0.0.8")
        self.assertEqual((key, version, tool["publisher"]), ("gpu-collector", "0.0.8", "gpu-collector"))

        friendly_tag, friendly_key, _, _ = release.resolve_release_identity(
            self.config, tool_key="OTel GPU Collector", version="0.0.8"
        )
        self.assertEqual((friendly_tag, friendly_key), (tag, key))

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

    def test_multi_tool_pr_body_is_excluded_from_tool_evidence(self):
        body = "TypeScript threshold change plus unrelated API endpoints"
        self.assertEqual(release.body_for_tool_evidence(body, "contributor", True), "")
        self.assertEqual(release.body_for_tool_evidence(body, "contributor", False), body)

    def test_large_pr_evidence_keeps_files_but_bounds_patches(self):
        files = [
            {
                "filename": f"sdk/python/file_{index}.py",
                "status": "modified",
                "additions": 100,
                "deletions": 10,
                "patch": "+" + ("x" * 10_000),
            }
            for index in range(100)
        ]
        evidence = release.scoped_file_evidence(files, ["sdk/python/**"])
        self.assertEqual(len(evidence), 100)
        self.assertLessEqual(sum(len(file["patch"]) for file in evidence), release.MAX_PATCH_CHARS_PER_PR)
        self.assertTrue(all(len(file["patch"]) <= release.MAX_PATCH_CHARS_PER_FILE for file in evidence))

        lock_evidence = release.scoped_file_evidence(
            [{"filename": "sdk/python/poetry.lock", "patch": "+generated"}],
            ["sdk/python/**"],
        )
        self.assertEqual(lock_evidence[0]["patch"], "")

    def test_cached_release_summary_requires_bot_authorship_and_matching_digest(self):
        pr = {
            "number": 42,
            "merge_commit_sha": "a" * 40,
            "files_digest": "b" * 64,
        }
        payload = {
            "schema_version": release.RELEASE_SUMMARY_SCHEMA,
            "pr_number": 42,
            "merge_commit_sha": "a" * 40,
            "files_digest": "b" * 64,
            "tools": {
                "typescript": {
                    "category": "Features",
                    "summary": "Adds cached token pricing.",
                }
            },
        }
        body = release.release_summary_comment(payload, self.config)
        self.assertEqual(release.parse_release_summary_comment(body), payload)
        self.assertEqual(
            release.validate_cached_summary(payload, pr, "typescript")["number"],
            42,
        )

        class Comments:
            @staticmethod
            def paginated(_endpoint):
                return [
                    {"user": {"login": "attacker"}, "body": body},
                    {"user": {"login": "github-actions[bot]"}, "body": body},
                ]

        self.assertIsNotNone(release.cached_summary_for_pr(Comments(), pr, "typescript"))

        class AttackerOnly:
            @staticmethod
            def paginated(_endpoint):
                return [{"user": {"login": "attacker"}, "body": body}]

        self.assertIsNone(release.cached_summary_for_pr(AttackerOnly(), pr, "typescript"))
        tampered = dict(payload)
        tampered["files_digest"] = "c" * 64
        with self.assertRaises(release.ReleaseError):
            release.validate_cached_summary(tampered, pr, "typescript")

    def test_release_notes_render_human_contributor_mentions(self):
        prs = [
            {"number": 1, "html_url": "https://github.com/openlit/openlit/pull/1", "author": "alice"},
            {"number": 2, "html_url": "https://github.com/openlit/openlit/pull/2", "author": "dependabot[bot]"},
            {"number": 3, "html_url": "https://github.com/openlit/openlit/pull/3", "author": "alice"},
        ]
        summaries = [
            {"number": 1, "category": "Features", "summary": "Adds tracing."},
            {"number": 2, "category": "Dependencies", "summary": "Updates a dependency."},
            {"number": 3, "category": "Fixes", "summary": "Fixes exporting."},
        ]
        notes = release.render_notes("Python SDK", "1.2.3", prs, summaries)
        self.assertIn("## Contributors", notes)
        self.assertEqual(notes.count("@alice"), 1)
        self.assertNotIn("dependabot", notes.split("## Contributors", 1)[1])

    def test_registry_defines_friendly_names_and_release_titles(self):
        expected = {
            "python": ("Python SDK", "python-sdk"),
            "typescript": ("TypeScript SDK", "typescript-sdk"),
            "go": ("Go SDK", "go-sdk"),
            "cli": ("CLI", "cli"),
            "controller": ("Controller", "controller"),
            "openlit": ("OpenLIT", "openlit"),
            "gpu-collector": ("OTel GPU Collector", "otel-gpu-collector"),
        }
        self.assertEqual(
            {key: (tool["display_name"], tool["release_name"]) for key, tool in self.config.items()},
            expected,
        )

    def test_summary_validation_requires_exact_pr_set(self):
        valid = {"items": [{"number": 10, "category": "Fixes", "summary": "Corrects streaming output."}]}
        self.assertEqual(release.validate_summaries(valid, {10})[0]["number"], 10)
        with self.assertRaises(release.ReleaseError):
            release.validate_summaries(valid, {10, 11})
        with self.assertRaises(release.ReleaseError):
            release.validate_summaries({"items": valid["items"] * 2}, {10})

    def test_tool_summary_validation_requires_exact_tool_set(self):
        value = {
            "items": [
                {"tool": "python", "category": "Features", "summary": "Adds tracing."},
                {"tool": "typescript", "category": "Fixes", "summary": "Fixes exporting."},
            ]
        }
        validated = release.validate_tool_summaries(value, {"python", "typescript"})
        self.assertEqual(set(validated), {"python", "typescript"})
        with self.assertRaises(release.ReleaseError):
            release.validate_tool_summaries(value, {"python"})

    def test_post_merge_summary_caches_all_affected_tools_in_one_call(self):
        pr = {
            "number": 42,
            "title": "Update both SDKs",
            "body": "This body mentions both SDKs.",
            "html_url": "https://github.com/openlit/openlit/pull/42",
            "merged_at": "2026-08-02T12:00:00Z",
            "merge_commit_sha": "a" * 40,
            "changed_files": 2,
            "base": {"ref": "main"},
            "user": {"login": "contributor"},
        }
        files = [
            {
                "filename": "sdk/python/openlit/client.py",
                "status": "modified",
                "additions": 3,
                "deletions": 1,
                "patch": "+python change",
            },
            {
                "filename": "sdk/typescript/src/client.ts",
                "status": "modified",
                "additions": 4,
                "deletions": 2,
                "patch": "+typescript change",
            },
        ]
        created_comments = []
        calls = []

        class FakeGitHub:
            def __init__(self, repository, token):
                self.repository = repository
                self.token = token

            @staticmethod
            def get(endpoint):
                self.assertEqual(endpoint, "/pulls/42")
                return pr

            @staticmethod
            def paginated(endpoint):
                if endpoint == "/pulls/42/files":
                    return files
                if endpoint == "/issues/42/comments":
                    return []
                raise AssertionError(endpoint)

            @staticmethod
            def post(endpoint, payload):
                created_comments.append((endpoint, payload))

            @staticmethod
            def patch(endpoint, payload):
                raise AssertionError((endpoint, payload))

        class FakeOpenRouter:
            def __init__(self, api_key, primary, fallback):
                self.api_key = api_key

            @staticmethod
            def summarize_tools(evidence_by_tool):
                calls.append(evidence_by_tool)
                return {
                    "python": {"category": "Features", "summary": "Adds Python SDK support."},
                    "typescript": {
                        "category": "Fixes",
                        "summary": "Corrects TypeScript SDK behavior.",
                    },
                }

        original_github = release.GitHub
        original_router = release.OpenRouter
        original_token = os.environ.get("GITHUB_TOKEN")
        original_key = os.environ.get("OPENROUTER_API_KEY")
        try:
            release.GitHub = FakeGitHub
            release.OpenRouter = FakeOpenRouter
            os.environ["GITHUB_TOKEN"] = "test-token"
            os.environ["OPENROUTER_API_KEY"] = "test-key"
            release.summarize_pr(
                Namespace(
                    config=str(release.DEFAULT_CONFIG),
                    repository="openlit/openlit",
                    pr_number=42,
                )
            )
        finally:
            release.GitHub = original_github
            release.OpenRouter = original_router
            if original_token is None:
                os.environ.pop("GITHUB_TOKEN", None)
            else:
                os.environ["GITHUB_TOKEN"] = original_token
            if original_key is None:
                os.environ.pop("OPENROUTER_API_KEY", None)
            else:
                os.environ["OPENROUTER_API_KEY"] = original_key

        self.assertEqual(len(calls), 1)
        self.assertEqual(set(calls[0]), {"python", "typescript"})
        self.assertEqual(len(created_comments), 1)
        self.assertEqual(created_comments[0][0], "/issues/42/comments")
        cached = release.parse_release_summary_comment(created_comments[0][1]["body"])
        self.assertIsNotNone(cached)
        self.assertEqual(set(cached["tools"]), {"python", "typescript"})
        self.assertEqual(cached["files_digest"], release.files_digest(files))

    def test_file_digest_is_independent_of_github_pagination_order(self):
        files = [
            {"filename": "sdk/python/b.py", "status": "modified", "additions": 2, "deletions": 0},
            {"filename": "sdk/python/a.py", "status": "renamed", "previous_filename": "old.py"},
        ]
        self.assertEqual(release.files_digest(files), release.files_digest(list(reversed(files))))

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
