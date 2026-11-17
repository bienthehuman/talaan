"""Validate submission data against the form version it is pinned to (docs/protocol.md section 5).

Drafts may be incomplete, so `required` is only enforced when `complete=True` (on submit). Unknown
fields are always refused. Everything else (types, enums, lengths, ranges) comes from the JSON
Schema of the form version, so the server and the client's Zod schema agree.
"""

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError


def _message(error: ValidationError) -> str:
    rule, limit = error.validator, error.validator_value
    if rule == "type":
        kinds = limit if isinstance(limit, str) else " or ".join(limit)
        return f"Must be a {kinds}."
    if rule == "enum":
        return "Must be one of: " + ", ".join(str(choice) for choice in limit) + "."
    if rule == "maxLength":
        return f"Must be at most {limit} characters."
    if rule == "minLength":
        return f"Must be at least {limit} characters."
    if rule == "maximum":
        return f"Must be at most {limit}."
    if rule == "minimum":
        return f"Must be at least {limit}."
    return error.message


def validate_data(schema: dict, data: dict, *, complete: bool) -> list[dict]:
    """Return a list of {"field", "code", "message"} problems; empty means the data is valid."""
    properties = schema.get("properties", {})
    problems: list[dict] = []

    for name in sorted(set(data) - set(properties)):
        problems.append(
            {"field": name, "code": "unknown_field", "message": "This field is not on the form."}
        )

    if complete:
        for name in schema.get("required", []):
            if name not in data:
                problems.append(
                    {"field": name, "code": "required", "message": "This field is required."}
                )

    # `required` and `additionalProperties` are handled above, with clearer per-field messages.
    rest = {k: v for k, v in schema.items() if k not in {"required", "additionalProperties"}}
    known = {k: v for k, v in data.items() if k in properties}
    for error in Draft202012Validator(rest).iter_errors(known):
        problems.append(
            {
                "field": str(error.path[0]) if error.path else "",
                "code": str(error.validator),
                "message": _message(error),
            }
        )

    return sorted(problems, key=lambda p: (p["field"], p["code"]))
