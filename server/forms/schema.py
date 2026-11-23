"""The form schema format (docs/DATA_MODEL.md section 5).

A form version's `schema` is a deliberately small subset of JSON Schema (draft 2020-12): one flat
object, a handful of field types, and the constraints a mobile inspection form needs. Keeping it
small is what lets the same document drive both the server (this module, `jsonschema`) and the
client (Zod) with identical behaviour.
"""

import json
import re

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

FIELD_TYPES = {"string", "number", "integer", "boolean"}
TOP_LEVEL_KEYS = {
    "$schema",
    "type",
    "title",
    "description",
    "properties",
    "required",
    "additionalProperties",
    "x-order",
}
FIELD_KEYS = {
    "type",
    "title",
    "description",
    "enum",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
}
# Field names are stable identifiers: they are the keys of submission data and of field_versions.
FIELD_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")

# Limits (DATA_MODEL.md section 5). Every device keeps every published version it is assigned, so a
# form must stay small. Checked at publish only; versions published earlier are not re-checked.
MAX_FIELDS = 100
MAX_TITLE = 200
MAX_DESCRIPTION = 500
MAX_CHOICES = 50
MAX_CHOICE = 100
MAX_MAX_LENGTH = 10_000
MAX_SCHEMA_BYTES = 64 * 1024


def _text_limits(where: str, spec: dict, errors: list[str]) -> None:
    for key, limit in (("title", MAX_TITLE), ("description", MAX_DESCRIPTION)):
        value = spec.get(key)
        if isinstance(value, str) and len(value) > limit:
            errors.append(f'{where}: "{key}" is longer than {limit} characters.')


def _number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _order_problems(schema: dict, properties: dict) -> list[str]:
    if "x-order" not in schema:
        return ['Add "x-order": the list of field names in the order workers should see them.']
    order = schema["x-order"]
    if not isinstance(order, list) or not all(isinstance(n, str) for n in order):
        return ['"x-order" must be a list of field names.']
    errors = []
    if repeated := sorted({n for n in order if order.count(n) > 1}):
        errors.append(f'"x-order" lists a field more than once: {", ".join(repeated)}.')
    if unknown := sorted(set(order) - set(properties)):
        errors.append(f'"x-order" names unknown fields: {", ".join(unknown)}.')
    if missing := sorted(set(properties) - set(order)):
        errors.append(f'"x-order" leaves out: {", ".join(missing)}.')
    return errors


def validate_form_schema(schema: object) -> list[str]:
    """Return a list of problems with a form schema; empty means it is a valid Talaan form."""
    if not isinstance(schema, dict):
        return ["The schema must be a JSON object."]

    errors: list[str] = []
    unknown = sorted(set(schema) - TOP_LEVEL_KEYS)
    if unknown:
        errors.append(f"Unsupported top-level keys: {', '.join(unknown)}.")
    if schema.get("type") != "object":
        errors.append('The top-level "type" must be "object".')
    if schema.get("additionalProperties") is not False:
        errors.append('"additionalProperties" must be false so unknown fields are rejected.')

    properties = schema.get("properties")
    if not isinstance(properties, dict) or not properties:
        errors.append('"properties" must be an object with at least one field.')
        properties = {}
    if len(properties) > MAX_FIELDS:
        errors.append(f"A form can have at most {MAX_FIELDS} fields.")
    _text_limits("The form", schema, errors)
    errors.extend(_order_problems(schema, properties))

    for name, spec in properties.items():
        where = f'Field "{name}"'
        if not FIELD_NAME.match(name):
            errors.append(
                f"{where}: names are lowercase letters, digits and underscores, "
                "starting with a letter."
            )
        if not isinstance(spec, dict):
            errors.append(f"{where}: must be an object.")
            continue
        extra = sorted(set(spec) - FIELD_KEYS)
        if extra:
            errors.append(f"{where}: unsupported keys: {', '.join(extra)}.")
        field_type = spec.get("type")
        if field_type not in FIELD_TYPES:
            errors.append(f'{where}: "type" must be one of {", ".join(sorted(FIELD_TYPES))}.')
        if "enum" in spec:
            choices = spec["enum"]
            if field_type != "string" or not (
                isinstance(choices, list)
                and choices
                and all(isinstance(c, str) and c for c in choices)
                and len(set(choices)) == len(choices)
            ):
                errors.append(
                    f"{where}: enum must be a list of distinct non-empty strings on a string field."
                )
            elif len(choices) > MAX_CHOICES:
                errors.append(f"{where}: at most {MAX_CHOICES} choices.")
            elif any(len(c) > MAX_CHOICE for c in choices):
                errors.append(f"{where}: each choice is at most {MAX_CHOICE} characters.")
        _text_limits(where, spec, errors)
        if _number(spec.get("maxLength")) and spec["maxLength"] > MAX_MAX_LENGTH:
            errors.append(f'{where}: "maxLength" is at most {MAX_MAX_LENGTH}.')
        for low, high in (("minLength", "maxLength"), ("minimum", "maximum")):
            if _number(spec.get(low)) and _number(spec.get(high)) and spec[low] > spec[high]:
                errors.append(f'{where}: "{low}" is larger than "{high}", so no answer would fit.')

    required = schema.get("required", [])
    if not isinstance(required, list) or not all(isinstance(r, str) for r in required):
        errors.append('"required" must be a list of field names.')
    else:
        missing = sorted(set(required) - set(properties))
        if missing:
            errors.append(f'"required" names unknown fields: {", ".join(missing)}.')
        if len(set(required)) != len(required):
            errors.append('"required" lists a field more than once.')

    size = len(json.dumps(schema, separators=(",", ":"), ensure_ascii=False).encode())
    if size > MAX_SCHEMA_BYTES:
        errors.append(f"The form is larger than {MAX_SCHEMA_BYTES // 1024} KB.")

    # Only worth asking the JSON Schema meta-schema once our own rules pass.
    if not errors:
        try:
            Draft202012Validator.check_schema(schema)
        except SchemaError as exc:
            errors.append(f"Not valid JSON Schema: {exc.message}")
    return errors
