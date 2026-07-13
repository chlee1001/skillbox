import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { SkillBrowser, toggleAt, type BrowserApi } from "../../src/ui/SkillBrowser.tsx";
import type { MatrixRow, Skill, Target } from "../../src/core/types.ts";

// NOTE on approach: ink's useInput is not drivable under ink-testing-library + Bun, so
// keyboard→intent is covered by keymap.test.ts (pure) and the toggle/reconcile logic by
// toggleAt() below (pure/async). Here we only assert the component's static RENDERING.

const T: Target = { alias: "t1", root: "/t1", skillsDir: "/t1/.claude/skills" };
const sk = (name: string, repo = "repoA"): Skill => ({ name, repo, src: `/ws/${repo}/${name}` });

const rows: MatrixRow[] = [
  { skill: sk("alpha"), cells: [{ targetKey: "t1", state: "linked" }] },
  { skill: sk("beta"), cells: [{ targetKey: "t1", state: "absent" }] },
  { skill: sk("sub1", "repoC"), cells: [{ targetKey: "t1", state: "covered" }] },
];

const noopApi: BrowserApi = {
  toggle: async () => ({ action: "linked" }),
  restat: async (skills) => ({ cells: skills.map(() => ({ targetKey: "t1", state: "absent" })) }),
};

test("renders the target header and a glyph per skill state", () => {
  const { lastFrame } = render(<SkillBrowser rows={rows} targets={[T]} api={noopApi} />);
  const f = lastFrame() ?? "";
  expect(f).toContain("target:");
  expect(f).toContain("t1");
  expect(f).toContain("[x] alpha"); // linked
  expect(f).toContain("[ ] beta"); // absent
  expect(f).toContain("[o] sub1"); // covered
});

// --- toggleAt: the real link/unlink + reconcile logic (no terminal needed) ---

function fakeApi(linkedNames: string[], toggleResult?: { action: string; reason?: string }) {
  const linked = new Set(linkedNames);
  const calls: { name: string; currentlyLinked: boolean }[] = [];
  const api: BrowserApi = {
    async toggle(skill, _t, opts) {
      calls.push({ name: skill.name, currentlyLinked: opts.currentlyLinked });
      if (toggleResult) return toggleResult; // simulate a refusal without mutating "disk"
      if (opts.currentlyLinked) linked.delete(skill.name);
      else linked.add(skill.name);
      return { action: opts.currentlyLinked ? "unlinked" : "linked" };
    },
    async restat(skills) {
      return { cells: skills.map((s) => ({ targetKey: "t1", state: linked.has(s.name) ? "linked" : "absent" })) };
    },
  };
  return { api, calls };
}

test("toggleAt links a free cell and reconciles from disk", async () => {
  const base: MatrixRow[] = [{ skill: sk("beta"), cells: [{ targetKey: "t1", state: "absent" }] }];
  const { api, calls } = fakeApi([]);
  const { rows: next, toast } = await toggleAt(base, 0, T, false, api);
  expect(calls).toEqual([{ name: "beta", currentlyLinked: false }]);
  expect(next[0].cells[0].state).toBe("linked");
  expect(toast).toBe("");
});

test("toggleAt unlinks a linked cell", async () => {
  const base: MatrixRow[] = [{ skill: sk("alpha"), cells: [{ targetKey: "t1", state: "linked" }] }];
  const { api, calls } = fakeApi(["alpha"]);
  const { rows: next } = await toggleAt(base, 0, T, false, api);
  expect(calls[0].currentlyLinked).toBe(true);
  expect(next[0].cells[0].state).toBe("absent");
});

test("toggleAt surfaces a core refusal as a toast and does not change disk state", async () => {
  const base: MatrixRow[] = [{ skill: sk("beta"), cells: [{ targetKey: "t1", state: "absent" }] }];
  const { api } = fakeApi([], { action: "skipped", reason: "occupied by /other" });
  const { rows: next, toast } = await toggleAt(base, 0, T, false, api);
  expect(toast).toContain("refused");
  expect(toast).toContain("occupied");
  expect(next[0].cells[0].state).toBe("absent"); // reconcile shows disk unchanged
});
