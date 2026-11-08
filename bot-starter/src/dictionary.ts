import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export function loadDictionary(moduleUrl: string): string[] {
  const dictionaryPath = path.join(
    path.dirname(fileURLToPath(moduleUrl)),
    "..",
    "..",
    "spacetimedb",
    "wordlist.txt",
  );
  const dictionary = fs
    .readFileSync(dictionaryPath, "utf8")
    .split("\n")
    .map((word) => word.trim().toUpperCase())
    .filter((word) => word.length >= 2);

  if (dictionary.length === 0) {
    throw new Error(`Scrabble dictionary is empty: ${dictionaryPath}`);
  }

  dictionary.sort((a, b) => b.length - a.length);
  return dictionary;
}
