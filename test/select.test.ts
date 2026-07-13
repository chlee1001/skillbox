import { test, expect } from "bun:test";
import { selectSkills, selectionProblems } from "../src/core/select.ts";
import type { Skill } from "../src/core/types.ts";

const S = (name: string, repo: string, extra: Partial<Skill> = {}): Skill => ({
  name,
  repo,
  src: `/ws/${repo}/${name}`,
  ...extra,
});

const pool: Skill[] = [
  S("alpha", "repoA"),
  S("beta", "repoA"),
  S("umbrella", "repoC", { isContainer: true }),
  S("sub1", "repoC"),
  S("dup", "repoA"),
  S("dup", "repoB"), // same name, two repos
];

test("--all skips umbrella containers", () => {
  const sel = selectSkills(pool.filter((s) => s.repo === "repoC"), [], "repoC", true);
  expect(sel.chosen.map((s) => s.name)).toEqual(["sub1"]); // umbrella excluded
});

test("umbrella installable by explicit name", () => {
  const sel = selectSkills(pool, ["umbrella"]);
  expect(sel.chosen.map((s) => s.name)).toEqual(["umbrella"]);
  expect(selectionProblems(sel)).toEqual([]);
});

test("typo (unmatched name) is reported as a miss, not silently dropped", () => {
  const sel = selectSkills(pool, ["alpha", "betaa"]);
  expect(sel.chosen.map((s) => s.name)).toEqual(["alpha"]);
  expect(sel.misses).toEqual(["betaa"]);
  expect(selectionProblems(sel).some((p) => p.includes("betaa"))).toBe(true);
});

test("bare ambiguous name is refused with repo:skill hint", () => {
  const sel = selectSkills(pool, ["dup"]);
  expect(sel.chosen).toEqual([]);
  expect(sel.ambiguous).toEqual([{ name: "dup", repos: ["repoA", "repoB"] }]);
  expect(selectionProblems(sel).some((p) => p.includes("repo:skill"))).toBe(true);
});

test("repo:skill disambiguates an otherwise-ambiguous name", () => {
  const sel = selectSkills(pool, ["repoB:dup"]);
  expect(sel.chosen).toEqual([S("dup", "repoB")]);
  expect(selectionProblems(sel)).toEqual([]);
});

test("--all across repos flags a same-name collision instead of clobbering", () => {
  const sel = selectSkills(pool, [], undefined, true);
  expect(sel.collisions).toEqual([{ name: "dup", repos: ["repoA", "repoB"] }]);
  expect(selectionProblems(sel).some((p) => p.includes("collision"))).toBe(true);
});
