import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs with `css: false`, where a CSS Module import returns a made-up name for ANY key, so a
// typo like `styles.sumary` would pass every other test and render unstyled in the real build.
// This reads the sources instead: every `styles.x` / `styles["x"]` a component uses must be a class in
// the module it imports, and every class in a module must be used (ADR 0011).

const SRC = resolve(__dirname, "..");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else out.push(path);
  }
  return out;
}

function classesIn(css: string): Set<string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...withoutComments.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]!));
}

const sources = files(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
const users = sources
  .map((file) => {
    const text = readFileSync(file, "utf8");
    const imp = text.match(/import (\w+) from "(\.[^"]+\.module\.css)";/);
    return imp ? { file, text, name: imp[1]!, css: resolve(dirname(file), imp[2]!) } : null;
  })
  .filter((u) => u !== null);

describe("CSS Modules", () => {
  it("are imported by some components (the scan is finding them)", () => {
    expect(users.length).toBeGreaterThan(10);
  });

  it.each(users.map((u) => [u.file.slice(SRC.length + 1), u] as const))(
    "%s uses only classes its module defines",
    (_, u) => {
      const defined = classesIn(readFileSync(u.css, "utf8"));
      const used = [
        ...u.text.matchAll(new RegExp(`\\b${u.name}\\.(\\w+)|\\b${u.name}\\["([\\w-]+)"\\]`, "g")),
      ].map((m) => m[1] ?? m[2]!);
      expect(used.filter((c) => !defined.has(c))).toEqual([]);
    },
  );

  it("define no class that nothing uses", () => {
    const modules = files(SRC).filter((f) => f.endsWith(".module.css"));
    const unused: string[] = [];
    for (const css of modules) {
      const importers = users.filter((u) => u.css === css);
      expect(importers.length, `${css} is not imported`).toBeGreaterThan(0);
      const text = importers.map((u) => u.text).join("\n");
      for (const c of classesIn(readFileSync(css, "utf8"))) {
        // Dynamic lookups (styles[variant], styles[state], swatch names) are covered by naming the
        // keys in the source; a class counts as used if its name appears there at all.
        const swatch = c.startsWith("sw") && text.includes("swatchClass");
        if (!new RegExp(`\\b${c}\\b`).test(text) && !swatch) unused.push(`${css}: .${c}`);
      }
    }
    expect(unused).toEqual([]);
  });
});
