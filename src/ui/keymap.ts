// Pure key → intent reducer. All keyboard semantics live here (not in JSX) so they are
// unit-testable without a terminal — ink-testing-library's focus/input handling is
// finicky, so this is where falsifiable coverage lives. Screens dispatch the returned
// intent; they never branch on raw keys themselves.

import type { CellState } from "../core/types.ts";

export type Screen = "dashboard" | "browser" | "health";

// The subset of ink's Key we care about (kept local so ui/keymap has no ink dependency).
export interface Key {
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  escape?: boolean;
}

export interface KeyState {
  screen: Screen;
  focusedCell?: CellState; // browser: state of the currently focused skill×target cell
}

export type Intent =
  | { type: "quit" }
  | { type: "focusUp" }
  | { type: "focusDown" }
  | { type: "toggleLink" }
  | { type: "refusedToggle"; reason: string }
  | { type: "switchTarget" }
  | { type: "toggleCopy" }
  | { type: "openRepo" }
  | { type: "openHealth" }
  | { type: "back" }
  | { type: "pull" }
  | { type: "refresh" }
  | { type: "prune" }
  | { type: "none" };

const REFUSE: Partial<Record<CellState, string>> = {
  covered: "covered by umbrella — unlink the umbrella to toggle sub-skills individually",
  foreign: "foreign link — the slot is occupied by something outside the workspace",
  conflict: "slot occupied by a real dir or another skill — resolve it first",
};

export function keymap(state: KeyState, input: string, key: Key): Intent {
  // Global
  if (input === "q") return { type: "quit" };
  if (key.upArrow || input === "k") return { type: "focusUp" };
  if (key.downArrow || input === "j") return { type: "focusDown" };
  if (input === "r") return { type: "refresh" };

  switch (state.screen) {
    case "browser": {
      if (key.escape) return { type: "back" };
      if (input === " ") {
        const reason = state.focusedCell ? REFUSE[state.focusedCell] : undefined;
        return reason ? { type: "refusedToggle", reason } : { type: "toggleLink" };
      }
      if (input === "t") return { type: "switchTarget" };
      if (input === "c") return { type: "toggleCopy" };
      return { type: "none" };
    }
    case "dashboard": {
      if (key.return) return { type: "openRepo" };
      if (input === "u") return { type: "pull" };
      if (input === "h") return { type: "openHealth" };
      return { type: "none" };
    }
    case "health": {
      if (key.escape) return { type: "back" };
      if (input === "p") return { type: "prune" };
      return { type: "none" };
    }
  }
}
