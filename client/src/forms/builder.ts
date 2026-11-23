/** The form builder's model (docs/FORM_BUILDER_PLAN.md section 4.8).
 *
 *  The builder edits the same JSON Schema subset the server stores (DATA_MODEL.md section 5); this
 *  module converts between that document and a list of fields, and offers the edits the builder
 *  screen needs. Every function is pure: it returns a new model and never changes its input.
 *
 *  `checkBuilder` mirrors the server's publish rules so problems can be shown on the field they
 *  belong to. The server stays the judge: a shared sample file (builder-samples.json) is checked
 *  by both sides, so the two cannot drift apart unnoticed. */

import { fieldOrder } from "./schema";

/** Same numbers as server/forms/schema.py. */
export const LIMITS = {
  fields: 100,
  title: 200,
  description: 500,
  choices: 50,
  choice: 100,
  maxLength: 10_000,
  schemaBytes: 64 * 1024,
} as const;

/** A string field with a longer limit than this is shown as a textarea (forms/FormFields.tsx). */
export const SHORT_TEXT_MAX = 200;
export const LONG_TEXT_DEFAULT = 2000;
export const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const NAME_MAX = 64;
const JSON_SCHEMA = "https://json-schema.org/draft/2020-12/schema";

export type SchemaType = "string" | "number" | "integer" | "boolean";
export type FieldKind =
  "short_text" | "long_text" | "choice" | "yes_no" | "whole_number" | "number";

export interface BuilderField {
  /** For React keys only; never saved. */
  id: string;
  /** The stable key of submission data. */
  name: string;
  /** The name follows the label until it is edited by hand. */
  autoName: boolean;
  /** Published in an earlier version: the name can no longer change (ADR 0013). */
  locked: boolean;
  type: SchemaType;
  title?: string;
  description?: string;
  required: boolean;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface BuilderModel {
  title?: string;
  description?: string;
  fields: BuilderField[];
  /** Every field name this form has published, with its type. Those names keep that type. */
  history: Record<string, SchemaType>;
}

export interface BuilderProblems {
  form: string[];
  /** By field id. Only fields with problems are present. */
  fields: Record<string, string[]>;
}

const TYPES: readonly SchemaType[] = ["string", "number", "integer", "boolean"];
const TOP_KEYS = new Set([
  "$schema",
  "type",
  "title",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "x-order",
]);
const FIELD_KEYS = new Set([
  "type",
  "title",
  "description",
  "enum",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
]);
const LIMIT_KEYS = ["minLength", "maxLength", "minimum", "maximum"] as const;

let counter = 0;
function newId(): string {
  counter += 1;
  return `field-${counter}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// --- schema <-> model ----------------------------------------------------------------------------

/** The builder's model of a schema, or why the builder cannot show it (the JSON tab still can).
 *  `history` is the form's published field names and their types. */
export function fromSchema(
  schema: unknown,
  history: Record<string, SchemaType> = {},
): { model: BuilderModel } | { error: string } {
  if (!isObject(schema)) return { error: "The form is not a JSON object." };
  const unknown = Object.keys(schema).filter((k) => !TOP_KEYS.has(k));
  if (unknown.length) return { error: `The builder does not know: ${unknown.join(", ")}.` };
  if (schema.$schema !== undefined && schema.$schema !== JSON_SCHEMA) {
    return { error: 'Only the 2020-12 "$schema" is supported.' };
  }
  if (schema.type !== "object") return { error: 'The top-level "type" must be "object".' };
  if (schema.additionalProperties !== false) {
    return { error: '"additionalProperties" must be false.' };
  }
  for (const key of ["title", "description"] as const) {
    if (schema[key] !== undefined && typeof schema[key] !== "string") {
      return { error: `The form's ${key} must be text.` };
    }
  }
  const properties = schema.properties ?? {};
  if (!isObject(properties)) return { error: '"properties" must be an object.' };
  const required = schema.required ?? [];
  if (
    !Array.isArray(required) ||
    !required.every((r) => typeof r === "string" && Object.hasOwn(properties, r))
  ) {
    return { error: '"required" must list fields of this form.' };
  }
  const order = schema["x-order"];
  const names = fieldOrder(properties, order);
  if (order !== undefined && names !== order) {
    return { error: '"x-order" must list every field exactly once.' };
  }

  const fields: BuilderField[] = [];
  for (const name of names) {
    const spec = properties[name];
    if (!isObject(spec)) return { error: `Field "${name}" is not an object.` };
    const extra = Object.keys(spec).filter((k) => !FIELD_KEYS.has(k));
    if (extra.length) return { error: `Field "${name}" uses ${extra.join(", ")}.` };
    if (!TYPES.includes(spec.type as SchemaType)) {
      return { error: `Field "${name}" has a type the builder does not know.` };
    }
    for (const key of ["title", "description"] as const) {
      if (spec[key] !== undefined && typeof spec[key] !== "string") {
        return { error: `Field "${name}": ${key} must be text.` };
      }
    }
    if (
      spec.enum !== undefined &&
      !(Array.isArray(spec.enum) && spec.enum.every((c) => typeof c === "string"))
    ) {
      return { error: `Field "${name}": choices must be text.` };
    }
    for (const key of LIMIT_KEYS) {
      if (spec[key] !== undefined && !isNumber(spec[key])) {
        return { error: `Field "${name}": ${key} must be a number.` };
      }
    }
    const field: BuilderField = {
      id: newId(),
      name,
      autoName: false,
      locked: Object.hasOwn(history, name),
      type: spec.type as SchemaType,
      required: required.includes(name),
    };
    if (spec.title !== undefined) field.title = spec.title as string;
    if (spec.description !== undefined) field.description = spec.description as string;
    if (spec.enum !== undefined) field.enum = [...(spec.enum as string[])];
    for (const key of LIMIT_KEYS) if (spec[key] !== undefined) field[key] = spec[key] as number;
    fields.push(field);
  }

  const model: BuilderModel = { fields, history: { ...history } };
  if (schema.title !== undefined) model.title = schema.title as string;
  if (schema.description !== undefined) model.description = schema.description as string;
  return { model };
}

