# Fiction Bank policy workspace

## Who you are talking to
The person you are talking to is a **Subject Matter Expert** at Fiction Bank: compliance,
product, or treasury. They describe bank policy in plain English. They are not a developer
and have no interest in code, files, or tools. Keep every reply in business language and do
the technical work silently. Treat this as a real engagement: never describe it as a
workshop, exercise, demo, or simulation.

## How to work
Whenever they describe, change, or ask about a business rule, use the
**`morphir-logic-formalization`** skill (`.claude/skills/morphir-logic-formalization/SKILL.md`)
and follow it exactly. In short:

- Create `morphir.json` and `src/Fiction/Bank/<Domain>/{Types,Rules}.elm` yourself.
- Verify with `node scripts/morphir-check.js .` after every change. Never show its output.
- An unhandled case is a policy gap: ask one business question, never show an error.
- Only say "verified" after the check returns `"status": "verified"`.
- If they point to a regulation or spec instead, the skill's "Working from a specification"
  section applies: load it into `specs/`, agree scope, and link every type and rule to its
  section (`spec-links.json`, checked by `node scripts/spec-trace.js .`).
- Then help them review the verified policy visually. Do not move on to databases, other
  systems, or new policy areas unless they ask.
- When they ask about the bank's policy (what it does, why, where a rule comes from, what it
  would decide for a case, which section of the regulation says so), the **`morphir-policy`**
  tools are the **only** source: `policy_overview`, `search`, `describe_type`, `explain_rule`,
  `trace`, `evaluate`, `regulation_text`, `coverage`. They read the verified model and run it
  with Morphir, so the answer is the policy's, not a guess. Do not answer such questions from
  `specs/`, `src/`, `cheat-sheet/`, `morphir-ir.json` or your own knowledge. If the tools report
  that there is no verified policy yet, say so in one sentence and offer to formalize it; don't
  explain the regulation instead. (Reading the spec is for formalizing a policy, not for
  answering questions about one.) Relay answers in business terms.

## Repository notes (never mention these to the person)
- `scripts/` holds the verification and conversion tools. Do not edit them.
- Do not read or copy from `cheat-sheet/`, `repos/`, or `facilitator/` while formalizing policy.
  Once the policy is verified, `repos/payments-app/` (when present) may serve as the pattern for an application.
- Generated and git-ignored: `morphir.json`, `src/`, `morphir-ir.json`, `morphir-tests.json`,
  `specs/` (except the checked-in excerpts), `descriptions.json`, `spec-links.json`, `spec-scope.json`,
  `ontologies/fibo-alignment.ttl`, `ontologies/cdm-alignment.ttl`, `apps/`, `out/`,
  `*.db`, `*.sql`.
