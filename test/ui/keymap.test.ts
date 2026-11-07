import { test, expect } from "bun:test";
import { keymap, type KeyState, type Key } from "../../src/ui/keymap.ts";

const NO_KEY: Key = {};
const browser = (focusedCell?: KeyState["focusedCell"]): KeyState => ({ screen: "browser", focusedCell });

test("q quits from any screen", () => {
  expect(keymap({ screen: "dashboard" }, "q", NO_KEY).type).toBe("quit");
  expect(keymap(browser("absent"), "q", NO_KEY).type).toBe("quit");
});

test("arrows and j/k move focus", () => {
  expect(keymap(browser(), "", { upArrow: true }).type).toBe("focusUp");
  expect(keymap(browser(), "k", NO_KEY).type).toBe("focusUp");
  expect(keymap(browser(), "j", NO_KEY).type).toBe("focusDown");
  expect(keymap(browser(), "", { downArrow: true }).type).toBe("focusDown");
});

test("space toggles a free cell but is refused on covered/foreign/conflict", () => {
  expect(keymap(browser("absent"), " ", NO_KEY).type).toBe("toggleLink");
  expect(keymap(browser("linked"), " ", NO_KEY).type).toBe("toggleLink");

  const cov = keymap(browser("covered"), " ", NO_KEY);
  expect(cov.type).toBe("refusedToggle");
  expect(cov.type === "refusedToggle" && cov.reason).toContain("umbrella");

  expect(keymap(browser("foreign"), " ", NO_KEY).type).toBe("refusedToggle");
  expect(keymap(browser("conflict"), " ", NO_KEY).type).toBe("refusedToggle");
});

test("browser keys: t switches target, c toggles copy, escape backs out", () => {
  expect(keymap(browser(), "t", NO_KEY).type).toBe("switchTarget");
  expect(keymap(browser(), "c", NO_KEY).type).toBe("toggleCopy");
  expect(keymap(browser(), "", { escape: true }).type).toBe("back");
});

test("dashboard keys: enter opens repo, u pulls, f fetches, h health, r refresh", () => {
  const dash: KeyState = { screen: "dashboard" };
  expect(keymap(dash, "", { return: true }).type).toBe("openRepo");
  expect(keymap(dash, "u", NO_KEY).type).toBe("pull");
  expect(keymap(dash, "f", NO_KEY).type).toBe("fetch");
  expect(keymap(browser(), "f", NO_KEY).type).toBe("none");
  expect(keymap(dash, "r", NO_KEY).type).toBe("refresh");
  expect(keymap(dash, "h", NO_KEY).type).toBe("openHealth");
});

test("health screen: p prunes, escape backs out", () => {
  const h: KeyState = { screen: "health" };
  expect(keymap(h, "p", NO_KEY).type).toBe("prune");
  expect(keymap(h, "", { escape: true }).type).toBe("back");
});

test("unhandled keys are a no-op", () => {
  expect(keymap(browser(), "z", NO_KEY).type).toBe("none");
  expect(keymap({ screen: "dashboard" }, "x", NO_KEY).type).toBe("none");
});
