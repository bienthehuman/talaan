"""The client's form builder and the server agree (client/src/forms/builder-samples.test.ts writes
the file). A sample the builder accepts must pass the publish rules; one it refuses must be refused
here too, so the builder can neither block a good form nor let a bad one through to publish."""

import json
import pathlib

import pytest

from forms.schema import validate_form_schema

FILE = pathlib.Path(__file__).resolve().parents[3] / "client/src/forms/builder-samples.json"
SAMPLES = json.loads(FILE.read_text(encoding="utf-8"))


def test_the_file_has_both_kinds():
    assert {s["builder_accepts"] for s in SAMPLES} == {True, False}


@pytest.mark.parametrize("sample", SAMPLES, ids=[s["name"] for s in SAMPLES])
def test_builder_and_server_agree(sample):
    problems = validate_form_schema(sample["schema"])
    assert (problems == []) == sample["builder_accepts"], problems
