import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCategories, writeCategories, applyCategories } from "../src/core/category.ts";
import { scanWorkspace } from "../src/core/scan.ts";

let ws: string;

async function skill(repo: string, name: string): Promise<void> {
  const dir = join(ws, repo, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n`);
}

async function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn([process.execPath, join(import.meta.dirname, "../src/cli.ts"), ...args], {
    env: { ...process.env, SKILLBOX_WORKSPACE: ws, XDG_CONFIG_HOME: join(ws, ".config"), HOME: ws },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "skb-category-"));
});

afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
});

test("reads comments, malformed lines and categories containing spaces", async () => {
  expect(await readCategories(ws)).toEqual(new Map());
  await writeFile(join(ws, ".skillboxcategory"), "# comment\n\nalpha 디자인 도구  # inline\nbadline\nbeta personal\n");
  expect(await readCategories(ws)).toEqual(new Map([["alpha", "디자인 도구"], ["beta", "personal"]]));
});

test("writes sorted entries and round-trips, including an empty map", async () => {
  const categories = new Map([["zeta", "디자인 도구"], ["beta", "alpha"], ["alpha", "디자인 도구"]]);
  await writeCategories(ws, categories);
  expect(await readFile(join(ws, ".skillboxcategory"), "utf8")).toBe(
    "# <repo-dir-name> <category>\nbeta alpha\nalpha 디자인 도구\nzeta 디자인 도구\n",
  );
  expect(await readCategories(ws)).toEqual(categories);
  await writeCategories(ws, new Map());
  expect(await readFile(join(ws, ".skillboxcategory"), "utf8")).toBe("# <repo-dir-name> <category>\n");
});

test("applies and clears categories on scanned repos", async () => {
  await skill("alpha", "one");
  await skill("beta", "two");
  const repos = await scanWorkspace(ws);
  await writeCategories(ws, new Map([["alpha", "디자인 도구"]]));
  expect(await applyCategories(repos, ws)).toBe(repos);
  expect(repos.map((r) => r.category)).toEqual(["디자인 도구", undefined]);
  await writeCategories(ws, new Map());
  await applyCategories(repos, ws);
  expect(repos.map((r) => r.category)).toEqual([undefined, undefined]);
});

test("CLI assigns, filters, groups, warns, refuses unknown repos and removes categories", async () => {
  await skill("alpha", "one");
  await skill("alpha", "two");
  await skill("beta", "three");
  await writeCategories(ws, new Map([["missing", "old"]]));
  const before = await readFile(join(ws, ".skillboxcategory"), "utf8");
  const refused = await cli("category", "디자인 도구", "alpha", "unknown");
  expect(refused.code).toBe(2);
  expect(refused.err).toContain("unknown");
  expect(await readFile(join(ws, ".skillboxcategory"), "utf8")).toBe(before);
  expect((await cli("category", "디자인 도구", "alpha")).out).toContain("alpha -> 디자인 도구");
  const grouped = await cli("category");
  expect(grouped.out).toContain("디자인 도구\n  alpha  (2 skills)");
  expect(grouped.out).toContain("(no category)\n  beta  (1 skills)");
  expect(grouped.out).toContain("WARN category entry for unknown repo: missing");
  const listed = await cli("list", "--category", "디자인 도구");
  expect(listed.out).toContain("{디자인 도구}");
  expect(listed.out).not.toContain("beta");
  expect((await cli("category", "디자인 도구")).out).toBe(listed.out);
  expect((await cli("category", "개인", "alpha")).out).toContain("alpha -> 개인");
  const removed = await cli("category", "--off", "alpha", "beta", "unknown");
  expect(removed.code).toBe(0);
  expect(removed.out).toContain("alpha -> (no category)");
  expect(removed.out).toContain("beta (no category)");
  expect(removed.out).toContain("unknown (no category)");
  expect(await readCategories(ws)).toEqual(new Map([["missing", "old"]]));
});
