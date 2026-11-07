import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoEntries, skillRef } from "../src/core/report.ts";
import { scanRepo } from "../src/core/scan.ts";
import { selectSkills, selectionProblems } from "../src/core/select.ts";
import type { Repo } from "../src/core/types.ts";

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), "skb-report-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function skill(dir: string, description: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: x\ndescription: ${description}\n---\n`);
}

test("every ref selects exactly its own skill, including same-name twins", async () => {
  const repo = join(root, "twins");
  await skill(join(repo, "skills", "humanize"), "main");
  await skill(join(repo, "codex", "skills", "humanize"), "codex copy");
  await skill(join(repo, "humanize"), "top level copy");
  await skill(join(repo, "skills", "scan"), "scan");
  const scanned = await scanRepo(repo);
  expect(skillRef(scanned.skills.find((s) => s.name === "scan")!, scanned)).toBe("twins:scan");
  for (const s of scanned.skills) {
    const sel = selectSkills(scanned.skills, [skillRef(s, scanned)]);
    expect(selectionProblems(sel)).toEqual([]);
    expect(sel.chosen.map((c) => c.src)).toEqual([s.src]);
  }
});

test("repo entries carry class, unbacked, category and per-skill always", () => {
  const repo: Repo = {
    name: "mine", path: "/ws/mine", isGit: true, git: { kind: "unknown" }, class: "owned", category: "개인",
    skills: [
      { name: "on", repo: "mine", src: "/ws/mine/on", description: "d" },
      { name: "box", repo: "mine", src: "/ws/mine/box", isContainer: true },
    ],
  };
  const [entry] = repoEntries([repo], (s) => s.name === "on");
  expect(entry).toEqual({
    name: "mine", path: "/ws/mine", class: "owned", remote: undefined, unbacked: true, category: "개인",
    skills: [
      { name: "on", ref: "mine:on", path: "/ws/mine/on", description: "d", umbrella: false, always: true },
      { name: "box", ref: "mine:box", path: "/ws/mine/box", description: undefined, umbrella: true, always: false },
    ],
  });
});

async function cli(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bun", join(import.meta.dirname, "..", "src", "cli.ts"), ...args], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

test("cli --json: list reflects always toggles made through always --json", async () => {
  const ws = join(root, "ws");
  const home = join(root, "home");
  await skill(join(ws, "repo", "skills", "alpha"), "alpha skill");
  await mkdir(join(home, ".claude", "skills"), { recursive: true });
  const env = { HOME: home, XDG_CONFIG_HOME: join(root, "config"), SKILLBOX_WORKSPACE: ws };

  const before = JSON.parse((await cli(["list", "--json"], env)).stdout);
  expect(before.repos[0].skills[0]).toMatchObject({ name: "alpha", ref: "repo:alpha", always: false });

  const on = await cli(["always", "repo:alpha", "--json"], env);
  expect(on.code).toBe(0);
  const changes = JSON.parse(on.stdout).changes;
  expect(changes.map((c: { action: string }) => c.action)).toEqual(changes.map(() => "linked"));

  expect(JSON.parse((await cli(["list", "--json"], env)).stdout).repos[0].skills[0].always).toBe(true);
  const listed = JSON.parse((await cli(["always", "--json"], env)).stdout);
  expect(listed.targets[0].skills).toEqual([{ name: "alpha", repo: "repo", ref: "repo:alpha" }]);

  const off = JSON.parse((await cli(["always", "--off", "repo:alpha", "--json"], env)).stdout);
  expect(off.changes[0].action).toBe("unlinked");
  expect(JSON.parse((await cli(["list", "--json"], env)).stdout).repos[0].skills[0].always).toBe(false);
});

test("cli --json: doctor keeps its exit code and rejects unsupported commands", async () => {
  const ws = join(root, "ws");
  const home = join(root, "home");
  await skill(join(ws, "repo", "alpha"), "alpha");
  await mkdir(join(home, ".claude", "skills"), { recursive: true });
  await symlink(join(ws, "repo", "gone"), join(home, ".claude", "skills", "gone"));
  const env = { HOME: home, XDG_CONFIG_HOME: join(root, "config"), SKILLBOX_WORKSPACE: ws };

  const doctor = await cli(["doctor", "--json"], env);
  expect(doctor.code).toBe(1);
  const report = JSON.parse(doctor.stdout);
  expect(report.verdict).toBe("WARN");
  expect(report.fetched).toBe(false);
  expect(report.findings.map((f: { check: string }) => f.check)).toContain("broken-link");

  const bad = await cli(["status", "--user", "--json"], env);
  expect(bad.code).toBe(2);
  expect(bad.stdout).toBe("");
  expect(bad.stderr).toContain("--json is supported by");
});
