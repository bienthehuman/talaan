import copy

import pytest

from forms.samples import GENERATOR_INSPECTION
from forms.schema import (
    MAX_CHOICE,
    MAX_CHOICES,
    MAX_DESCRIPTION,
    MAX_FIELDS,
    MAX_MAX_LENGTH,
    MAX_TITLE,
    validate_form_schema,
)


def schema(**changes):
    s = copy.deepcopy(GENERATOR_INSPECTION)
    s.update(changes)
    return s


def test_the_sample_form_is_valid():
    assert validate_form_schema(GENERATOR_INSPECTION) == []


def test_a_minimal_form_is_valid():
    assert (
        validate_form_schema(
            {
                "type": "object",
                "properties": {"ok": {"type": "boolean"}},
                "additionalProperties": False,
                "x-order": ["ok"],
            }
        )
        == []
    )


@pytest.mark.parametrize(
    ("bad", "fragment"),
    [
        ("not a dict", "must be a JSON object"),
        (schema(type="array"), '"type" must be "object"'),
        (schema(additionalProperties=True), "additionalProperties"),
        (schema(properties={}), "at least one field"),
        (schema(extra_key=1), "Unsupported top-level keys"),
        (schema(required=["nope"]), "unknown fields: nope"),
        (schema(required=["oil_level", "oil_level"]), "more than once"),
        (schema(required="oil_level"), "list of field names"),
    ],
)
def test_top_level_problems_are_reported(bad, fragment):
    problems = validate_form_schema(bad)
    assert any(fragment in p for p in problems), problems


@pytest.mark.parametrize(
    ("fields", "fragment"),
    [
        ({"Bad-Name": {"type": "string"}}, "names are lowercase"),
        ({"1st": {"type": "string"}}, "names are lowercase"),
        ({"x": {"type": "object"}}, "must be one of"),
        ({"x": {"type": "array"}}, "must be one of"),
        ({"x": {"type": "string", "pattern": "^a"}}, "unsupported keys: pattern"),
        ({"x": {"type": "string", "enum": []}}, "enum must be"),
        ({"x": {"type": "string", "enum": ["a", "a"]}}, "enum must be"),
        ({"x": {"type": "integer", "enum": ["a"]}}, "enum must be"),
        ({"x": "string"}, "must be an object"),
    ],
)
def test_field_problems_are_reported(fields, fragment):
    problems = validate_form_schema(
        {"type": "object", "properties": fields, "additionalProperties": False}
    )
    assert any(fragment in p for p in problems), problems


def test_nested_objects_are_not_supported():
    problems = validate_form_schema(
        {
            "type": "object",
            "properties": {"a": {"type": "object", "properties": {"b": {"type": "string"}}}},
            "additionalProperties": False,
        }
    )
    assert problems


def form(fields: dict, **top) -> dict:
    """A valid form around `fields`, with x-order in the order given."""
    return {
        "type": "object",
        "properties": fields,
        "additionalProperties": False,
        "x-order": list(fields),
        **top,
    }


@pytest.mark.parametrize(
    ("order", "fragment"),
    [
        (None, 'Add "x-order"'),
        ("oil_level", "must be a list of field names"),
        ([1, 2], "must be a list of field names"),
        (["notes", "notes"], "more than once: notes"),
        (["nope"], "unknown fields: nope"),
        (["notes"], "leaves out: coolant_ok"),
    ],
)
def test_x_order_must_list_every_field_once(order, fragment):
    bad = copy.deepcopy(GENERATOR_INSPECTION)
    if order is None:
        del bad["x-order"]
    else:
        bad["x-order"] = order
    problems = validate_form_schema(bad)
    assert any(fragment in p for p in problems), problems


def test_x_order_survives_storage_as_jsonb(db):
    from forms.models import Form, FormVersion

    version = FormVersion.objects.create(
        form=Form.objects.create(name="O"), schema=GENERATOR_INSPECTION
    )
    version.refresh_from_db()
    assert version.schema["x-order"] == GENERATOR_INSPECTION["x-order"]
    assert list(version.schema["properties"]) != GENERATOR_INSPECTION["x-order"]  # why it exists


def test_limits_at_the_edge_pass():
    fields = {f"f{i}": {"type": "boolean"} for i in range(MAX_FIELDS - 1)}
    fields["choice"] = {
        "type": "string",
        "title": "t" * MAX_TITLE,
        "description": "d" * MAX_DESCRIPTION,
        "enum": [f"{i:03d}".ljust(MAX_CHOICE, "c") for i in range(MAX_CHOICES)],
        "maxLength": MAX_MAX_LENGTH,
    }
    assert validate_form_schema(form(fields, title="t" * MAX_TITLE)) == []


@pytest.mark.parametrize(
    ("bad", "fragment"),
    [
        (form({f"f{i}": {"type": "boolean"} for i in range(MAX_FIELDS + 1)}), "at most 100 fields"),
        (form({"a": {"type": "boolean"}}, title="t" * (MAX_TITLE + 1)), '"title" is longer'),
        (
            form({"a": {"type": "boolean"}}, description="d" * (MAX_DESCRIPTION + 1)),
            '"description" is longer',
        ),
        (form({"a": {"type": "boolean", "title": "t" * (MAX_TITLE + 1)}}), '"title" is longer'),
        (
            form({"a": {"type": "boolean", "description": "d" * (MAX_DESCRIPTION + 1)}}),
            '"description" is longer',
        ),
        (
            form({"a": {"type": "string", "enum": [str(i) for i in range(MAX_CHOICES + 1)]}}),
            "at most 50 choices",
        ),
        (
            form({"a": {"type": "string", "enum": ["c" * (MAX_CHOICE + 1)]}}),
            "each choice is at most",
        ),
        (
            form({"a": {"type": "string", "maxLength": MAX_MAX_LENGTH + 1}}),
            '"maxLength" is at most',
        ),
        (
            form({"a": {"type": "string", "minLength": 5, "maxLength": 4}}),
            '"minLength" is larger than "maxLength"',
        ),
        (
            form({"a": {"type": "number", "minimum": 5, "maximum": 4.5}}),
            '"minimum" is larger than "maximum"',
        ),
        (
            form({f"f{i}": {"type": "string", "description": "é" * 450} for i in range(80)}),
            "larger than 64 KB",
        ),
    ],
)
def test_limits_are_enforced(bad, fragment):
    problems = validate_form_schema(bad)
    assert any(fragment in p for p in problems), problems


def test_equal_bounds_are_allowed():
    fields = {
        "a": {"type": "string", "minLength": 4, "maxLength": 4},
        "b": {"type": "integer", "minimum": 3, "maximum": 3},
    }
    assert validate_form_schema(form(fields)) == []
