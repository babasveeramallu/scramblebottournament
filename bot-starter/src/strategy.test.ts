// Checks for the default strategy. Run with `npm test`.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";
import { loadDictionary } from "./dictionary.js";
import { chooseWord, decideBid } from "./strategy.js";

const rack = (letters: string) => {
  const r = new Map<string, number>();
  for (const c of letters) r.set(c, (r.get(c) ?? 0) + 1);
  return r;
};

test("chooseWord returns the highest scoring word the rack can spell", () => {
  const dictionary = ["TACT", "CAT", "AT"];
  assert.equal(chooseWord({ myRack: rack("TACT"), dictionary }), "TACT");
  assert.equal(chooseWord({ myRack: rack("CATX"), dictionary }), "CAT");
  assert.equal(chooseWord({ myRack: rack("CX"), dictionary }), null);
});

test("chooseWord maximizes the game's letter and length reward", () => {
  const dictionary = ["AAAAAA", "JAZZ"];
  assert.equal(chooseWord({ myRack: rack("JAZZAAAAAA"), dictionary }), "JAZZ");
});

test("chooseWord applies the 3x reward to words of seven or more letters", () => {
  const dictionary = ["JAZZ", "SEQUOIA"];
  assert.equal(chooseWord({ myRack: rack("JAZZSEQUOIA"), dictionary }), "SEQUOIA");
});

test("decideBid prioritizes useful letters and avoids excessive duplicates", () => {
  const balance = 100;
  const firstA = decideBid({
    letter: "A",
    myBalance: balance,
    myRack: rack(""),
  });
  const duplicateA = decideBid({
    letter: "A",
    myBalance: balance,
    myRack: rack("AAA"),
  });
  assert.ok(firstA > duplicateA);

  const unsupportedQ = decideBid({
    letter: "Q",
    myBalance: balance,
    myRack: rack(""),
  });
  const supportedQ = decideBid({
    letter: "Q",
    myBalance: balance,
    myRack: rack("U"),
  });
  assert.ok(supportedQ > unsupportedQ);
});

test("decideBid never exceeds the available balance", () => {
  assert.equal(decideBid({ letter: "Z", myBalance: 1, myRack: rack("") }), 1);
  assert.equal(decideBid({ letter: "Z", myBalance: 10, myRack: rack("") }), 2);
  assert.equal(decideBid({ letter: "Z", myBalance: 0, myRack: rack("") }), 0);
  assert.equal(decideBid({ letter: "?", myBalance: 100, myRack: rack("") }), 0);
});

test("loadDictionary resolves and loads the shared wordlist", () => {
  const dictionary = loadDictionary(import.meta.url);
  assert.ok(dictionary.length > 0);
  assert.ok(dictionary.includes("QUIZ"));
  for (let i = 1; i < dictionary.length; i++) {
    assert.ok(dictionary[i - 1]!.length >= dictionary[i]!.length);
  }
});

// The bot can't see a match move on while it searches, so a slow search
// means bids on closed auctions and words from letters it already spent.
test("chooseWord searches the whole wordlist well within an auction", () => {
  const dictionary = fs
    .readFileSync(
      new URL("../../spacetimedb/wordlist.txt", import.meta.url),
      "utf8",
    )
    .split("\n")
    .map((l) => l.trim().toUpperCase())
    .filter((l) => l.length >= 2)
    .sort((a, b) => b.length - a.length);
  // The largest rack an admin can set, with almost nothing to spell.
  const myRack = rack("BCDFGHJKLMNPQRSTVWXZ");
  const start = performance.now();
  chooseWord({ myRack, dictionary });
  assert.ok(performance.now() - start < 100, "a search took 100 ms or more");
});
