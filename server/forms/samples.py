"""A sample form used by the demo seed and the tests. It is also printed in docs/DATA_MODEL.md
section 5, and a test fails if the two drift apart."""

GENERATOR_INSPECTION = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "title": "Generator inspection",
    "properties": {
        "site_contact": {"type": "string", "title": "Site contact", "maxLength": 120},
        "oil_level": {"type": "string", "title": "Oil level", "enum": ["ok", "low", "empty"]},
        "oil_pressure_psi": {
            "type": "number",
            "title": "Oil pressure (psi)",
            "minimum": 0,
            "maximum": 200,
        },
        "coolant_ok": {"type": "boolean", "title": "Coolant level is correct"},
        "hours_run": {"type": "integer", "title": "Hours run", "minimum": 0},
        "notes": {"type": "string", "title": "Notes", "maxLength": 2000},
    },
    "required": ["oil_level", "coolant_ok", "hours_run"],
    "additionalProperties": False,
    "x-order": [
        "site_contact",
        "oil_level",
        "oil_pressure_psi",
        "coolant_ok",
        "hours_run",
        "notes",
    ],
}
