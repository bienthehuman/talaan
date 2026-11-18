import { describe, expect, it } from "vitest";
import { parseForm } from "./schema";
import { validateRecord } from "./validate";

// Same document as server/forms/samples.py (a server test keeps that file and the docs in step).
import { GENERATOR_SCHEMA as SCHEMA } from "../test/fixtures";

const form = parseForm(SCHEMA)!;
const COMPLETE = { oil_level: "ok", coolant_ok: true, hours_run: 120 };

describe("parseForm", () => {
  it("lists fields in order with their rules", () => {
    expect(form.title).toBe("Generator inspection");
    expect(form.fields.map((f) => f.name)).toEqual([
      "site_contact",
      "oil_level",
      "oil_pressure_psi",
      "coolant_ok",
      "hours_run",
      "notes",
    ]);
    expect(form.fields.find((f) => f.name === "hours_run")).toMatchObject({
      type: "integer",
      required: true,
      minimum: 0,
    });
    expect(form.fields.find((f) => f.name === "notes")?.required).toBe(false);
  });

  it("refuses a schema it cannot read", () => {
    expect(parseForm(null)).toBeNull();
    expect(parseForm({ properties: { a: { type: "array" } } })).toBeNull();
  });
});

describe("validateRecord", () => {
  it("a draft may be incomplete", () => {
    expect(validateRecord(form, {}, { complete: false })).toEqual({});
    expect(validateRecord(form, { oil_level: "ok" }, { complete: false })).toEqual({});
  });

  it("completing needs every required field", () => {
    const errors = validateRecord(form, { oil_level: "ok" }, { complete: true });
    expect(errors).toEqual({ coolant_ok: "Required.", hours_run: "Required." });
    expect(validateRecord(form, COMPLETE, { complete: true })).toEqual({});
  });

  it("checks types and limits the way the server does", () => {
    const errors = validateRecord(
      form,
      {
        oil_level: "full",
        coolant_ok: "yes" as never,
        hours_run: 1.5,
        oil_pressure_psi: 250,
        site_contact: "x".repeat(121),
      },
      { complete: false },
    );
    expect(errors).toEqual({
      oil_level: "Choose an option.",
      coolant_ok: "Choose yes or no.",
      hours_run: "Enter a whole number.",
      oil_pressure_psi: "Must be at most 200.",
      site_contact: "Use at most 120 characters.",
    });
    expect(validateRecord(form, { hours_run: -1 }, { complete: false })).toEqual({
      hours_run: "Must be at least 0.",
    });
  });

  it("rejects unknown fields", () => {
    expect(
      validateRecord(form, { ...COMPLETE, colour: "red" } as never, { complete: true }),
    ).toEqual({
      colour: "Not part of this form.",
    });
  });
});
