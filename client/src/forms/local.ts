import type { TalaanDb } from "../db";
import { parseForm, type FormDefinition } from "./schema";

export interface LocalForm {
  name: string;
  definition: FormDefinition;
}

/** The downloaded form version, or null when it has not been synced yet (or cannot be read). */
export async function loadForm(db: TalaanDb, formVersionId: number): Promise<LocalForm | null> {
  const row = await db.formVersions.get(formVersionId);
  if (!row) return null;
  const definition = parseForm(row.schema);
  if (!definition) return null;
  return { name: typeof row.form_name === "string" ? row.form_name : definition.title, definition };
}
