"""The form schema format (docs/DATA_MODEL.md section 5).

A form version's `schema` is a deliberately small subset of JSON Schema (draft 2020-12): one flat
object, a handful of field types, and the constraints a mobile inspection form needs. Keeping it
small is what lets the same document drive both the server (this module, `jsonschema`) and the
client (Zod) with identical behaviour.
"""

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

    required = schema.get("required", [])
    if not isinstance(required, list) or not all(isinstance(r, str) for r in required):
        errors.append('"required" must be a list of field names.')
    else:
        missing = sorted(set(required) - set(properties))
        if missing:
            errors.append(f'"required" names unknown fields: {", ".join(missing)}.')
        if len(set(required)) != len(required):
            errors.append('"required" lists a field more than once.')

    # Only worth asking the JSON Schema meta-schema once our own rules pass.
    if not errors:
        try:
            Draft202012Validator.check_schema(schema)
        except SchemaError as exc:
            errors.append(f"Not valid JSON Schema: {exc.message}")
    return errors
