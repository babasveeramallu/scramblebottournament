// Checks for the default strategy. Run with `npm test`.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";
import { loadDictionary } from "./dictionary.js";
import { chooseWord, choosePlays, decideBid, shouldPlayWord } from "./strategy.js";

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
  assert.ok(decideBid({ letter: "Z", myBalance: 10, myRack: rack("") }) <= 10);
  assert.equal(decideBid({ letter: "Z", myBalance: 0, myRack: rack("") }), 0);
  assert.equal(decideBid({ letter: "?", myBalance: 100, myRack: rack("") }), 0);
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const bid = decideBid({
      letter,
      myBalance: 30,
      myRack: rack("AEIRST"),
      lettersLeft: 2,
    });
    assert.ok(bid >= 0 && bid <= 30, `${letter} bid ${bid}`);
  }
});

test("decideBid pays more for high-value letters at the start of a match", () => {
  const start = { myBalance: 100, myRack: rack("AETRN"), lettersLeft: 67 };
  for (const letter of "DSLE") {
    const bid = decideBid({ ...start, letter });
    assert.ok(bid >= 6 && bid <= 40, `${letter} bid ${bid}`);
  }
  const e = decideBid({ ...start, letter: "E" });
  for (const letter of "ZXK") {
    const bid = decideBid({ ...start, letter });
    assert.ok(bid > e && bid <= 50, `${letter} bid ${bid}`);
  }
});

test("decideBid spends a hoarded balance as the bag runs out", () => {
  const myRack = rack("AETRN");
  const early = decideBid({ letter: "D", myBalance: 100, myRack, lettersLeft: 60 });
  const late = decideBid({ letter: "D", myBalance: 100, myRack, lettersLeft: 3 });
  assert.ok(late > early);
  const broke = decideBid({ letter: "D", myBalance: 12, myRack, lettersLeft: 40 });
  assert.ok(broke <= Math.floor(12 * 0.5));
});

test("shouldPlayWord holds letters for long words and cashes in at the end", () => {
  assert.equal(shouldPlayWord({ word: "CAT", lettersLeft: 50, myBalance: 80 }), false);
  assert.equal(shouldPlayWord({ word: "CRATES", lettersLeft: 50, myBalance: 80 }), false);
  assert.equal(shouldPlayWord({ word: "CATER", lettersLeft: 15, myBalance: 80 }), false);
  assert.equal(shouldPlayWord({ word: "REVISITS", lettersLeft: 50, myBalance: 80 }), true);
  assert.equal(shouldPlayWord({ word: "KYANIZE", lettersLeft: 50, myBalance: 80 }), true);
  assert.equal(shouldPlayWord({ word: "CATER", lettersLeft: 2, myBalance: 80 }), true);
  assert.equal(shouldPlayWord({ word: "CAT", lettersLeft: 50, myBalance: 3 }), true);
  assert.equal(shouldPlayWord({ word: "AT", lettersLeft: 2, myBalance: 80 }), true);
  assert.equal(shouldPlayWord({ word: "AT" }), true);
});

test("choosePlays empties the rack into several words at the end", () => {
  const dictionary = ["CART", "DOG", "CAT", "RE"];
  const plays = choosePlays({
    myRack: rack("CATDOGRE"),
    dictionary,
    lettersLeft: 2,
    myBalance: 50,
  });
  assert.deepEqual(plays, ["CART", "DOG"]);
  assert.deepEqual(
    choosePlays({ myRack: rack("CATDOGRE"), dictionary, lettersLeft: 50, myBalance: 50 }),
    [],
  );
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
