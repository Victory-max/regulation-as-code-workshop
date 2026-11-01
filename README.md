# Regulation as Code

**FINOS OSFF NYC workshop:** from human intent to verifiable financial logic with Morphir,
CDM, and AI agents.

You play a **Subject Matter Expert**. You describe Fiction Bank's policy to Claude in plain
English. Claude turns it into a verified, executable model behind the scenes. You never write
or read code.

## Setup (pick one)

### A. On your laptop (needs Node.js 20+)

```bash
git clone <this repo> regulation-as-code
cd regulation-as-code
npm install
pip install -r requirements.txt   # for the Beat 2 notebook (Python 3.10+)
```

Then open the folder in Claude Code: the **Code** tab of the Claude desktop app, or run
`claude` in a terminal from the folder.

### B. No Node.js? Use a Codespace

On this repo's GitHub page: **Code → Codespaces → Create codespace**. Wait for setup to
finish (about 3 minutes), then run `claude` in the terminal.

Either way, you'll need a Claude account (or the workshop API key your facilitator gives you).

## Beat 1: Write the policy

Paste this to Claude:

> I'm a compliance officer at Fiction Bank. Under the Servicemembers Civil Relief Act, our
> credit card APR for active-duty servicemembers is capped at 6%. If their contract rate is
> already lower, for example a promotional rate, they keep it. Active-duty cardholders pay no
> monthly fees. Our cardholders are active duty, civilian, pending verification, or exempt.
> Please formalize this policy.

Claude will come back with a question about a case you didn't cover. **That's the point.**
The compiler won't accept a policy with a gap. Answer in plain English, for example:

> Pending verification and exempt cardholders get standard terms. We apply relief once
> active duty is verified.

When the policy is **verified**, Claude offers to show it visually and to add worked
example scenarios. Say yes to both. Claude proposes the scenarios; check its expected
outcomes and correct any you disagree with. Then Claude walks you through the visual view,
rule by rule, asking whether each one matches your intent.

### Part 2: Interpret a regulation

This time the source is the regulation, not you. Paste:

> I'm in Treasury. Our liquidity reporting follows the FR 2052a instructions in
> specs/fr2052a-retail-deposits.md. Please formalize how our retail and small-business
> deposits (O.D.1 to O.D.3, O.D.14 and O.D.15) map to the LCR outflow rules (10) to (14).

Claude reads the instructions, confirms the sections it will cover, and asks you wherever
the text is silent or ambiguous. Every rule it produces links back to the section it came
from: you'll see those links on the **Decorations** tab during the visual review.

### Part 3 (optional, if you finish early): HQLA

The other side of the LCR: the high-quality liquid assets that cover those outflows. Paste:

> Next, our HQLA amount. Use the FR 2052a instructions in specs/fr2052a-hqla.md: I.A.1
> unencumbered assets, the asset categories in Appendix III, rule (1), and the HQLA amount
> in the LCR Calculation.

Expect Claude to agree what is out of scope (haircut values and the secured unwinds) before
it builds. The HQLA amount is built from smaller measures (Level 1, 2A and 2B values and
the cap excesses), and in Beat 3 each becomes a metric in the catalog, linked to the ones
it is built from.

Beat 1 ends when you've confirmed every rule.

## Beat 2: The enterprise

Turn the verified policy into the bank's systems.

> Create the database tables for this policy.

Claude generates the tables, including history (when each fact was true, and when the bank
knew it) and a companion table for manual adjustments, loads sample data, and checks every
result against your policy, to the cent. It also writes a notebook to explore the result.

> Open the notebook.

Open `out/policy-notebook.ipynb` and choose **Run All**: results per record, totals and
charts, a what-if, and a correction shown before and after. Then try it in conversation:

> This cardholder's active-duty orders arrived late. Correct their status to active duty.

> How many active-duty cardholders do we have, and how much interest did they pay?

Your facilitator will also demo how an engineering team builds a service on the same verified
policy.

## Beat 3: Knowledge

Make the policy understandable to analysts and AI agents.

> Make this policy usable by our analysts and AI agents.

Claude generates, from the same verified policy:

- a guide to each table: what it holds, how its history and adjustments work, how to query it;
- question-and-answer guides for common business questions, with evaluations to test an
  AI agent's answers;
- lineage and a business glossary for the data catalog (DataHub);
- metric definitions in the Open Semantic Interchange (OSI) format;
- a domain ontology (Turtle), ready to link to an upper ontology such as FIBO.

## Beat 4: What's next in Morphir

Facilitator presentation.

## If something stalls

If Wi-Fi or Claude is slow, your facilitator may ask you to continue from a pre-built result:

```bash
bash scripts/bootstrap-enterprise.sh --cheat-sheet scra   # Beat 1 part 1
bash scripts/bootstrap-enterprise.sh --cheat-sheet lcr    # Beat 1 part 2
bash scripts/bootstrap-enterprise.sh --cheat-sheet hqla   # Beat 1 part 3
```

## What's in this repo (for the curious)

| Path | What |
|---|---|
| `.claude/skills/morphir-logic-formalization/` | The skill that tells Claude how to formalize your policy silently |
| `scripts/` | Compiler gate, Morphir → SQL transpilers, zero-drift check, bootstrap |
| `cheat-sheet/` | Pre-built verified policies for the fallback |
| `specs/` | FR 2052a excerpts used as the regulation source |