/** The schema the server stores. Always complete: `$schema`, `required` and `x-order` included. */
export function toSchema(model: BuilderModel): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const f of model.fields) {
    const spec: Record<string, unknown> = { type: f.type };
    if (f.title !== undefined) spec.title = f.title;
    if (f.description !== undefined) spec.description = f.description;
    if (f.enum !== undefined) spec.enum = [...f.enum];
    for (const key of LIMIT_KEYS) if (f[key] !== undefined) spec[key] = f[key];
    properties[f.name] = spec;
  }
  const schema: Record<string, unknown> = { $schema: JSON_SCHEMA, type: "object" };
  if (model.title !== undefined) schema.title = model.title;
  if (model.description !== undefined) schema.description = model.description;
  schema.properties = properties;
  schema.required = model.fields.filter((f) => f.required).map((f) => f.name);
  schema.additionalProperties = false;
  schema["x-order"] = model.fields.map((f) => f.name);
  return schema;
}

/** A blank form for the builder. */
export function emptyModel(title: string, history: Record<string, SchemaType> = {}): BuilderModel {
  return { title, fields: [], history: { ...history } };
}

// --- kinds ---------------------------------------------------------------------------------------

/** The plain-words type the builder shows for a field. */
export function kindOf(field: Pick<BuilderField, "type" | "enum" | "maxLength">): FieldKind {
  if (field.type === "boolean") return "yes_no";
  if (field.type === "integer") return "whole_number";
  if (field.type === "number") return "number";
  if (field.enum !== undefined) return "choice";
  return (field.maxLength ?? 0) > SHORT_TEXT_MAX ? "long_text" : "short_text";
}

export function typeOf(kind: FieldKind): SchemaType {
  if (kind === "yes_no") return "boolean";
  if (kind === "whole_number") return "integer";
  if (kind === "number") return "number";
  return "string";
}

/** The kinds a field may switch to: a published name keeps its type (ADR 0013). */
export function allowedKinds(field: BuilderField, history: BuilderModel["history"]): FieldKind[] {
  const all: FieldKind[] = [
    "short_text",
    "long_text",
    "choice",
    "yes_no",
    "whole_number",
    "number",
  ];
  const kept = history[field.name];
  return kept === undefined ? all : all.filter((k) => typeOf(k) === kept);
}

function asKind(field: BuilderField, kind: FieldKind): BuilderField {
  const next: BuilderField = { ...field, type: typeOf(kind) };
  delete next.enum;
  if (kind !== "short_text" && kind !== "long_text") {
    delete next.minLength;
    delete next.maxLength;
  }
  if (kind !== "whole_number" && kind !== "number") {
    delete next.minimum;
    delete next.maximum;
  }
  if (kind === "short_text" && (next.maxLength === undefined || next.maxLength > SHORT_TEXT_MAX)) {
    next.maxLength = SHORT_TEXT_MAX;
  }
  if (kind === "long_text" && (next.maxLength ?? 0) <= SHORT_TEXT_MAX) {
    next.maxLength = LONG_TEXT_DEFAULT;
  }
  if (kind === "choice") next.enum = field.enum ? [...field.enum] : ["Option 1", "Option 2"];
  return next;
}

