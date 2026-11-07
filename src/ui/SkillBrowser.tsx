// Screen B — the headline: a skill × target grid. Space toggles the focused skill's link
// on the active target (optimistic flip, then re-stat that column from disk to reconcile).
// All key semantics come from keymap(); all disk work goes through the injected `api`
// (defaults to ui/actions) so this file holds no link logic and is unit-testable.

import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { CellState, MatrixCell, MatrixRow, Skill, Target } from "../core/types.ts";
import { keymap, type Key } from "./keymap.ts";
import * as actions from "./actions.ts";

// The slice of actions this screen needs — injectable so tests pass a fake (no fs).
export interface BrowserApi {
  toggle(
    skill: Skill,
    target: Target,
    opts: { currentlyLinked: boolean; copy?: boolean },
  ): Promise<{ action: string; reason?: string }>;
  restat(skill: Skill[], target: Target): Promise<{ cells: MatrixCell[] }>;
}

const GLYPH: Record<CellState, string> = {
  linked: "[x]",
  covered: "[o]",
  broken: "[!]",
  conflict: "[!]",
  foreign: "[~]",
  absent: "[ ]",
};

export function cellFor(row: MatrixRow, targetKey: string): MatrixCell {
  return row.cells.find((c) => c.targetKey === targetKey) ?? { targetKey, state: "absent" };
}

export function alwaysTag(src: string, always: Set<string>): string {
  return always.has(src) ? " always" : "";
}

// Replace one target column's cells across all rows (the reconcile write).
export function replaceColumn(rows: MatrixRow[], targetKey: string, cells: MatrixCell[]): MatrixRow[] {
  return rows.map((r, i) => ({ ...r, cells: r.cells.map((c) => (c.targetKey === targetKey ? cells[i] : c)) }));
}

// The toggle+reconcile logic, extracted pure so it is unit-testable without a terminal
// (ink useInput isn't drivable under the test renderer). Direction comes from the current
// cell; the final state comes from a disk re-stat, not the optimistic guess.
export async function toggleAt(
  rows: MatrixRow[],
  focus: number,
  target: Target,
  copy: boolean,
  api: BrowserApi,
): Promise<{ rows: MatrixRow[]; toast: string }> {
  const key = target.alias ?? target.root;
  const currentlyLinked = cellFor(rows[focus], key).state === "linked";
  const res = await api.toggle(rows[focus].skill, target, { currentlyLinked, copy });
  const { cells } = await api.restat(rows.map((r) => r.skill), target);
  const toast = res.action === "skipped" ? `refused: ${res.reason ?? "skipped"}` : "";
  return { rows: replaceColumn(rows, key, cells), toast };
}

export function SkillBrowser({
  rows: initialRows,
  targets,
  always,
  api,
  onBack,
}: {
  rows: MatrixRow[];
  targets: Target[];
  always: Set<string>;
  api: BrowserApi; // App injects a cfg-bound api; tests inject a fake
  onBack?: () => void;
}) {
  const [rows, setRows] = useState<MatrixRow[]>(initialRows);
  const [focus, setFocus] = useState(0);
  const [targetIdx, setTargetIdx] = useState(0);
  const [copy, setCopy] = useState(false);
  const [toast, setToast] = useState<string>("");

  const activeTarget = targets[targetIdx];
  const activeKey = activeTarget ? activeTarget.alias ?? activeTarget.root : "";

  async function doToggle() {
    if (!activeTarget) return;
    const { rows: next, toast: t } = await toggleAt(rows, focus, activeTarget, copy, api);
    setRows(next);
    setToast(t);
  }

  useInput((input, key) => {
    const cellState = activeTarget ? cellFor(rows[focus], activeKey).state : undefined;
    const intent = keymap({ screen: "browser", focusedCell: cellState }, input, key as Key);
    switch (intent.type) {
      case "focusUp":
        setFocus((f) => Math.max(0, f - 1));
        break;
      case "focusDown":
        setFocus((f) => Math.min(rows.length - 1, f + 1));
        break;
      case "switchTarget":
        setTargetIdx((t) => (targets.length ? (t + 1) % targets.length : 0));
        setToast("");
        break;
      case "toggleCopy":
        setCopy((c) => !c);
        break;
      case "refusedToggle":
        setToast(`refused: ${intent.reason}`);
        break;
      case "toggleLink":
        void doToggle();
        break;
      case "back":
        onBack?.();
        break;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text dimColor>target: </Text>
        <Text color="cyan">{activeKey || "(none — register one)"}</Text>
        <Text dimColor>{copy ? "   [copy mode]" : ""}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {rows.map((r, i) => {
          const c = cellFor(r, activeKey);
          return (
            <Text key={r.skill.repo + ":" + r.skill.name} inverse={i === focus}>
              {GLYPH[c.state]} {r.skill.name}
              <Text dimColor>{alwaysTag(r.skill.src, always)}</Text>
              <Text dimColor> ({r.skill.repo})</Text>
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>space=toggle t=target c=copy ↑↓=move q=quit</Text>
      </Box>
      {toast ? (
        <Box marginTop={1}>
          <Text color="yellow">{toast}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// Build a cfg-bound BrowserApi from the real adapter (App uses this; tests inject a fake).
export function browserApi(cfg: import("../core/types.ts").Config): BrowserApi {
  return {
    toggle: (skill, target, opts) => actions.toggleLink(cfg, skill, target, opts),
    restat: (skills, target) => actions.restatColumn(cfg, skills, target),
  };
}
