import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findArchived, archivedMatches } from "../src/core/archived.ts";
import { scanWorkspace } from "../src/core/scan.ts";

let root: string;
async function git(cwd: string, date: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  const err = await new Response(proc.stderr).text();
  if (await proc.exited) throw new Error(`git ${args.join(" ")}: ${err}`);
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "skb-archived-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("archive history, uncommitted entries, matching and live discovery", async () => {
  const repo = join(root, "repo");
  await mkdir(repo);
  const old = "2020-01-02T12:00:00+00:00";
  const later = "2024-03-04T12:00:00+00:00";
  await git(repo, old, "init", "-q", "-b", "main");
  await writeFile(join(repo, "base"), "base");
  await git(repo, old, "add", "base");
  await git(repo, old, "commit", "-q", "-m", "base");
  await git(repo, old, "checkout", "-q", "--orphan", "side");
  await git(repo, old, "rm", "-q", "-rf", ".");
  await mkdir(join(repo, "archive", "bundle", "skills", "inner"), { recursive: true });
  await writeFile(join(repo, "archive", "bundle", "skills", "inner", "SKILL.md"), "# inner\n");
  await git(repo, old, "add", ".");
  await git(repo, old, "commit", "-q", "-m", "old history");
  await git(repo, later, "checkout", "-q", "main");
  await git(repo, later, "merge", "-q", "--allow-unrelated-histories", "--no-ff", "side", "-m", "archive bundle");
  await mkdir(join(repo, "archive", "single"), { recursive: true });
  await writeFile(join(repo, "archive", "single", "SKILL.md"), "# single\n");
  await git(repo, later, "add", "archive/single");
  await git(repo, later, "commit", "-q", "-m", "archive single");
  await mkdir(join(repo, "archive", "new"));
  await writeFile(join(repo, "archive", "new", "SKILL.md"), "# new\n");
  await mkdir(join(repo, "archive", ".hidden"));
  await writeFile(join(repo, "archive", "README.md"), "ignored");

  expect(await scanWorkspace(root)).toEqual([]);
  const repos = await scanWorkspace(root, { includeEmpty: true });
  const entries = await findArchived(repos);
  expect(entries.map((entry) => entry.entry).sort()).toEqual(["bundle", "new", "single"]);
  expect(entries.find((entry) => entry.entry === "bundle")).toMatchObject({ added: "2020-01-02", archived: "2024-03-04", skills: ["inner"], uncommitted: false });
  expect(entries.find((entry) => entry.entry === "single")).toMatchObject({ added: "2024-03-04", archived: "2024-03-04", skills: ["single"], uncommitted: false });
  expect(entries.find((entry) => entry.entry === "new")).toMatchObject({ added: null, archived: null, uncommitted: true });
  expect(archivedMatches(entries, "bundle").map((entry) => entry.entry)).toEqual(["bundle"]);
  expect(archivedMatches(entries, "inner").map((entry) => entry.entry)).toEqual(["bundle"]);
  const cli = join(import.meta.dir, "../src/cli.ts");
  const run = async (...args: string[]) => {
    const proc = Bun.spawn(["bun", cli, ...args], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: root, XDG_CONFIG_HOME: root, SKILLBOX_WORKSPACE: root },
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { out, err, code };
  };
  const listing = await run("list", "--archived", "repo");
  expect(listing.code).toBe(0);
  expect(listing.out.indexOf("archive/new")).toBeLessThan(listing.out.indexOf("archive/bundle"));
  expect((await run("list", "--archived", "missing")).out).toBe("archived\n  (none)\n");
  for (const args of [["path", "inner"], ["always", "inner"], ["install", join(root, "target"), "inner"]]) {
    const result = await run(...args);
    expect(result.code).toBe(2);
    expect(result.err).toContain('"inner" is archived: repo/archive/bundle (archived 2024-03-04) — restore it first');
  }
  // path <repo>: a one-skill repo resolves straight to that skill; a multi-skill repo lists candidates.
  await mkdir(join(root, "solo-repo", "skills", "solo"), { recursive: true });
  await writeFile(join(root, "solo-repo", "skills", "solo", "SKILL.md"), "# solo\n");
  for (const n of ["a", "b"]) {
    await mkdir(join(root, "duo-repo", "skills", n), { recursive: true });
    await writeFile(join(root, "duo-repo", "skills", n, "SKILL.md"), `# ${n}\n`);
  }
  const solo = await run("path", "solo-repo");
  expect(solo.code).toBe(0);
  expect(solo.out.trim().endsWith("/solo-repo/skills/solo/SKILL.md")).toBe(true);
  const duo = await run("path", "duo-repo");
  expect(duo.code).toBe(2);
  expect(duo.err).toContain("duo-repo:skills/a");
  expect(duo.err).toContain("duo-repo:skills/b");
  await mkdir(join(root, "non-git", "archive", "retired"), { recursive: true });
  await writeFile(join(root, "non-git", "archive", "retired", "SKILL.md"), "# retired\n");
  const nonGit = await findArchived(await scanWorkspace(root, { includeEmpty: true }));
  expect(nonGit.find((entry) => entry.entry === "retired")).toMatchObject({ added: null, archived: null, uncommitted: true });
  await writeFile(join(repo, "archive", "single", "SKILL.md"), "modified\n");
  expect((await findArchived(repos)).find((entry) => entry.entry === "single")?.uncommitted).toBe(true);
});
