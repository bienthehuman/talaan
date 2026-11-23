import {
  addField,
  allowedKinds,
  changeKind,
  checkBuilder,
  duplicateField,
  emptyModel,
  fieldName,
  fromSchema,
  hasProblems,
  kindOf,
  LIMITS,
  moveField,
  removeField,
  setFormText,
  setLabel,
  setName,
  toSchema,
  updateField,
  type BuilderField,
  type BuilderModel,
  type FieldKind,
} from "./builder";
import { parseForm } from "./schema";

/** The sample form as published from slice 6.1 (server/forms/samples.py). */
const SAMPLE = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Generator inspection",
  properties: {
    site_contact: { type: "string", title: "Site contact", maxLength: 120 },
    oil_level: { type: "string", title: "Oil level", enum: ["ok", "low", "empty"] },
    oil_pressure_psi: { type: "number", title: "Oil pressure (psi)", minimum: 0, maximum: 200 },
    coolant_ok: { type: "boolean", title: "Coolant level is correct" },
    hours_run: { type: "integer", title: "Hours run", minimum: 0 },
    notes: { type: "string", title: "Notes", maxLength: 2000 },
  },
  required: ["oil_level", "coolant_ok", "hours_run"],
  additionalProperties: false,
  "x-order": ["site_contact", "oil_level", "oil_pressure_psi", "coolant_ok", "hours_run", "notes"],
};

function model(schema: unknown = SAMPLE, history = {}): BuilderModel {
  const result = fromSchema(schema, history);
  if ("error" in result) throw new Error(result.error);
  return result.model;
}

/** Fields without the parts that are never saved (React id, name-follows-label, lock). */
function saved(m: BuilderModel) {
  return {
    ...m,
    history: undefined,
    fields: m.fields.map(({ id: _i, autoName: _a, locked: _l, ...rest }) => rest),
  };
}

function byName(m: BuilderModel, name: string): BuilderField {
  return m.fields.find((f) => f.name === name)!;
}

describe("fromSchema and toSchema", () => {
  it("round-trips the sample form exactly", () => {
    expect(toSchema(model())).toEqual(SAMPLE);
  });

  it("reads fields in x-order and marks published names as locked", () => {
    const m = model(SAMPLE, { notes: "string" });
    expect(m.fields.map((f) => f.name)).toEqual(SAMPLE["x-order"]);
    expect(byName(m, "notes").locked).toBe(true);
    expect(byName(m, "hours_run").locked).toBe(false);
  });

  it("completes an older schema: $schema, required and x-order are always written", () => {
    const old = {
      type: "object",
      properties: { a: { type: "boolean" } },
      additionalProperties: false,
    };
    expect(toSchema(model(old))).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { a: { type: "boolean" } },
      required: [],
      additionalProperties: false,
      "x-order": ["a"],
    });
  });

  it.each([
    [null, "not a JSON object"],
    [{ ...SAMPLE, pattern: "x" }, "does not know: pattern"],
    [{ ...SAMPLE, $schema: "http://json-schema.org/draft-07/schema#" }, "2020-12"],
    [{ ...SAMPLE, type: "array" }, '"type"'],
    [{ ...SAMPLE, additionalProperties: true }, "additionalProperties"],
    [{ ...SAMPLE, title: 3 }, "title must be text"],
    [{ ...SAMPLE, properties: [] }, '"properties"'],
    [{ ...SAMPLE, required: ["nope"] }, '"required"'],
    [{ ...SAMPLE, "x-order": ["notes"] }, "exactly once"],
    [{ ...SAMPLE, properties: { a: 1 }, required: [], "x-order": ["a"] }, "not an object"],
    [{ ...SAMPLE, properties: { a: { type: "array" } }, required: [], "x-order": ["a"] }, "type"],
    [
      {
        ...SAMPLE,
        properties: { a: { type: "string", format: "date" } },
        required: [],
        "x-order": ["a"],
      },
      "uses format",
    ],
    [
      {
        ...SAMPLE,
        properties: { a: { type: "string", title: 1 } },
        required: [],
        "x-order": ["a"],
      },
      "title must be text",
    ],
    [
      {
        ...SAMPLE,
        properties: { a: { type: "string", enum: [1] } },
        required: [],
        "x-order": ["a"],
      },
      "choices",
    ],
    [
      {
        ...SAMPLE,
        properties: { a: { type: "string", maxLength: "9" } },
        required: [],
        "x-order": ["a"],
      },
      "maxLength",
    ],
  ])("explains a schema it cannot show (%#)", (schema, fragment) => {
    const result = fromSchema(schema);
    expect("error" in result && result.error).toContain(fragment);
  });
});

