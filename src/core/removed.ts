import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

export type RemovedEntry = {
  name: string;
  url: string;
  added: string;
  removed: string;
  skills: string[];
};

export async function readRemoved(workspace: string): Promise<RemovedEntry[]> {
  let text: string;
  try {
    text = await readFile(join(workspace, ".skillboxremoved"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries: RemovedEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length !== 5 || !fields[0] || !fields[2] || !fields[3]) continue;
    const [name, url, added, removed, skills] = fields;
    entries.push({ name, url, added, removed, skills: skills ? skills.split(",") : [] });
  }
  return entries;
}

export async function appendRemoved(workspace: string, entry: RemovedEntry): Promise<void> {
  const fields = [entry.name, entry.url, entry.added, entry.removed, entry.skills.join(",")];
  if (fields.some((field) => /[\t\r\n]/.test(field)) || entry.skills.some((skill) => skill.includes(","))) {
    throw new Error("repo metadata cannot be represented in .skillboxremoved");
  }
  const path = join(workspace, ".skillboxremoved");
  let previous: string;
  try {
    previous = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    previous = "";
  }
  await appendFile(path, `${previous && !previous.endsWith("\n") ? "\n" : ""}${fields.join("\t")}\n`);
}
