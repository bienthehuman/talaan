"""What changes between a form's published versions (DATA_MODEL.md section 5, ADR 0013).

`changes(history, schema)` compares a candidate schema with the form's published versions, oldest
first. The last one is the baseline for the change summary; all of them are used for the one hard
rule: a field name keeps its type for the life of a form, so data can be read across versions by
name.

Each change is `{"level", "field", "message"}` with level `safe`, `review` (shown to the admin
before they confirm) or `refused` (blocks the publish). Messages are for admins, in plain words.
"""

SAFE, REVIEW, REFUSED = "safe", "review", "refused"
_LEVELS = {REFUSED: 0, REVIEW: 1, SAFE: 2}

# (key, a larger value is "tighter") for each limit.
_LIMITS = (("minLength", True), ("maxLength", False), ("minimum", True), ("maximum", False))


def _change(level: str, field: str, message: str) -> dict:
    return {"level": level, "field": field, "message": message}


def _props(schema: dict) -> dict:
    props = schema.get("properties")
    return props if isinstance(props, dict) else {}


def _label(name: str, spec: object) -> str:
    title = spec.get("title") if isinstance(spec, dict) else None
    return f'"{title}"' if isinstance(title, str) and title else f'"{name}"'


def _types(history: list[dict]) -> dict[str, str]:
    """The type each field name has had in this form (the rule keeps it unique)."""
    seen: dict[str, str] = {}
    for schema in history:
        for name, spec in _props(schema).items():
            if isinstance(spec, dict) and isinstance(spec.get("type"), str):
                seen.setdefault(name, spec["type"])
    return seen


def _limit_changes(name: str, old: dict, new: dict) -> list[dict]:
    out = []
    label = _label(name, new)
    for key, larger_is_tighter in _LIMITS:
        before, after = old.get(key), new.get(key)
        if before == after:
            continue
        if after is None:
            tighter = False
        elif before is None:
            tighter = True
        else:
            tighter = (after > before) == larger_is_tighter
        if tighter:
            out.append(_change(REVIEW, name, f'{label}: the "{key}" limit is stricter.'))
        else:
            out.append(_change(SAFE, name, f'{label}: the "{key}" limit is looser.'))
    return out


def _choice_changes(name: str, old: dict, new: dict) -> list[dict]:
    before, after = old.get("enum"), new.get("enum")
    label = _label(name, new)
    if before == after:
        return []
    if before is None:
        return [
            _change(REVIEW, name, f"{label} becomes a choice; free text is no longer accepted.")
        ]
    if after is None:
        return [_change(SAFE, name, f"{label} accepts any text instead of a choice.")]
    out = []
    if removed := [c for c in before if c not in after]:
        out.append(
            _change(
                REVIEW,
                name,
                f"{label}: choices removed: {', '.join(removed)}. "
                "Inspections already started keep them.",
            )
        )
    if added := [c for c in after if c not in before]:
        out.append(_change(SAFE, name, f"{label}: choices added: {', '.join(added)}."))
    if not removed and not added:
        out.append(_change(SAFE, name, f"{label}: choices are in a different order."))
    return out


def changes(history: list[dict], schema: dict) -> list[dict]:
    """Changes from the latest of `history` (published schemas, oldest first) to `schema`."""
    new_props = _props(schema)
    out: list[dict] = []

    types = _types(history)
    for name, spec in new_props.items():
        kind = spec.get("type") if isinstance(spec, dict) else None
        if name in types and kind != types[name]:
            out.append(
                _change(
                    REFUSED,
                    name,
                    f'Field "{name}" was a {types[name]} in an earlier version and cannot become '
                    f"a {kind}. Add a new field with a new name instead.",
                )
            )

    if not history:
        return sorted(out, key=_order)
    old = history[-1]
    old_props = _props(old)
    old_required = set(old.get("required") or [])
    new_required = set(schema.get("required") or [])

    if old.get("title") != schema.get("title"):
        out.append(_change(SAFE, "", "The form title changes."))
    old_order, new_order = old.get("x-order"), schema.get("x-order")
    if isinstance(old_order, list) and isinstance(new_order, list):
        kept = [n for n in new_order if n in old_props]
        if kept != [n for n in old_order if n in new_props]:
            out.append(_change(SAFE, "", "Fields are in a different order."))

    for name, old_spec in old_props.items():
        if name not in new_props:
            out.append(
                _change(
                    REVIEW,
                    name,
                    f"{_label(name, old_spec)} is removed. Workers will no longer see it; "
                    "inspections already started keep it.",
                )
            )

    for name, spec in new_props.items():
        if not isinstance(spec, dict):
            continue
        label = _label(name, spec)
        if name not in old_props:
            if name in new_required:
                out.append(_change(REVIEW, name, f"{label} is added and must be filled in."))
            else:
                out.append(_change(SAFE, name, f"{label} is added."))
            continue
        old_spec = old_props[name]
        if not isinstance(old_spec, dict) or old_spec.get("type") != spec.get("type"):
            continue  # a type change is refused above
        for key in ("title", "description"):
            if old_spec.get(key) != spec.get(key):
                out.append(_change(SAFE, name, f"{label}: the {key} changes."))
        if name in new_required and name not in old_required:
            out.append(_change(REVIEW, name, f"{label} must now be filled in."))
        elif name in old_required and name not in new_required:
            out.append(_change(SAFE, name, f"{label} is no longer required."))
        out.extend(_choice_changes(name, old_spec, spec))
        out.extend(_limit_changes(name, old_spec, spec))

    return sorted(out, key=_order)


def _order(change: dict) -> tuple:
    return (_LEVELS[change["level"]], change["field"], change["message"])


def refused(found: list[dict]) -> list[str]:
    return [c["message"] for c in found if c["level"] == REFUSED]
