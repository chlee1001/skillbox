import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addTarget, removeTarget, resolveTarget } from "../src/core/config.ts";
import { homedir } from "node:os";
import type { Config } from "../src/core/types.ts";

let cfgHome: string;
let cfgFile: string;
let prevXdg: string | undefined;

// A workspace string that resolveReal WOULD rewrite (/tmp -> /private/tmp on macOS),
// so if persistence leaked derived state, this raw value would change.
const RAW = {
  workspace: "/tmp/skillbox-ws-symlinked",
  targets: { existing: "/some/existing/proj" },
  ignore: ["claude-overlay", "docs-only"],
};

beforeEach(async () => {
  cfgHome = await mkdtemp(join(tmpdir(), "skb-cfg-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = cfgHome;
  cfgFile = join(cfgHome, "skillbox", "config.json");
  await mkdir(join(cfgHome, "skillbox"), { recursive: true });
  await writeFile(cfgFile, JSON.stringify(RAW, null, 2) + "\n");
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  await rm(cfgHome, { recursive: true, force: true });
});

test("addTarget mutates only `targets`; workspace and ignore stay byte-identical", async () => {
  await addTarget("work", "/Users/me/work-plus-all");
  const after = JSON.parse(await readFile(cfgFile, "utf8"));

  expect(after.workspace).toBe(RAW.workspace); // NOT canonicalized
  expect(after.ignore).toEqual(RAW.ignore); // NOT file-merged
  expect(after.targets).toEqual({ existing: RAW.targets.existing, work: "/Users/me/work-plus-all" });
});

test("resolveTarget picks the agent's skills dir (claude vs codex)", () => {
  const cfg: Config = { workspace: "/ws", targets: { wp: "/proj" }, ignore: [], ownedOwners: [] };

  // project scope
  expect(resolveTarget("wp", cfg).skillsDir).toBe("/proj/.claude/skills");
  expect(resolveTarget("wp", cfg, "codex").skillsDir).toBe("/proj/.agents/skills");
  // raw path
  expect(resolveTarget("/p", cfg, "codex").skillsDir).toBe("/p/.agents/skills");
  // user scope
  expect(resolveTarget("--user", cfg).skillsDir).toBe(`${homedir()}/.claude/skills`);
  expect(resolveTarget("--user", cfg, "codex").skillsDir).toBe(`${homedir()}/.agents/skills`);
  // gajae-code (confirmed from gjc discovery/builtin.ts: project .gjc/skills, user .gjc/agent/skills)
  expect(resolveTarget("wp", cfg, "gajae").skillsDir).toBe("/proj/.gjc/skills");
  expect(resolveTarget("--user", cfg, "gajae").skillsDir).toBe(`${homedir()}/.gjc/agent/skills`);
  // unknown agent falls back to claude (never throws) — incl. inherited object keys
  expect(resolveTarget("wp", cfg, "nope").skillsDir).toBe("/proj/.claude/skills");
  expect(resolveTarget("wp", cfg, "constructor").skillsDir).toBe("/proj/.claude/skills");
  expect(resolveTarget("wp", cfg, "toString").skillsDir).toBe("/proj/.claude/skills");
});

test("removeTarget drops one alias and reports hit/miss", async () => {
  expect(await removeTarget("existing")).toBe(true);
  expect(await removeTarget("nope")).toBe(false);
  const after = JSON.parse(await readFile(cfgFile, "utf8"));
  expect(after.targets).toEqual({});
  expect(after.workspace).toBe(RAW.workspace);
});