describe("field names", () => {
  it.each([
    ["Oil pressure (psi)", "oil_pressure_psi"],
    ["  Ölstand prüfen ", "olstand_prufen"],
    ["1st check", "f_1st_check"],
    ["", "field"],
    ["!!!", "field"],
    ["Tank level", "tank_level_3"],
    ["x".repeat(80), "x".repeat(64)],
  ])("%j becomes %j", (label, name) => {
    expect(fieldName(label, new Set(["tank_level", "tank_level_2"]))).toBe(name);
  });

  it("a long name keeps its suffix within 64 characters", () => {
    const long = "y".repeat(64);
    expect(fieldName(long, new Set([long]))).toBe(`${"y".repeat(62)}_2`);
  });

  it("follows the label until edited by hand, and never for a published field", () => {
    let m = emptyModel("Pump");
    const added = addField(m, "short_text");
    m = setLabel(added.model, added.id, "Pump pressure");
    expect(m.fields[0]!.name).toBe("pump_pressure");
    m = setName(m, added.id, "pressure");
    m = setLabel(m, added.id, "Pressure at the pump");
    expect(m.fields[0]!.name).toBe("pressure");

    const published = model(SAMPLE, { notes: "string" });
    const notes = byName(published, "notes");
    const renamed = setName(setLabel(published, notes.id, "Remarks"), notes.id, "remarks");
    expect(renamed.fields.find((f) => f.id === notes.id)!.name).toBe("notes");
  });

  it("never reuses a published name by accident", () => {
    let m = emptyModel("Pump", { pressure: "number" });
    const added = addField(m, "short_text");
    m = setLabel(added.model, added.id, "Pressure");
    expect(m.fields[0]!.name).toBe("pressure_2");
  });
});

describe("edits", () => {
  it("adds, moves, duplicates and removes fields without changing the input", () => {
    const start = model();
    const frozen = JSON.stringify(start);
    const notes = byName(start, "notes").id;
    const site = byName(start, "site_contact").id;

    const moved = moveField(start, notes, -10);
    expect(moved.fields[0]!.name).toBe("notes");
    expect(moveField(start, site, -1)).toBe(start); // already first
    expect(moveField(start, "missing", 1)).toBe(start);

    const copied = duplicateField(start, site);
    expect(copied.fields[1]).toMatchObject({
      name: "site_contact_copy",
      title: "Site contact (copy)",
    });

    const { model: added, id } = addField(start, "choice", site);
    expect(added.fields[1]!.id).toBe(id);
    expect(added.fields[1]).toMatchObject({ type: "string", enum: ["Option 1", "Option 2"] });

    expect(removeField(start, notes).fields).toHaveLength(5);
    expect(JSON.stringify(start)).toBe(frozen);
  });

  it("switches kinds and keeps only the settings that kind uses", () => {
    let m = model();
    const notes = byName(m, "notes").id;
    expect(kindOf(byName(m, "notes"))).toBe("long_text");
    m = changeKind(m, notes, "short_text");
    expect(byName(m, "notes")).toMatchObject({ type: "string", maxLength: 200 });
    m = changeKind(m, notes, "long_text");
    expect(byName(m, "notes").maxLength).toBe(2000);
    m = changeKind(m, notes, "whole_number");
    expect(byName(m, "notes")).not.toHaveProperty("maxLength");
    m = updateField(m, notes, { minimum: 1, maximum: 5 });
    m = changeKind(m, notes, "yes_no");
    expect(byName(m, "notes")).toEqual(expect.objectContaining({ type: "boolean" }));
    expect(byName(m, "notes")).not.toHaveProperty("minimum");
  });

  it("a published field can only switch between kinds of the same type", () => {
    const m = model(SAMPLE, { notes: "string", hours_run: "integer" });
    expect(allowedKinds(byName(m, "notes"), m.history)).toEqual([
      "short_text",
      "long_text",
      "choice",
    ]);
    expect(allowedKinds(byName(m, "hours_run"), m.history)).toEqual(["whole_number"]);
    const hours = byName(m, "hours_run").id;
    expect(changeKind(m, hours, "number")).toEqual(m);
  });

  it("removes a setting set to undefined or empty help text", () => {
    let m = model();
    const site = byName(m, "site_contact").id;
    m = updateField(m, site, { description: "Name and phone", required: true });
    expect(toSchema(m).required).toContain("site_contact");
    m = updateField(m, site, { description: "", maxLength: undefined });
    expect(byName(m, "site_contact")).not.toHaveProperty("description");
    expect(byName(m, "site_contact")).not.toHaveProperty("maxLength");
    expect(setFormText(m, { description: "" })).not.toHaveProperty("description");
  });
});

