import pytest

from forms.samples import GENERATOR_INSPECTION
from forms.validation import validate_data

SCHEMA = GENERATOR_INSPECTION
COMPLETE = {"oil_level": "ok", "coolant_ok": True, "hours_run": 5}


def problems(data, *, complete=False):
    return {(p["field"], p["code"]) for p in validate_data(SCHEMA, data, complete=complete)}


def test_valid_data_has_no_problems():
    assert (
        validate_data(
            SCHEMA, {**COMPLETE, "notes": "fine", "oil_pressure_psi": 41.5}, complete=True
        )
        == []
    )


def test_an_empty_draft_is_valid_but_not_complete():
    assert validate_data(SCHEMA, {}, complete=False) == []
    assert problems({}, complete=True) == {
        ("oil_level", "required"),
        ("coolant_ok", "required"),
        ("hours_run", "required"),
    }


def test_required_is_only_enforced_when_complete():
    assert ("hours_run", "required") not in problems({"oil_level": "ok"}, complete=False)
    assert ("hours_run", "required") in problems({"oil_level": "ok"}, complete=True)


def test_unknown_fields_are_always_refused():
    assert problems({"mystery": 1}) == {("mystery", "unknown_field")}
    assert problems({**COMPLETE, "mystery": 1}, complete=True) == {("mystery", "unknown_field")}


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("oil_level", "overflowing", "enum"),
        ("oil_level", 3, "type"),
        ("hours_run", 1.5, "type"),
        ("hours_run", "5", "type"),
        ("hours_run", True, "type"),  # a boolean is not an integer
        ("oil_pressure_psi", True, "type"),  # nor a number
        ("oil_pressure_psi", -1, "minimum"),
        ("oil_pressure_psi", 201, "maximum"),
        ("coolant_ok", "yes", "type"),
        ("coolant_ok", 1, "type"),
        ("notes", "x" * 2001, "maxLength"),
        ("site_contact", "x" * 121, "maxLength"),
        ("hours_run", -1, "minimum"),
    ],
)
def test_each_constraint_is_enforced(field, value, code):
    assert (field, code) in problems({field: value})


@pytest.mark.parametrize(
    ("field", "value"),
    [("hours_run", 0), ("oil_pressure_psi", 0), ("oil_pressure_psi", 200), ("notes", "x" * 2000)],
)
def test_boundary_values_are_accepted(field, value):
    assert problems({field: value}) == set()


def test_messages_are_human_readable():
    found = {
        (p["field"], p["code"]): p["message"]
        for p in validate_data(
            SCHEMA, {"oil_level": "x", "hours_run": -1, "notes": "y" * 2001}, complete=False
        )
    }
    assert found[("oil_level", "enum")] == "Must be one of: ok, low, empty."
    assert found[("hours_run", "minimum")] == "Must be at least 0."
    assert found[("notes", "maxLength")] == "Must be at most 2000 characters."


def test_problems_are_reported_in_a_stable_order():
    first = validate_data(SCHEMA, {"zeta": 1, "alpha": 2, "hours_run": "x"}, complete=True)
    assert first == validate_data(SCHEMA, {"hours_run": "x", "alpha": 2, "zeta": 1}, complete=True)
    assert [p["field"] for p in first] == sorted(p["field"] for p in first)
