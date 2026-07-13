# skillbox — manual smoke checklist (P2)

Automated `bun test` (37 tests) covers the core, the pure `keymap`/`toggleAt`/`gitBadge`/
`crossScopeDuplicates` logic, and static component rendering. Two things need a REAL
terminal (ink's `useInput` isn't drivable under ink-testing-library + Bun — keyboard
logic is therefore unit-tested in `keymap.test.ts` instead):

## Verified non-interactively (CI-safe)
- `bun test` → 37 pass, `bunx tsc --noEmit` → clean.
- CLI end-to-end walk (see below) — the real link operations behind the TUI.

```bash
# from skillbox/  — a throwaway target + isolated config
export XDG_CONFIG_HOME=$(mktemp -d); T=$(mktemp -d)/proj
bun src/cli.ts target add wp "$T"
bun src/cli.ts install wp --repo slides-grab --all   # → 5 linked
bun src/cli.ts status wp                              # → 5 ok
bun src/cli.ts prune wp                               # broken links only; foreign untouched
bun src/cli.ts uninstall wp --all                    # → no orphaned skillbox links remain
```

## Manual (needs a real TTY) — walk once before shipping
1. `skillbox target add work-plus-all /Users/rudy/Documents/LFin/Project/work-plus-all`
2. `skillbox ui` → **dashboard** lists repos with skill counts + git badges.
   - `↑/↓` move focus; `r` refreshes a git badge from `…` to `✔/↓N behind`.
   - `Enter` on a repo → **Screen B**.
3. **Screen B** (skill×target):
   - `space` on an absent skill → `[x]` appears; check `<target>/.claude/skills/<name>` is a symlink on disk.
   - `space` again → link removed on disk.
   - `t` cycles the active target (e.g. work-plus-all ↔ another registered one).
   - `space` on a `[o]` covered sub (umbrella linked) → refusal toast, no change.
   - `c` toggles copy mode.
   - `esc` → back to dashboard.
4. **Screen C**: from dashboard `h` → health of the first target. `p` prunes broken links;
   confirm foreign links and real dirs are shown but untouched.
5. **Exit hygiene**: press `q` → terminal restored (alt-screen left, cursor visible).
   Repeat and kill with Ctrl-C / `SIGINT` → terminal still restored (no leftover alt buffer).

Expected after the walk: no orphaned links in any target, clean terminal on both exit paths.
