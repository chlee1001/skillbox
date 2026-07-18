import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRepos } from "../src/core/classify.ts";
import { runDoctor } from "../src/core/doctor.ts";
import { scanWorkspace } from "../src/core/scan.ts";
import type { Target } from "../src/core/types.ts";

let ws: string; // workspace of clones
let up: string; // simulated upstream (outside the workspace)
let proj: string; // target project
let target: Target;

async function run(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(
    ["git", "-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  await proc.exited;
}

async function skill(dir: string, name: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
}

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "skb-doc-ws-"));
  up = await mkdtemp(join(tmpdir(), "skb-doc-up-"));
  proj = await mkdtemp(join(tmpdir(), "skb-doc-proj-"));
  target = { alias: "proj", root: proj, skillsDir: join(proj, ".claude", "skills") };
});

afterEach(async () => {
  for (const d of [ws, up, proj]) await rm(d, { recursive: true, force: true });
});

test("doctor flags unbacked owned, behind external, and broken links", async () => {
  // owned repo, git init but NO remote -> unbacked
  await skill(join(ws, "myskill", "skills", "a"), "a");
  await run(join(ws, "myskill"), "init", "-q");

  // external repo: clone of an "upstream" that then moves ahead -> behind by 1
  const upRepo = join(up, "vendor-skill");
  await skill(join(upRepo, "skills", "v"), "v");
  await run(up, "init", "-q", "-b", "main", "vendor-skill");
  await run(upRepo, "add", "-A");
  await run(upRepo, "commit", "-q", "-m", "c1");
  await run(up, "clone", "-q", upRepo, join(ws, "vendor-skill"));
  await writeFile(join(upRepo, "new.md"), "upstream moved on");
  await run(upRepo, "add", "-A");
  await run(upRepo, "commit", "-q", "-m", "c2");

  // broken link: our symlink in the project pointing at a workspace path that is gone
  await mkdir(target.skillsDir, { recursive: true });
  await symlink(join(ws, "myskill", "skills", "deleted"), join(target.skillsDir, "deleted"));

  const repos = await scanWorkspace(ws, { includeEmpty: true });
  // file-path remote has no owner -> external; no remote -> owned. Real inference path.
  await classifyRepos(repos, ws, ["chlee1001"]);
  expect(repos.find((r) => r.name === "myskill")!.class).toBe("owned");
  expect(repos.find((r) => r.name === "vendor-skill")!.class).toBe("external");

  const report = await runDoctor(repos, [target], ws, { fetch: true });
  const by = (c: string) => report.findings.filter((f) => f.check === c);

  expect(by("unbacked").map((f) => f.subject)).toEqual(["myskill"]);
  expect(by("external-drift").map((f) => f.subject)).toEqual(["vendor-skill"]);
  expect(by("external-drift")[0]!.detail).toContain("behind upstream by 1");
  expect(by("broken-link").map((f) => f.subject)).toEqual(["proj"]);
  expect(by("broken-link")[0]!.detail).toContain("deleted");
  expect(report.verdict).toBe("WARN");
});

test("doctor is HEALTHY on a clean fleet", async () => {
  // owned WITH remote (backed), external in sync, no links at all
  await skill(join(ws, "mine", "skills", "m"), "m");
  await run(join(ws, "mine"), "init", "-q");
  await run(join(ws, "mine"), "remote", "add", "origin", "git@github.com:chlee1001/mine.git");

  const upRepo = join(up, "vend");
  await skill(join(upRepo, "skills", "v"), "v");
  await run(up, "init", "-q", "-b", "main", "vend");
  await run(upRepo, "add", "-A");
  await run(upRepo, "commit", "-q", "-m", "c1");
  await run(up, "clone", "-q", upRepo, join(ws, "vend"));

  const repos = await scanWorkspace(ws, { includeEmpty: true });
  await classifyRepos(repos, ws, ["chlee1001"]);
  const report = await runDoctor(repos, [target], ws, { fetch: true });
  expect(report.findings).toEqual([]);
  expect(report.verdict).toBe("HEALTHY");
});
