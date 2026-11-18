import type { FieldValue } from "../db";
import type { FormField } from "./schema";

/** Text typed into a field -> the value to save (`null` clears it), or an error and no value. */
export function textToValue(
  field: FormField,
  text: string,
): { value: FieldValue } | { error: string } {
  if (text.trim() === "") return { value: null };
  if (field.type === "string") return { value: text };
  const n = Number(text);
  if (!Number.isFinite(n)) return { error: "Enter a number." };
  return { value: n };
}
