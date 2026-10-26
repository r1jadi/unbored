import type { GameRule } from "@/lib/games/rules";

/** A game's rules as the rules card shows them: each one led by its bold lead. */
export function RulesList({ rules }: { rules: readonly GameRule[] }) {
  return (
    <div className="w-full space-y-2 rounded-2xl bg-surface p-4 text-left text-sm">
      {rules.map((rule) => (
        <p key={rule.lead}>
          <span className="font-medium text-foreground">{rule.lead}</span> {rule.text}
        </p>
      ))}
    </div>
  );
}
