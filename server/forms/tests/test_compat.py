import copy

import pytest

from forms.compat import REFUSED, REVIEW, SAFE, changes, refused
from forms.samples import GENERATOR_INSPECTION as V1


def edit(base=V1, required=None, **fields):
    """`base` with properties replaced (None removes one); x-order follows; required kept."""
    s = copy.deepcopy(base)
    for name, spec in fields.items():
        if spec is None:
            s["properties"].pop(name, None)
        else:
            s["properties"][name] = spec
    s["x-order"] = [n for n in s["x-order"] if n in s["properties"]] + [
        n for n in s["properties"] if n not in s["x-order"]
    ]
    s["required"] = [r for r in (required or s["required"]) if r in s["properties"]]
    return s


def found(history, schema):
    return {(c["field"], c["level"]) for c in changes(history, schema)}


def test_no_history_and_no_change_report_nothing():
    assert changes([], V1) == []
    assert changes([V1], copy.deepcopy(V1)) == []


@pytest.mark.parametrize(
    ("schema", "expected"),
    [
        ({**V1, "title": "Genset"}, {("", SAFE)}),
        ({**V1, "x-order": list(reversed(V1["x-order"]))}, {("", SAFE)}),
        (edit(notes={"type": "string", "title": "Remarks", "maxLength": 2000}), {("notes", SAFE)}),
        (
            edit(notes={"type": "string", "title": "Notes", "description": "Anything else"}),
            {("notes", SAFE)},
        ),
        (edit(extra={"type": "boolean"}), {("extra", SAFE)}),
        (edit(extra={"type": "boolean"}, required=[*V1["required"], "extra"]), {("extra", REVIEW)}),
        (edit(notes=None), {("notes", REVIEW)}),
        (edit(required=[*V1["required"], "notes"]), {("notes", REVIEW)}),
        (edit(required=["oil_level", "coolant_ok"]), {("hours_run", SAFE)}),
        (edit(notes={"type": "string", "title": "Notes", "maxLength": 100}), {("notes", REVIEW)}),
        (edit(notes={"type": "string", "title": "Notes", "maxLength": 5000}), {("notes", SAFE)}),
        (edit(notes={"type": "string", "title": "Notes"}), {("notes", SAFE)}),
        (
            edit(notes={"type": "string", "title": "Notes", "maxLength": 2000, "minLength": 1}),
            {("notes", REVIEW)},
        ),
        (
            edit(hours_run={"type": "integer", "title": "Hours run", "minimum": 1}),
            {("hours_run", REVIEW)},
        ),
        (
            edit(hours_run={"type": "integer", "title": "Hours run", "minimum": -1}),
            {("hours_run", SAFE)},
        ),
        (
            edit(
                oil_pressure_psi={
                    "type": "number",
                    "title": "Oil pressure (psi)",
                    "minimum": 0,
                    "maximum": 150,
                }
            ),
            {("oil_pressure_psi", REVIEW)},
        ),
        (
            edit(oil_level={"type": "string", "title": "Oil level", "enum": ["ok", "low"]}),
            {("oil_level", REVIEW)},
        ),
        (
            edit(
                oil_level={
                    "type": "string",
                    "title": "Oil level",
                    "enum": ["ok", "low", "empty", "over"],
                }
            ),
            {("oil_level", SAFE)},
        ),
        (edit(oil_level={"type": "string", "title": "Oil level"}), {("oil_level", SAFE)}),
        (
            edit(
                site_contact={
                    "type": "string",
                    "title": "Site contact",
                    "maxLength": 120,
                    "enum": ["a"],
                }
            ),
            {("site_contact", REVIEW)},
        ),
        (
            edit(hours_run={"type": "number", "title": "Hours run", "minimum": 0}),
            {("hours_run", REFUSED)},
        ),
    ],
)
def test_each_kind_of_change_has_its_level(schema, expected):
    assert found([V1], schema) == expected


def test_a_type_is_kept_even_when_the_field_was_dropped_in_between():
    v2 = edit(notes=None)
    back_as_number = edit(v2, notes={"type": "number", "title": "Notes"})
    assert ("notes", REFUSED) in found([V1, v2], back_as_number)
    assert refused(changes([V1, v2], back_as_number))
    back_as_text = edit(v2, notes={"type": "string", "title": "Notes"})
    assert found([V1, v2], back_as_text) == {("notes", SAFE)}


def test_order_is_not_compared_when_the_old_version_has_none():
    old = {k: v for k, v in V1.items() if k != "x-order"}
    assert changes([old], V1) == []


def test_refused_changes_come_first():
    schema = edit(
        notes=None, hours_run={"type": "string", "title": "Hours run"}, extra={"type": "boolean"}
    )
    levels = [c["level"] for c in changes([V1], schema)]
    assert levels == sorted(levels, key=[REFUSED, REVIEW, SAFE].index)
    assert levels[0] == REFUSED