describe("checkBuilder", () => {
  const only = (field: Partial<BuilderField>) => {
    let m = model({
      ...SAMPLE,
      properties: { a: { type: "string", title: "A" } },
      required: [],
      "x-order": ["a"],
    });
    const id = m.fields[0]!.id;
    m = { ...m, fields: [{ ...m.fields[0]!, ...field, id }] };
    return checkBuilder(m).fields[id] ?? [];
  };

  it("passes the sample form", () => {
    expect(hasProblems(checkBuilder(model()))).toBe(false);
  });

  it.each([
    [{ title: " " }, "label"],
    [{ title: "t".repeat(LIMITS.title + 1) }, "label is longer"],
    [{ description: "d".repeat(LIMITS.description + 1) }, "help text is longer"],
    [{ name: "Bad" }, "field ID must start"],
    [{ name: "x".repeat(65) }, "field ID must start"],
    [{ type: "integer", enum: ["a"] }, "Only a text field"],
    [{ enum: [] }, "at least one choice"],
    [{ enum: ["a", ""] }, "choice is empty"],
    [{ enum: ["a", "b", "a"] }, "appear twice: a"],
    [{ enum: Array.from({ length: LIMITS.choices + 1 }, (_, i) => `c${i}`) }, "At most 50"],
    [{ enum: ["c".repeat(LIMITS.choice + 1)] }, "at most 100 characters"],
    [{ maxLength: LIMITS.maxLength + 1 }, "at most 10000"],
    [{ maxLength: -1 }, "whole number, 0 or more"],
    [{ minLength: 1.5 }, "whole number, 0 or more"],
    [{ minLength: 5, maxLength: 4 }, "no answer would fit"],
    [{ type: "number", minimum: 5, maximum: 4 }, "no answer would fit"],
    [{ type: "number", minimum: Number.NaN }, "must be a number"],
  ] as [Partial<BuilderField>, string][])("flags %j", (field, fragment) => {
    expect(only(field).join(" ")).toContain(fragment);
  });

  it("flags a repeated ID and a published ID given another type", () => {
    let m = model(SAMPLE, { notes: "string" });
    m = setName(m, byName(m, "site_contact").id, "oil_level");
    m = changeKind(m, byName(m, "notes").id, "number"); // refused: stays text
    const forged = {
      ...m,
      fields: m.fields.map((f) => (f.name === "notes" ? { ...f, type: "number" as const } : f)),
    };
    const problems = checkBuilder(forged).fields;
    expect(Object.values(problems).flat().join(" ")).toContain(
      'Another field has the ID "oil_level"',
    );
    expect(Object.values(problems).flat().join(" ")).toContain('"notes" was a string');
  });

  it("flags the form as a whole", () => {
    expect(checkBuilder(emptyModel("x")).form).toContain("Add at least one field.");
    expect(checkBuilder(setFormText(model(), { title: "t".repeat(201) })).form.join()).toContain(
      "title",
    );
    let big = model();
    for (const f of big.fields) big = updateField(big, f.id, { description: "é".repeat(500) });
    for (let i = 0; i < 70; i += 1) big = duplicateField(big, big.fields[0]!.id);
    expect(checkBuilder(big).form.join()).toContain("larger than 64 KB");
  });
});

// --- randomized ------------------------------------------------------------------------------------

