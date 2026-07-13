import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanWorkspace, flattenSkills } from "../src/core/scan.ts";
import { installMatrix } from "../src/core/link.ts";
import type { CellState, Skill, Target } from "../src/core/types.ts";

let ws: string;
let t1root: string;
let t2root: string;
let t1: Target;
let t2: Target;

async function skill(dir: string, name: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
}

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "skb-mx-"));
  t1root = await mkdtemp(join(tmpdir(), "skb-t1-"));
  t2root = await mkdtemp(join(tmpdir(), "skb-t2-"));
  t1 = { alias: "t1", root: t1root, skillsDir: join(t1root, ".claude", "skills") };
  t2 = { alias: "t2", root: t2root, skillsDir: join(t2root, ".claude", "skills") };

  await skill(join(ws, "repoA", "skills", "alpha"), "alpha");
  await skill(join(ws, "repoA", "skills", "beta"), "beta");
  await mkdir(join(ws, "repoA", "skills", "alpha", "references"), { recursive: true }); // in-ws non-skill dir
  await skill(join(ws, "repoC", "repoC"), "repoC"); // umbrella
  await skill(join(ws, "repoC", "repoC", "skills", "sub1"), "sub1");
  await skill(join(ws, "repoC", "repoC", "skills", "sub2"), "sub2");

  await mkdir(t1.skillsDir, { recursive: true });
  await mkdir(t2.skillsDir, { recursive: true });
  // t1: alpha linked, umbrella linked (→ subs covered), beta is a real dir (conflict),
  //     stray link into a non-skill in-ws dir (→ unmapped)
  await symlink(join(ws, "repoA", "skills", "alpha"), join(t1.skillsDir, "alpha"));
  await symlink(join(ws, "repoC", "repoC"), join(t1.skillsDir, "repoC"));
  await mkdir(join(t1.skillsDir, "beta"), { recursive: true });
  await symlink(join(ws, "repoA", "skills", "alpha", "references"), join(t1.skillsDir, "stray"));
  // t2: beta points outside the workspace (foreign)
  await symlink("/etc/hosts", join(t2.skillsDir, "beta"));
});

afterEach(async () => {
  for (const d of [ws, t1root, t2root]) await rm(d, { recursive: true, force: true });
});

function cell(rows: { skill: Skill; cells: { targetKey: string; state: CellState }[] }[], name: string, key: string) {
  const row = rows.find((r) => r.skill.name === name)!;
  return row.cells.find((c) => c.targetKey === key)!.state;
}

test("installMatrix classifies every cell state across targets", async () => {
  const skills = flattenSkills(await scanWorkspace(ws));
  const { rows } = await installMatrix(skills, [t1, t2], ws);

  expect(cell(rows, "alpha", "t1")).toBe("linked");
  expect(cell(rows, "alpha", "t2")).toBe("absent");
  expect(cell(rows, "beta", "t1")).toBe("conflict"); // real dir occupies the slot
  expect(cell(rows, "beta", "t2")).toBe("foreign"); // symlink outside workspace
  expect(cell(rows, "repoC", "t1")).toBe("linked"); // umbrella itself
  expect(cell(rows, "sub1", "t1")).toBe("covered"); // reachable via linked umbrella
  expect(cell(rows, "sub2", "t1")).toBe("covered");
  expect(cell(rows, "sub1", "t2")).toBe("absent");
});

test("installMatrix surfaces unmapped in-workspace links (not dropped)", async () => {
  const skills = flattenSkills(await scanWorkspace(ws));
  const { unmapped } = await installMatrix(skills, [t1, t2], ws);
  expect(unmapped.some((u) => u.targetKey === "t1" && u.name === "stray")).toBe(true);
});

test("matrix rows carry the owning repo (identity round-trips)", async () => {
  const skills = flattenSkills(await scanWorkspace(ws));
  const { rows } = await installMatrix(skills, [t1, t2], ws);
  expect(rows.find((r) => r.skill.name === "alpha")!.skill.repo).toBe("repoA");
  expect(rows.find((r) => r.skill.name === "sub1")!.skill.repo).toBe("repoC");
});
