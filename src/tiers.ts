// Tier → model config. Add, remove, or re-map models here without touching the
// rest of the code. `model` is the value passed to `claude --model` (short alias
// or full model id — Claude Code accepts either).

export interface Tier {
  key: string;
  model: string;
}

export const TIERS: Tier[] = [
  { key: "low", model: "haiku" },
  { key: "medium", model: "sonnet" },
  { key: "high", model: "opus" },
  { key: "creative", model: "claude-fable-5" },
];

export const DEFAULT_TIER_KEYS = ["low", "medium", "high"];

export function resolveTiers(keys: string[]): Tier[] {
  return keys.map((key) => {
    const tier = TIERS.find((t) => t.key === key);
    if (!tier) {
      const known = TIERS.map((t) => t.key).join(", ");
      throw new Error(`Unknown tier "${key}" (known tiers: ${known})`);
    }
    return tier;
  });
}
