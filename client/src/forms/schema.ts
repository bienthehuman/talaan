import { z } from "zod";

/** The small JSON Schema subset forms use (docs/DATA_MODEL.md section 5). The server checks every
 *  published schema against the same rules, so this parser can be strict. */

export type FieldType = "string" | "number" | "integer" | "boolean";

export interface FormField {
  name: string;
  title: string;
  description?: string;
  type: FieldType;
  required: boolean;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface FormDefinition {
  title: string;
  fields: FormField[];
}

const property = z.object({
  type: z.enum(["string", "number", "integer", "boolean"]),
  title: z.string().optional(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
});

const document = z.object({
  title: z.string().optional(),
  properties: z.record(z.string(), property),
  required: z.array(z.string()).optional(),
  "x-order": z.array(z.string()).optional(),
});

/** The display order. The server stores schemas as jsonb, which does not keep key order, so a
 *  version that lists every field once in `x-order` is shown in that order (DATA_MODEL.md
 *  section 5); a version published before `x-order` existed keeps the stored key order. */
export function fieldOrder(properties: Record<string, unknown>, order: unknown): string[] {
  const names = Object.keys(properties);
  if (
    Array.isArray(order) &&
    order.length === names.length &&
    new Set(order).size === order.length &&
    order.every((name) => typeof name === "string" && Object.hasOwn(properties, name))
  ) {
    return order as string[];
  }
  return names;
}

/** Fields in display order. Returns null for a schema this app cannot read. */
export function parseForm(schema: unknown): FormDefinition | null {
  const parsed = document.safeParse(schema);
  if (!parsed.success) return null;
  const required = new Set(parsed.data.required ?? []);
  const { properties } = parsed.data;
  return {
    title: parsed.data.title ?? "Inspection",
    fields: fieldOrder(properties, parsed.data["x-order"])
      .map((name) => [name, properties[name]!] as const)
      .map(([name, p]) => ({
        name,
        title: p.title ?? name,
        description: p.description,
        type: p.type,
        required: required.has(name),
        enum: p.enum,
        minLength: p.minLength,
        maxLength: p.maxLength,
        minimum: p.minimum,
        maximum: p.maximum,
      })),
  };
}
