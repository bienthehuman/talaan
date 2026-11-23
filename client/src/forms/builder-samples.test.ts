/** Schemas made with the builder, written to builder-samples.json. The server reads the same file
 *  (server/forms/tests/test_builder_samples.py): each sample the builder accepts must pass the
 *  server's publish rules, and each it refuses must be refused there too. Rewrite the file after a
 *  deliberate change with `UPDATE_BUILDER_SAMPLES=1 npx vitest run src/forms/builder-samples`. */

import { readFileSync, writeFileSync } from "node:fs";
import {
  addField,
  changeKind,
  checkBuilder,
  emptyModel,
  hasProblems,
  LIMITS,
  setFormText,
  setLabel,
  setName,
  toSchema,
  updateField,
  type BuilderModel,
  type FieldKind,
} from "./builder";

const FILE = "src/forms/builder-samples.json";

type Edit = (m: BuilderModel, id: string) => BuilderModel;

/** A one-field form: a field of `kind` labelled `label`, then `edit`. */
function one(kind: FieldKind, label: string, edit: Edit = (m) => m): BuilderModel {
  const added = addField(emptyModel("Sample"), kind);
  return edit(setLabel(added.model, added.id, label), added.id);
}

function many(count: number): BuilderModel {
  let m = emptyModel("Many fields");
  for (let i = 0; i < count; i += 1) {
    const added = addField(m, "yes_no");
    m = setLabel(added.model, added.id, `Check ${i + 1}`);
  }
  return m;
}

function generator(): BuilderModel {
  let m = emptyModel("Generator inspection");
  const steps: [FieldKind, string, Edit?][] = [
    ["short_text", "Site contact", (x, id) => updateField(x, id, { maxLength: 120 })],
    [
      "choice",
      "Oil level",
      (x, id) => updateField(x, id, { enum: ["ok", "low", "empty"], required: true }),
    ],
    ["number", "Oil pressure (psi)", (x, id) => updateField(x, id, { minimum: 0, maximum: 200 })],
    ["yes_no", "Coolant level is correct", (x, id) => updateField(x, id, { required: true })],
    ["whole_number", "Hours run", (x, id) => updateField(x, id, { minimum: 0, required: true })],
    ["long_text", "Notes"],
  ];
  for (const [kind, label, edit] of steps) {
    const added = addField(m, kind);
    m = setLabel(added.model, added.id, label);
    if (edit) m = edit(m, added.id);
  }
  return m;
}

const choices = (n: number, size = 3) =>
  Array.from({ length: n }, (_, i) => `${i}`.padStart(size, "c"));

