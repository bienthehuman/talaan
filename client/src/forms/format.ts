import type { FieldValue } from "../db";
import type { FormField } from "./schema";

/** A value as a person reads it. `undefined` and `null` both mean "not set". */
export function formatValue(_field: FormField | undefined, value: FieldValue | undefined): string {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
