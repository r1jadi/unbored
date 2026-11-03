import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { sq } from "@/lib/i18n/sq";
import { offeredLanguages } from "@/lib/settings/language";

/**
 * The Albanian dictionary is complete: every English string the source passes to
 * `t()` has an Albanian entry, and every placeholder survives translation. A
 * screen half in English is the failure this exists to stop.
 */

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every literal first argument of a `t(…)` or `msg(…)` call in the app's source. */
export function sourceKeys(): string[] {
  const keys = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?<![\w.])(?:t|msg)\(\s*("(?:[^"\\\n]|\\.)*")/g)) {
      keys.add(JSON.parse(match[1]!) as string);
    }
  }
  return [...keys].sort();
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("Albanian", () => {
  it("is offered next to English, the default", () => {
    expect(offeredLanguages.map((language) => language.code)).toEqual(["en", "sq"]);
  });

  it("translates every string the app shows", () => {
    expect(sourceKeys().filter((key) => !(key in sq))).toEqual([]);
  });

  it("keeps every placeholder of the English string", () => {
    const broken = Object.entries(sq).filter(
      ([english, albanian]) => placeholders(english).join() !== placeholders(albanian).join(),
    );
    expect(broken).toEqual([]);
  });
});
