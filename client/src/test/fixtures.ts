import { dbFor, type TalaanDb } from "../db";

/** Same document as server/forms/samples.py (a server test keeps that file and the docs in step). */
export const GENERATOR_SCHEMA = {
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
};

/** Reference data as a synced device would hold it: one assignment and its form version. */
export async function seedReference(db: TalaanDb = dbFor(2)) {
  await db.formVersions.put({ id: 1, form_name: "Generator inspection", schema: GENERATOR_SCHEMA });
  await db.assignments.put({
    id: 1,
    form_version_id: 1,
    form_name: "Generator inspection",
    site_name: "North plant",
    due_date: null,
    cancelled: false,
  });
}
