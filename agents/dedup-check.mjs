// Assert the backlog dedup heuristic against cases it has actually got wrong.
// Free: no model, no network, no credentials, zero requests.
//
//   node agents/dedup-check.mjs        # exit 1 on any regression
//
// It exists because the failure it catches is silent AND self-worsening. The
// token pass runs before the model pass and deletes what it rejects, so a false
// positive destroys a good ticket with no recovery and no warning. On
// 2026-08-26 the Product Manager proposed three sound tickets, the heuristic
// killed all three, and the run still reported "clean · 0 errors, 0 warnings".
//
// The pool it compares against used to include every shipped ticket, so each
// thing the project built made the next proposal harder to pass. That is a
// ratchet: left alone it ends with a pipeline that proposes nothing at all and
// looks finished instead of broken.
//
// The three REAL rejected titles below, and the REAL titles they collided with,
// are the regression cases. If any of them starts matching again, this fails.
import { nearDuplicateOf, titleTokens, NEAR_DUP_THRESHOLD } from "./product-manager.mjs";

// Titles that were already on the board when the three good tickets were killed.
const SHIPPED = [
  "Fix contrast on  to meet WCAG AA",
  "Add a fourth gallery (the Condenser Gallery)",
  "Machine memory persists between descents",
  "Add a third device (the Safety Valve)",
  "Pressure naturally accumulates each turn, making it a genuine threat",
];

// [proposal, shouldBeTreatedAsDuplicate, why]
const CASES = [
  // --- The 2026-08-26 false positives. All three are genuinely new work. ---
  [
    "Fix #descent-outcome text contrast to meet WCAG AA minimum 4.5:1",
    false,
    "a different element than the earlier contrast fix — scored 1.00 under the old overlap metric because the existing title had lost its element name and kept only three content words",
  ],
  [
    "Add Condenser Coil device found in the Condenser Gallery",
    false,
    "a device is not the gallery it sits in — scored 0.67 under the old metric on the shared words 'condenser' and 'gallery'",
  ],
  [
    "Deepen Winder with machine memory across descents",
    false,
    "deepening one automaton is not the general memory system — scored exactly 0.60 under the old metric",
  ],

  // --- True duplicates. These MUST still be caught, or the fix is a hole. ---
  [
    "Machine memory persists between descents",
    true,
    "identical to a shipped title",
  ],
  [
    "machine memory persists between descent",
    true,
    "the same title reworded only by case and plural — what the heuristic is for",
  ],
];

function main() {
  const existing = SHIPPED.map((title) => ({ title, tokens: titleTokens(title) }));
  const failures = [];

  console.log(`=== Dedup check — ${CASES.length} case(s) at threshold ${NEAR_DUP_THRESHOLD} ===`);
  for (const [title, shouldMatch, why] of CASES) {
    const match = nearDuplicateOf(title, existing);
    const didMatch = Boolean(match);
    const ok = didMatch === shouldMatch;
    const verdict = didMatch
      ? `duplicate of "${match.title}" (${match.score.toFixed(2)})`
      : "new";
    console.log(`  ${ok ? "ok    " : "FAILED"} ${shouldMatch ? "dup" : "new"} — "${title}" → ${verdict}`);
    if (!ok) {
      failures.push(
        `"${title}" should be ${shouldMatch ? "a DUPLICATE" : "NEW"} but was judged ${verdict}. ${why}`
      );
    }
  }

  if (!failures.length) {
    console.log("All dedup cases behave as intended.");
    return;
  }
  console.log(`\n${failures.length} regression(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(
    "\nA false positive here silently deletes a good ticket; a false negative creates a duplicate. " +
      "The first is worse, because nothing downstream can recover the lost work."
  );
  process.exit(1);
}

main();
