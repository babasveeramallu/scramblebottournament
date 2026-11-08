// Edit this file to implement your bidding and word-forming strategy.

// Standard Scrabble letter values — useful for valuation.
export const LETTER_VALUE: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

export interface BidContext {
  letter: string;        // Letter being auctioned, e.g. "Q"
  myBalance: number;     // Current balance
  myRack: Map<string, number>; // Letters you currently own, letter -> count
}

const VOWELS = new Set(["A", "E", "I", "O", "U"]);
const COMMON_CONSONANTS = new Set(["R", "S", "T", "L", "N"]);
const OTHER_COMMON_CONSONANTS = new Set(["C", "D", "M", "P", "B", "G", "H"]);

/**
 * Bid for useful letters while keeping enough balance for later auctions.
 */
export function decideBid(ctx: BidContext): number {
  const letter = ctx.letter.toUpperCase();
  const value = LETTER_VALUE[letter];
  const balance = Math.floor(ctx.myBalance);
  if (!value || !Number.isFinite(balance) || balance <= 0) return 0;

  const have = ctx.myRack.get(letter) ?? 0;
  const isVowel = VOWELS.has(letter);
  const duplicateFactor =
    have === 0
      ? 1
      : have === 1
        ? isVowel
          ? 0.7
          : 0.55
        : have === 2
          ? isVowel
            ? 0.45
            : 0.25
          : isVowel
            ? 0.2
            : 0;

  const usefulness = isVowel
    ? 4
    : COMMON_CONSONANTS.has(letter)
      ? 3
      : OTHER_COMMON_CONSONANTS.has(letter)
        ? 2
        : 1;
  let valueForBid = value + usefulness;

  if (letter === "Q") {
    const hasSupport =
      (ctx.myRack.get("U") ?? 0) > 0 || (ctx.myRack.get("I") ?? 0) > 0;
    valueForBid *= hasSupport ? 1.15 : 0.65;
  }

  const desired = Math.max(1, Math.ceil(valueForBid * duplicateFactor));
  const budget = Math.max(1, Math.floor(balance * 0.2));
  return Math.min(desired, budget, balance);
}

export interface WordContext {
  myRack: Map<string, number>;
  dictionary: string[]; // Sorted uppercase list, shared at startup
}

/**
 * Try to form a word using letters from `myRack`.
 * Return the word (uppercase) to play, or null to skip.
 *
 * Select the playable word with the highest immediate game reward.
 *
 * Keep this fast. The bot runs it on every rack change, and while it runs
 * the bot can't see the match move on: a search that takes longer than an
 * auction means bids on closed auctions and words from spent letters.
 */
export function chooseWord(ctx: WordContext): string | null {
  const available = new Int16Array(26);
  let tiles = 0;
  for (const [letter, count] of ctx.myRack) {
    const index = letter.charCodeAt(0) - 65;
    if (index < 0 || index >= 26 || count <= 0) continue;
    available[index] += count;
    tiles += count;
  }

  let bestWord: string | null = null;
  let bestReward = -1;
  for (const word of ctx.dictionary) {
    if (word.length < 2 || word.length > tiles || !canSpell(word, available)) {
      continue;
    }

    const reward = wordReward(word);
    if (
      reward > bestReward ||
      (reward === bestReward && word.length > (bestWord?.length ?? 0))
    ) {
      bestWord = word;
      bestReward = reward;
    }
  }
  return bestWord;
}

function wordReward(word: string): number {
  let baseScore = 0;
  for (const letter of word) {
    baseScore += LETTER_VALUE[letter] ?? 0;
  }

  switch (word.length) {
    case 4:
      return Math.floor((baseScore * 3) / 2);
    case 5:
      return baseScore * 2;
    case 6:
      return Math.floor((baseScore * 5) / 2);
    default:
      return word.length >= 7 ? baseScore * 3 : baseScore;
  }
}

// Temporarily consume letters and restore them so each dictionary candidate
// is checked against the original rack without allocating per candidate.
function canSpell(word: string, available: Int16Array): boolean {
  let used = 0;
  for (; used < word.length; used++) {
    const index = word.charCodeAt(used) - 65;
    if (index < 0 || index >= 26 || available[index] === 0) break;
    available[index]--;
  }
  for (let i = 0; i < used; i++) {
    available[word.charCodeAt(i) - 65]++;
  }
  return used === word.length;
}
