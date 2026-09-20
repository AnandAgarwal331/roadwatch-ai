// A small seeded PRNG (mulberry32) for the mock AI provider's deterministic
// "same photo -> same analysis" behaviour. This intentionally does NOT
// reproduce Python's Mersenne Twister bit-for-bit - AI_PROVIDER=mock is an
// explicitly-labelled development stub ("not a trained model"), not
// production logic, so only the qualitative properties matter: deterministic
// per image, and visibly different photos yield visibly different output.

export async function seedFromBytes(bytes: Uint8Array): Promise<number> {
  // crypto.subtle.digest types its param as a fresh-ArrayBuffer-backed view;
  // `new Uint8Array(bytes)` guarantees that regardless of what backed `bytes`.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  const view = new DataView(digest);
  return view.getUint32(0);
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function uniform(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function weightedChoice<T>(rng: () => number, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
