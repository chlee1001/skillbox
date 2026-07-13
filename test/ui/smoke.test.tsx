// Risk-retirement: proves ink + react-reconciler render under Bun BEFORE any screen is
// built. If this fails, the whole TUI stack choice is wrong and we stop here.
import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";

test("ink renders a component tree under Bun", () => {
  const { lastFrame } = render(
    <Box flexDirection="column">
      <Text color="green">skillbox</Text>
      <Text>ready</Text>
    </Box>,
  );
  const frame = lastFrame() ?? "";
  expect(frame).toContain("skillbox");
  expect(frame).toContain("ready");
});