// --- names ---------------------------------------------------------------------------------------

/** A field name made from a label ("Oil pressure (psi)" -> "oil_pressure_psi"), not in `taken`. */
export function fieldName(label: string, taken: ReadonlySet<string>): string {
  let base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) base = "field";
  if (!/^[a-z]/.test(base)) base = `f_${base}`;
  base = base.slice(0, NAME_MAX).replace(/_+$/, "");
  let name = base;
  for (let n = 2; taken.has(name); n += 1) {
    const suffix = `_${n}`;
    name = base.slice(0, NAME_MAX - suffix.length).replace(/_+$/, "") + suffix;
  }
  return name;
}

/** Names a new or renamed field must avoid: the others on the form, and every published name,
 *  so a retired name is never reused by accident. */
function takenNames(model: BuilderModel, except?: string): Set<string> {
  const taken = new Set(Object.keys(model.history));
  for (const f of model.fields) if (f.id !== except) taken.add(f.name);
  return taken;
}

// --- edits ---------------------------------------------------------------------------------------

function replace(model: BuilderModel, id: string, change: (f: BuilderField) => BuilderField) {
  return { ...model, fields: model.fields.map((f) => (f.id === id ? change(f) : f)) };
}

export function setFormText(
  model: BuilderModel,
  text: { title?: string; description?: string },
): BuilderModel {
  const next = { ...model, ...text };
  if (next.description === "") delete next.description;
  return next;
}

/** Add a field of `kind` after `afterId` (at the end when omitted). Returns its id too. */
export function addField(
  model: BuilderModel,
  kind: FieldKind,
  afterId?: string,
): { model: BuilderModel; id: string } {
  const base: BuilderField = {
    id: newId(),
    name: fieldName("", takenNames(model)),
    autoName: true,
    locked: false,
    type: "string",
    title: "",
    required: false,
  };
  const field = asKind(base, kind);
  const at = afterId ? model.fields.findIndex((f) => f.id === afterId) + 1 : model.fields.length;
  const fields = [...model.fields];
  fields.splice(at > 0 ? at : model.fields.length, 0, field);
  return { model: { ...model, fields }, id: field.id };
}

/** Change a label. An unpublished field whose name was never edited by hand follows it. */
export function setLabel(model: BuilderModel, id: string, title: string): BuilderModel {
  return replace(model, id, (f) => ({
    ...f,
    title,
    name: f.autoName && !f.locked ? fieldName(title, takenNames(model, id)) : f.name,
  }));
}

/** Edit a name by hand. A published name cannot change. */
export function setName(model: BuilderModel, id: string, name: string): BuilderModel {
  return replace(model, id, (f) => (f.locked ? f : { ...f, name, autoName: false }));
}

export function changeKind(model: BuilderModel, id: string, kind: FieldKind): BuilderModel {
  return replace(model, id, (f) =>
    allowedKinds(f, model.history).includes(kind) && kindOf(f) !== kind ? asKind(f, kind) : f,
  );
}

type Editable = Pick<
  BuilderField,
  "description" | "required" | "enum" | "minLength" | "maxLength" | "minimum" | "maximum"
>;

/** Change help text, Required, choices or limits. `undefined` removes a setting. */
export function updateField(
  model: BuilderModel,
  id: string,
  patch: Partial<Editable>,
): BuilderModel {
  return replace(model, id, (f) => {
    const next = { ...f, ...patch } as BuilderField;
    for (const key of Object.keys(patch) as (keyof Editable)[]) {
      if (patch[key] === undefined || (key === "description" && patch[key] === "")) {
        delete next[key];
      }
    }
    if (patch.enum) next.enum = [...patch.enum];
    return next;
  });
}

export function moveField(model: BuilderModel, id: string, by: number): BuilderModel {
  const from = model.fields.findIndex((f) => f.id === id);
  if (from < 0) return model;
  const to = Math.max(0, Math.min(model.fields.length - 1, from + by));
  if (to === from) return model;
  const fields = [...model.fields];
  const [moved] = fields.splice(from, 1);
  fields.splice(to, 0, moved!);
  return { ...model, fields };
}

export function removeField(model: BuilderModel, id: string): BuilderModel {
  return { ...model, fields: model.fields.filter((f) => f.id !== id) };
}

