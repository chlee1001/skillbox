import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { Health, crossScopeDuplicates, type HealthApi } from "../../src/ui/Health.tsx";
import type { InstalledLink, UnmappedLink } from "../../src/core/types.ts";

const entries: InstalledLink[] = [
  { name: "alpha", path: "/t/.claude/skills/alpha", health: { kind: "ok", skill: "alpha", target: "/ws/alpha" } },
  { name: "beta", path: "/t/.claude/skills/beta", health: { kind: "broken", target: "/ws/beta" } },
  { name: "ext", path: "/t/.claude/skills/ext", health: { kind: "foreign-link", target: "/etc/hosts" } },
  { name: "dir", path: "/t/.claude/skills/dir", health: { kind: "real-dir" } },
];
const unmapped: UnmappedLink[] = [
  { targetKey: "t1", name: "stray", path: "/t/.claude/skills/stray", target: "/ws/repoA/skills/alpha/references" },
];
const noop: HealthApi = { prune: async () => [] };

test("crossScopeDuplicates flags OK links whose SRC is also linked in another scope", () => {
  // matched by src (link target), not name: alpha's target is /ws/alpha
  const dups = crossScopeDuplicates(entries, new Set(["/ws/alpha", "/ws/zzz"]));
  expect(dups).toEqual(["alpha"]); // beta is broken (not ok), ext/dir not ok

  // a same-name-but-different-src skill elsewhere must NOT be flagged
  expect(crossScopeDuplicates(entries, new Set(["/other/alpha"]))).toEqual([]);
});

test("health renders entries, marks, unmapped list, and a cross-scope warning", () => {
  const { lastFrame } = render(
    <Health targetKey="work-plus-all" entries={entries} unmapped={unmapped} duplicates={["alpha"]} api={noop} />,
  );
  const f = lastFrame() ?? "";
  expect(f).toContain("health — work-plus-all");
  expect(f).toContain("alpha");
  expect(f).toContain("beta"); // broken
  expect(f).toContain("unmapped in-workspace links");
  expect(f).toContain("stray");
  expect(f).toContain("also linked in another scope: alpha");
});
