"""docs/DATA_MODEL.md is the source of truth for the form schema format; the sample in code must
match the one printed there."""

import json
import re
from pathlib import Path

from forms.samples import GENERATOR_INSPECTION

DATA_MODEL = Path(__file__).resolve().parents[3] / "docs" / "DATA_MODEL.md"


def test_sample_in_code_matches_the_document():
    text = DATA_MODEL.read_text()
    section = text.split("### Sample form schema", 1)[1]
    block = re.search(r"```json\n(.*?)\n```", section, re.S)
    assert block, "DATA_MODEL.md has no json block under '### Sample form schema'"
    assert json.loads(block.group(1)) == GENERATOR_INSPECTION