/** A copy of a field right after it, with its own new name. */
export function duplicateField(model: BuilderModel, id: string): BuilderModel {
  const at = model.fields.findIndex((f) => f.id === id);
  if (at < 0) return model;
  const source = model.fields[at]!;
  const title = `${source.title ?? source.name} (copy)`;
  const copy: BuilderField = {
    ...source,
    id: newId(),
    title,
    name: fieldName(title, takenNames(model)),
    autoName: true,
    locked: false,
  };
  if (source.enum) copy.enum = [...source.enum];
  const fields = [...model.fields];
  fields.splice(at + 1, 0, copy);
  return { ...model, fields };
}

// --- checks --------------------------------------------------------------------------------------

function textProblems(what: string, text: { title?: string; description?: string }): string[] {
  const out: string[] = [];
  if ((text.title?.length ?? 0) > LIMITS.title) {
    out.push(`${what} is longer than ${LIMITS.title} characters.`);
  }
  if ((text.description?.length ?? 0) > LIMITS.description) {
    out.push(`The help text is longer than ${LIMITS.description} characters.`);
  }
  return out;
}

function fieldProblems(f: BuilderField, model: BuilderModel, names: Map<string, number>): string[] {
  const out: string[] = [];
  if (!f.title?.trim()) out.push("Give this field a label.");
  out.push(...textProblems("The label", f));
  if (!NAME_PATTERN.test(f.name)) {
    out.push(
      "The field ID must start with a letter and use only lowercase letters, digits and " +
        "underscores, at most 64 characters.",
    );
  } else if ((names.get(f.name) ?? 0) > 1) {
    out.push(`Another field has the ID "${f.name}".`);
  }
  const kept = model.history[f.name];
  if (kept !== undefined && kept !== f.type) {
    out.push(`"${f.name}" was a ${kept} in an earlier version; give this field a new ID.`);
  }
  if (f.enum !== undefined) {
    if (f.type !== "string") out.push("Only a text field can have choices.");
    if (f.enum.length === 0) out.push("Add at least one choice.");
    if (f.enum.length > LIMITS.choices) out.push(`At most ${LIMITS.choices} choices.`);
    if (f.enum.some((c) => c === "")) out.push("A choice is empty.");
    if (f.enum.some((c) => c.length > LIMITS.choice)) {
      out.push(`Each choice is at most ${LIMITS.choice} characters.`);
    }
    const repeated = [...new Set(f.enum.filter((c, i) => c && f.enum!.indexOf(c) !== i))];
    if (repeated.length) out.push(`These choices appear twice: ${repeated.join(", ")}.`);
  }
  for (const key of ["minLength", "maxLength"] as const) {
    const value = f[key];
    if (value !== undefined && !(Number.isInteger(value) && value >= 0)) {
      out.push(
        `The ${key === "minLength" ? "shortest" : "longest"} answer must be a whole number, 0 or more.`,
      );
    }
  }
  for (const key of ["minimum", "maximum"] as const) {
    if (f[key] !== undefined && !isNumber(f[key])) {
      out.push(`The ${key === "minimum" ? "smallest" : "largest"} value must be a number.`);
    }
  }
  if (isNumber(f.maxLength) && f.maxLength > LIMITS.maxLength) {
    out.push(`The longest answer is at most ${LIMITS.maxLength} characters.`);
  }
  if (isNumber(f.minLength) && isNumber(f.maxLength) && f.minLength > f.maxLength) {
    out.push("The shortest answer is longer than the longest, so no answer would fit.");
  }
  if (isNumber(f.minimum) && isNumber(f.maximum) && f.minimum > f.maximum) {
    out.push("The smallest value is larger than the largest, so no answer would fit.");
  }
  return out;
}

/** What would stop this form being published, in plain words, per field where possible. The
 *  server checks again on publish, including changes against earlier versions. */
export function checkBuilder(model: BuilderModel): BuilderProblems {
  const form = textProblems("The form title", model);
  if (model.fields.length === 0) form.push("Add at least one field.");
  if (model.fields.length > LIMITS.fields)
    form.push(`A form can have at most ${LIMITS.fields} fields.`);
  const bytes = new TextEncoder().encode(JSON.stringify(toSchema(model))).length;
  if (bytes > LIMITS.schemaBytes) {
    form.push(`The form is larger than ${LIMITS.schemaBytes / 1024} KB; shorten some text.`);
  }
  const names = new Map<string, number>();
  for (const f of model.fields) names.set(f.name, (names.get(f.name) ?? 0) + 1);
  const fields: Record<string, string[]> = {};
  for (const f of model.fields) {
    const found = fieldProblems(f, model, names);
    if (found.length) fields[f.id] = found;
  }
  return { form, fields };
}

export function hasProblems(problems: BuilderProblems): boolean {
  return problems.form.length > 0 || Object.keys(problems.fields).length > 0;
}
