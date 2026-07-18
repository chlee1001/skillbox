import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRepos } from "../src/core/classify.ts";
import { buildInventory, renderInventory } from "../src/core/inventory.ts";
import { scanWorkspace } from "../src/core/scan.ts";
import type { Target } from "../src/core/types.ts";

let ws: string;
let proj: string;
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
  ws = await mkdtemp(join(tmpdir(), "skb-inv-ws-"));
  proj = await mkdtemp(join(tmpdir(), "skb-inv-proj-"));
  target = { alias: "proj", root: proj, skillsDir: join(proj, ".claude", "skills") };
});

afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
  await rm(proj, { recursive: true, force: true });
});

test("inventory rows carry class, remote, installed targets", async () => {
  // external repo with two skills, one linked into the project
  await skill(join(ws, "vendor", "skills", "alpha"), "alpha");
  await skill(join(ws, "vendor", "skills", "beta"), "beta");
  await run(join(ws, "vendor"), "init", "-q");
  await run(join(ws, "vendor"), "remote", "add", "origin", "https://github.com/other/vendor.git");
  await run(join(ws, "vendor"), "add", "-A");
  await run(join(ws, "vendor"), "commit", "-q", "-m", "c1");
  // owned repo, no remote (unbacked), not linked anywhere
  await skill(join(ws, "mine", "skills", "gamma"), "gamma");

  await mkdir(target.skillsDir, { recursive: true });
  await symlink(join(ws, "vendor", "skills", "alpha"), join(target.skillsDir, "alpha"));

  const repos = await scanWorkspace(ws);
  await classifyRepos(repos, ws, ["chlee1001"]);
  const rows = await buildInventory(repos, [target], ws);
  const byName = new Map(rows.map((r) => [r.skill, r]));

  expect(byName.get("alpha")).toMatchObject({
    repo: "vendor",
    class: "external",
    remote: "https://github.com/other/vendor.git",
    targets: ["proj"],
  });
  expect(byName.get("beta")!.targets).toEqual([]); // present in workspace, linked nowhere
  expect(byName.get("gamma")).toMatchObject({ class: "owned", targets: [] });
  expect(byName.get("gamma")!.remote).toBeUndefined();

  const md = renderInventory(rows, { date: "2026-07-19", workspace: ws });
  expect(md).toContain("| alpha | vendor | external | https://github.com/other/vendor.git | proj | — |");
  expect(md).toContain("| gamma | mine | owned UNBACKED | — | — | — |");
});
