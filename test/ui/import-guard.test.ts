// Structural guard (dependency-free stand-in for eslint no-restricted-imports): the UI
// layer must stay logic-free. Every core call goes through ui/actions.ts, so no other
// ui/ file may import node:fs / node:path or make a RUNTIME import from ../core/*.
// `import type` from ../core is fine (erased at compile time).
import { test, expect } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const UI_DIR = join(import.meta.dirname, "..", "..", "src", "ui");
const ADAPTER = "actions.ts"; // the one file allowed to reach into the core

test("ui/ files (except actions.ts) never import node:fs/node:path or the core at runtime", async () => {
  const files = (await readdir(UI_DIR)).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  const violations: string[] = [];

  for (const f of files) {
    if (f === ADAPTER) continue;
    const text = await readFile(join(UI_DIR, f), "utf8");
    // node:fs/path — line-level is fine (the `from` clause is on one line).
    text.split("\n").forEach((line, i) => {
      if (/\bfrom\s+["']node:(fs|path)["']/.test(line)) violations.push(`${f}:${i + 1} imports node:fs/path`);
    });
    // Runtime ../core import — match per statement so a multi-line `import {\n…\n} from
    // "../core/…"` can't slip through. `import type …` is allowed (erased).
    for (const stmt of text.split(";")) {
      if (/\bimport\b/.test(stmt) && /from\s+["']\.\.\/core\//.test(stmt) && !/\bimport\s+type\b/.test(stmt)) {
        violations.push(`${f}: runtime-imports ../core (use actions.ts)`);
      }
    }
  }

  expect(violations).toEqual([]);
});
