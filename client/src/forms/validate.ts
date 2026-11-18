import { z } from "zod";
import type { RecordData } from "../db";
import type { FormDefinition, FormField } from "./schema";

/** Zod schema for one field, with messages written for the person filling the form. */
function fieldSchema(field: FormField): z.ZodType {
  switch (field.type) {
    case "boolean":
      return z.boolean({ error: "Choose yes or no." });
    case "string": {
      let s = z.string({ error: "Enter text." });
      if (field.minLength !== undefined) {
        s = s.min(field.minLength, { error: `Enter at least ${field.minLength} characters.` });
      }
      if (field.maxLength !== undefined) {
        s = s.max(field.maxLength, { error: `Use at most ${field.maxLength} characters.` });
      }
      if (field.enum)
        return z.enum(field.enum as [string, ...string[]], { error: "Choose an option." });
      return s;
    }
    default: {
      let n =
        field.type === "integer"
          ? z.number().int({ error: "Enter a whole number." })
          : z.number({ error: "Enter a number." });
      if (field.minimum !== undefined)
        n = n.min(field.minimum, { error: `Must be at least ${field.minimum}.` });
      if (field.maximum !== undefined)
        n = n.max(field.maximum, { error: `Must be at most ${field.maximum}.` });
      return n;
    }
  }
}

/** Zod object for a form. A draft may be incomplete (every field optional); completing it, which is
 *  what Submit needs, also requires the schema's `required` fields (docs/DATA_MODEL.md section 5). */
export function buildValidator(form: FormDefinition, { complete }: { complete: boolean }) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of form.fields) {
    const base = fieldSchema(field);
    shape[field.name] = complete && field.required ? base : base.optional();
  }
  return z.strictObject(shape);
}

export type FieldErrors = Record<string, string>;

/** Problems per field name. Empty when the data is acceptable. */
export function validateRecord(
  form: FormDefinition,
  data: RecordData,
  { complete }: { complete: boolean },
): FieldErrors {
  const result = buildValidator(form, { complete }).safeParse(data);
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) errors[key] = "Not part of this form.";
      continue;
    }
    const name = String(issue.path[0] ?? "");
    const missing = issue.code === "invalid_type" && !(name in data);
    errors[name] ||= missing ? "Required." : issue.message;
  }
  return errors;
}
