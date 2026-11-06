import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alwaysSrcs, alwaysTargets, gjcMissingDir } from "../src/core/always.ts";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "skb-always-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("always targets deduplicate real directories and symlinks", async () => {
  const a = join(root, "a");
  const b = join(root, "b");
  const link = join(root, "link");
  await mkdir(a);
  await mkdir(b);
  await symlink(a, link);
  const profile = (name: string, userSkills: string) => ({ name, userSkills, projectSub: "skills" });
  expect(await alwaysTargets([profile("a", a), profile("link", link)])).toHaveLength(1);
  expect(await alwaysTargets([profile("a", a), profile("b", b)])).toHaveLength(2);
});

test("always sources use link targets and exclude foreign or broken links", async () => {
  const ws = join(root, "workspace");
  const skill = join(ws, "repo", "skill");
  const dir = join(root, "target");
  await mkdir(skill, { recursive: true });
  await mkdir(dir);
  await writeFile(join(skill, "SKILL.md"), "skill");
  await symlink(skill, join(dir, "custom-name"));
  await symlink(root, join(dir, "foreign"));
  await symlink(join(ws, "gone"), join(dir, "broken"));
  const srcs = await alwaysSrcs([{ root, skillsDir: dir }], ws);
  expect([...srcs]).toEqual([await realpath(skill)]);
});

test("GJC config warning requires an existing config without the directory", () => {
  const dir = "/home/test/.agents/skills";
  expect(gjcMissingDir(undefined, dir)).toBe(false);
  expect(gjcMissingDir(`customDirectories: ${dir}`, dir)).toBe(false);
  expect(gjcMissingDir("skills: {}", dir)).toBe(true);
});
