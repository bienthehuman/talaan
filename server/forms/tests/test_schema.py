import copy

import pytest

from forms.samples import GENERATOR_INSPECTION
from forms.schema import validate_form_schema


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
