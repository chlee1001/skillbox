// Screen C — health of one target: linked/broken/foreign/real-dir entries, unmapped
// in-workspace links, and a cross-scope warning when a skill is linked in more than one
// scope (e.g. user global AND this project). `p` prunes only our broken links.

import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { InstalledLink, UnmappedLink } from "../core/types.ts";
import { keymap, type Key } from "./keymap.ts";

export interface HealthApi {
  prune(): Promise<string[]>;
}

// Names of our OK links whose SOURCE is also linked in another scope. Matched by src
// (the link target), not by bare name, so unrelated same-name skills aren't flagged.
export function crossScopeDuplicates(entries: InstalledLink[], otherLinkedSrcs: Set<string>): string[] {
  return entries
    .filter((e) => e.health.kind === "ok" && otherLinkedSrcs.has(e.health.target))
    .map((e) => e.name);
}

const MARK: Record<string, string> = {
  ok: "✔ ",
  broken: "✖ ",
  "foreign-link": "~ ",
  "real-dir": "· ",
};

export function Health({
  targetKey,
  entries: initial,
  unmapped,
  duplicates,
  api,
  onBack,
}: {
  targetKey: string;
  entries: InstalledLink[];
  unmapped: UnmappedLink[];
  duplicates: string[];
  api: HealthApi;
  onBack?: () => void;
}) {
  const [entries, setEntries] = useState<InstalledLink[]>(initial);
  const [note, setNote] = useState("");

  useInput((input, key) => {
    const intent = keymap({ screen: "health" }, input, key as Key);
    if (intent.type === "back") onBack?.();
    if (intent.type === "prune") {
      void api.prune().then((removed) => {
        setEntries((prev) => prev.filter((e) => !removed.includes(e.name)));
        setNote(removed.length ? `pruned ${removed.length}` : "nothing to prune");
      });
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        health — {targetKey}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {entries.map((e) => (
          <Text key={e.name} color={e.health.kind === "broken" ? "red" : undefined} dimColor={e.health.kind === "real-dir" || e.health.kind === "foreign-link"}>
            {MARK[e.health.kind] ?? "  "}
            {e.name}
          </Text>
        ))}
      </Box>
      {unmapped.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>unmapped in-workspace links (not a known skill):</Text>
          {unmapped.map((u) => (
            <Text key={u.name} dimColor>
              {"  "}? {u.name} -&gt; {u.target}
            </Text>
          ))}
        </Box>
      ) : null}
      {duplicates.length > 0 ? (
        <Box marginTop={1}>
          <Text color="yellow">also linked in another scope: {duplicates.join(", ")}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>p=prune broken  esc=back  q=quit</Text>
      </Box>
      {note ? <Text color="green">{note}</Text> : null}
    </Box>
  );
}