/** A small seeded generator (mulberry32), so a failure can be repeated from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]) => items[int(0, items.length - 1)]!;
  const chance = (p: number) => next() < p;
  const shuffle = <T>(items: T[]) => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return { int, pick, chance, shuffle };
}

const WORDS = [
  "Oil",
  "level",
  "Pump",
  "pressure",
  "Ölstand",
  "温度",
  "🔧 check",
  "notes",
  "it's",
  '"q"',
];

function randomText(r: ReturnType<typeof rng>, words = 3) {
  return Array.from({ length: r.int(1, words) }, () => r.pick(WORDS)).join(" ");
}

/** A random schema the server would accept, with keys inserted in random order. */
function randomSchema(r: ReturnType<typeof rng>): Record<string, unknown> {
  const count = r.int(1, 12);
  const names = new Set<string>();
  while (names.size < count)
    names.add(`${r.pick(["a", "b", "f", "z"])}${r.int(0, 999)}_${r.int(0, 9)}`);
  const properties: Record<string, Record<string, unknown>> = {};
  for (const name of r.shuffle([...names])) {
    const type = r.pick(["string", "number", "integer", "boolean"] as const);
    const spec: Record<string, unknown> = { type };
    if (r.chance(0.8)) spec.title = randomText(r);
    if (r.chance(0.3)) spec.description = randomText(r, 8);
    if (type === "string" && r.chance(0.3)) {
      spec.enum = [...new Set(Array.from({ length: r.int(1, 6) }, () => randomText(r, 2)))];
    } else if (type === "string") {
      if (r.chance(0.3)) spec.minLength = r.int(0, 5);
      if (r.chance(0.7)) spec.maxLength = r.pick([50, 120, 200, 201, 2000, 10000]);
    } else if (type !== "boolean") {
      const lo = type === "integer" ? r.int(-50, 50) : r.int(-500, 500) / 10;
      if (r.chance(0.6)) spec.minimum = lo;
      if (r.chance(0.6))
        spec.maximum = lo + (type === "integer" ? r.int(0, 100) : r.int(0, 1000) / 10);
    }
    properties[name] = Object.fromEntries(r.shuffle(Object.entries(spec)));
  }
  const order = r.shuffle([...names]);
  const required = r.shuffle([...names].filter(() => r.chance(0.4)));
  const top: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
    "x-order": order,
  };
  if (r.chance(0.7)) top.$schema = "https://json-schema.org/draft/2020-12/schema";
  if (r.chance(0.8)) top.title = randomText(r);
  if (r.chance(0.2)) top.description = randomText(r, 6);
  if (r.chance(0.8)) top.required = required;
  return Object.fromEntries(r.shuffle(Object.entries(top)));
}

/** What a schema means, independent of key order: $schema is implied; required is a set. */
function meaning(schema: Record<string, unknown>) {
  const rest = { ...schema };
  delete rest.$schema;
  return { ...rest, required: [...((schema.required as string[]) ?? [])].sort() };
}

describe("randomized round trips (seeded)", () => {
  it("any valid schema -> model -> schema means the same and shows the same fields in order", () => {
    for (let seed = 1; seed <= 600; seed += 1) {
      const r = rng(seed);
      const schema = randomSchema(r);
      const result = fromSchema(schema);
      expect("model" in result, `seed ${seed}`).toBe(true);
      const m = (result as { model: BuilderModel }).model;
      const again = toSchema(m);
      expect(meaning(again), `seed ${seed}`).toEqual(meaning(schema));
      expect(again["x-order"]).toEqual(schema["x-order"]);
      expect(parseForm(again), `seed ${seed}`).toEqual(parseForm(schema));
      expect(saved(model(again)), `seed ${seed}`).toEqual(saved(m));
      expect(toSchema(model(again))).toEqual(again); // written once, stable from then on
    }
  });

  const KINDS: FieldKind[] = [
    "short_text",
    "long_text",
    "choice",
    "yes_no",
    "whole_number",
    "number",
  ];

  it("any sequence of edits gives a schema that reads back as the same model", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const r = rng(10_000 + seed);
      let m = r.chance(0.5) ? model() : emptyModel(randomText(r), { notes: "string" });
      for (let step = 0; step < 25; step += 1) {
        const target = m.fields.length ? r.pick(m.fields).id : "";
        switch (r.int(0, 8)) {
          case 0:
            m = addField(m, r.pick(KINDS), r.chance(0.5) ? target : undefined).model;
            break;
          case 1:
            m = setLabel(m, target, randomText(r));
            break;
          case 2:
            m = moveField(m, target, r.int(-3, 3));
            break;
          case 3:
            m = r.chance(0.3) ? removeField(m, target) : duplicateField(m, target);
            break;
          case 4:
            m = changeKind(m, target, r.pick(KINDS));
            break;
          case 5:
            m = updateField(m, target, { required: r.chance(0.5) });
            break;
          case 6:
            m = updateField(m, target, { description: r.chance(0.3) ? "" : randomText(r, 6) });
            break;
          case 7:
            m = setFormText(m, { title: randomText(r) });
            break;
          default:
            m = setName(m, target, `n${r.int(0, 30)}`);
        }
      }
      const schema = toSchema(m);
      expect(schema["x-order"]).toEqual(m.fields.map((f) => f.name));
      expect(new Set(m.fields.map((f) => f.id)).size).toBe(m.fields.length);
      const names = m.fields.map((f) => f.name);
      if (new Set(names).size === names.length) {
        expect(saved(model(schema)), `seed ${seed}`).toEqual(saved(m));
      } else {
        // Two fields share an ID: the builder must say so before anything is published.
        expect(hasProblems(checkBuilder(m)), `seed ${seed}`).toBe(true);
      }
    }
  });
});