function samples(): { name: string; model: BuilderModel }[] {
  return [
    { name: "generator inspection", model: generator() },
    { name: "short text", model: one("short_text", "Site name") },
    { name: "long text", model: one("long_text", "Remarks") },
    { name: "choice", model: one("choice", "Condition") },
    { name: "yes/no", model: one("yes_no", "Guard fitted") },
    { name: "whole number", model: one("whole_number", "Count") },
    {
      name: "number",
      model: one("number", "Reading", (m, id) =>
        updateField(m, id, { minimum: -2.5, maximum: 7.25 }),
      ),
    },
    {
      name: "unicode label and help",
      model: one("short_text", "Température 🔧", (m, id) =>
        updateField(m, id, { description: "Prüfen — 温度" }),
      ),
    },
    {
      name: "kind switched twice",
      model: one("choice", "Level", (m, id) =>
        changeKind(changeKind(m, id, "long_text"), id, "short_text"),
      ),
    },
    {
      name: "equal bounds",
      model: one("whole_number", "Exactly three", (m, id) =>
        updateField(m, id, { minimum: 3, maximum: 3 }),
      ),
    },
    { name: "at the field limit", model: many(LIMITS.fields) },
    {
      name: "title at its limit",
      model: setFormText(one("yes_no", "Ok"), { title: "t".repeat(LIMITS.title) }),
    },
    { name: "label at its limit", model: one("yes_no", "l".repeat(LIMITS.title)) },
    {
      name: "help at its limit",
      model: one("yes_no", "Ok", (m, id) =>
        updateField(m, id, { description: "d".repeat(LIMITS.description) }),
      ),
    },
    {
      name: "choices at their limit",
      model: one("choice", "Pick", (m, id) =>
        updateField(m, id, { enum: choices(LIMITS.choices, LIMITS.choice) }),
      ),
    },
    {
      name: "longest text limit",
      model: one("long_text", "Essay", (m, id) =>
        updateField(m, id, { maxLength: LIMITS.maxLength }),
      ),
    },
    {
      name: "64-character ID",
      model: one("yes_no", "Ok", (m, id) => setName(m, id, `a${"b".repeat(63)}`)),
    },
    { name: "too many fields", model: many(LIMITS.fields + 1) },
    {
      name: "title too long",
      model: setFormText(one("yes_no", "Ok"), { title: "t".repeat(LIMITS.title + 1) }),
    },
    { name: "label too long", model: one("yes_no", "l".repeat(LIMITS.title + 1)) },
    {
      name: "help too long",
      model: one("yes_no", "Ok", (m, id) =>
        updateField(m, id, { description: "d".repeat(LIMITS.description + 1) }),
      ),
    },
    {
      name: "too many choices",
      model: one("choice", "Pick", (m, id) =>
        updateField(m, id, { enum: choices(LIMITS.choices + 1) }),
      ),
    },
    {
      name: "choice too long",
      model: one("choice", "Pick", (m, id) =>
        updateField(m, id, { enum: ["c".repeat(LIMITS.choice + 1)] }),
      ),
    },
    {
      name: "no choices",
      model: one("choice", "Pick", (m, id) => updateField(m, id, { enum: [] })),
    },
    {
      name: "empty choice",
      model: one("choice", "Pick", (m, id) => updateField(m, id, { enum: ["a", ""] })),
    },
    {
      name: "repeated choice",
      model: one("choice", "Pick", (m, id) => updateField(m, id, { enum: ["a", "a"] })),
    },
    {
      name: "text limit too large",
      model: one("long_text", "Essay", (m, id) =>
        updateField(m, id, { maxLength: LIMITS.maxLength + 1 }),
      ),
    },
    {
      name: "shortest above longest",
      model: one("short_text", "Code", (m, id) =>
        updateField(m, id, { minLength: 9, maxLength: 4 }),
      ),
    },
    {
      name: "smallest above largest",
      model: one("number", "Reading", (m, id) => updateField(m, id, { minimum: 5, maximum: 4.5 })),
    },
    {
      name: "negative longest",
      model: one("short_text", "Code", (m, id) => updateField(m, id, { maxLength: -1 })),
    },
    {
      name: "ID starts with a digit",
      model: one("yes_no", "Ok", (m, id) => setName(m, id, "1st")),
    },
    { name: "ID with capitals", model: one("yes_no", "Ok", (m, id) => setName(m, id, "Okay")) },
    {
      name: "65-character ID",
      model: one("yes_no", "Ok", (m, id) => setName(m, id, `a${"b".repeat(64)}`)),
    },
    { name: "no fields", model: emptyModel("Empty") },
  ];
}

function build() {
  return samples().map(({ name, model }) => ({
    name,
    builder_accepts: !hasProblems(checkBuilder(model)),
    schema: toSchema(model),
  }));
}

describe("shared builder samples", () => {
  it("builder-samples.json is what the builder makes today", () => {
    const now = build();
    if (process.env.UPDATE_BUILDER_SAMPLES) {
      writeFileSync(FILE, `${JSON.stringify(now, null, 2)}\n`);
    }
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(now);
  });

  it("has both accepted and refused samples", () => {
    const flags = build().map((s) => s.builder_accepts);
    expect(flags.filter(Boolean).length).toBe(17);
    expect(flags.filter((f) => !f).length).toBe(17);
  });
});
