"""
Schema validation guard for structured LLM outputs.

Validates that model output is valid JSON and/or conforms to a JSON schema.
Phases: postflight only.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from openlit.guard._base import Guard, GuardPhase, GuardResult


def _validate_json_schema(
    data: Any, schema: Dict[str, Any], path: str = ""
) -> Optional[str]:
    """Minimal recursive JSON schema validator (type, required, properties).

    ``type`` may be a single name or a list of names, such as
    ``["string", "null"]`` for a nullable field.
    """
    schema_type = schema.get("type")
    types = schema_type if isinstance(schema_type, list) else [schema_type]
    if schema_type:
        type_map = {
            "object": dict,
            "array": list,
            "string": str,
            "number": (int, float),
            "integer": int,
            "boolean": bool,
            "null": type(None),
        }

        # Unknown or non-string names are ignored. When none are known, the type
        # is not checked, as for a single unknown type.
        known = [name for name in types if isinstance(name, str) and name in type_map]

        def matches(name: str) -> bool:
            # In Python, bool is a subclass of int, but JSON Schema treats booleans
            # as a separate primitive type from numbers.
            if name in ("integer", "number") and isinstance(data, bool):
                return False
            return isinstance(data, type_map[name])

        if known and not any(matches(name) for name in known):
            return (
                f"Expected {' or '.join(known)} at {path or 'root'}, "
                f"got {type(data).__name__}"
            )

    if "object" in types and isinstance(data, dict):
        for field_name in schema.get("required", []):
            if field_name not in data:
                return f"Missing required field '{field_name}' at {path or 'root'}"

        properties = schema.get("properties", {})
        for prop_name, prop_schema in properties.items():
            if prop_name in data:
                err = _validate_json_schema(
                    data[prop_name], prop_schema, f"{path}.{prop_name}"
                )
                if err:
                    return err

    if "array" in types and isinstance(data, list):
        items_schema = schema.get("items")
        if items_schema:
            for i, item in enumerate(data):
                err = _validate_json_schema(item, items_schema, f"{path}[{i}]")
                if err:
                    return err

    return None


class Schema(Guard):
    """
    Validates that model output is valid JSON and optionally matches a schema.

    Parameters
    ----------
    action : str
        ``"deny"`` (default) or ``"warn"``.
    json : bool
        If ``True``, just verify the output is parseable JSON.
    schema : dict, optional
        A JSON-schema-like dict to validate against.
    """

    name = "schema"
    phases = (GuardPhase.POSTFLIGHT,)

    def __init__(
        self,
        action: str = "deny",
        json_mode: bool = False,
        schema: Optional[Dict[str, Any]] = None,
        **kwargs,
    ):
        super().__init__(action=action, **kwargs)
        self._json_mode = json_mode
        self._schema = schema

    def evaluate(self, text: str) -> GuardResult:
        stripped = text.strip()

        try:
            parsed = json.loads(stripped)
        except (json.JSONDecodeError, ValueError) as exc:
            return GuardResult(
                action=self._action,
                score=1.0,
                guard_name=self.name,
                classification="invalid_json",
                explanation=f"Output is not valid JSON: {exc}",
            )

        if self._schema:
            err = _validate_json_schema(parsed, self._schema)
            if err:
                return GuardResult(
                    action=self._action,
                    score=0.9,
                    guard_name=self.name,
                    classification="schema_mismatch",
                    explanation=err,
                )

        return GuardResult(guard_name=self.name)
