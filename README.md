# Regulation as Code

**FINOS OSFF NYC workshop:** from human intent to verifiable financial logic with Morphir,
CDM, and AI agents.

You play a **Subject Matter Expert**. You describe Fiction Bank's policy to Claude in plain
English. Claude turns it into a verified, executable model behind the scenes. You never write
or read code.

## Setup (pick one)

### A. On your laptop (needs Node.js 20+ and Python 3.10+)

```bash
git clone https://github.com/stephengoldbaum/regulation-as-code-workshop.git
cd regulation-as-code-workshop
./setup.sh
```

Then start Claude in this folder: in the Claude desktop app, **Code** tab → new session → choose
the `regulation-as-code-workshop` folder. Or type `claude` in the same terminal.

### B. No Node.js? Use a Codespace

On this repo's GitHub page: **Code → Codespaces → Create codespace**. Setup takes about
3 minutes and installs everything. Its terminal is already in the repo folder: type `claude`.

### Always start Claude in that folder

Every part of the session happens in one Claude session started in **the repo's top folder**
(`regulation-as-code-workshop`, the one with this README). Not a parent folder, not a
subfolder. If you close Claude, `cd` back there and run `claude` again.

The first time, Claude asks to approve **morphir-policy**. Say **yes**: it lets Claude answer
questions from your policy once it's verified.

You need a Claude account (or the workshop key your facilitator gives you).

## The session

| Part | What happens | Where |
|---|---|---|
| 1 | Your own rule, its database and API, and an app | Your Claude |
| 2 | Interpret a regulation: the Liquidity Resilience Ratio | Your Claude |
| 3 | The database and the notebook | Your Claude |
| 4 | Analysts ask the database | Facilitator's screen |
| 5 | Knowledge, FIBO, CDM and DataHub | Your Claude, then the facilitator's screen |
| 6 | What's next | Facilitator |

## Part 1: Your own rule, its database and API, and an app

**Describe a simple rule from your work** in plain English, ending with *Please formalize this
policy.* Ideas: an overdraft fee waiver, a loan eligibility check, a loyalty discount. Or use this
one:

> I'm a compliance officer at Fiction Bank. Under the Servicemembers Civil Relief Act, our
> credit card APR for active-duty servicemembers is capped at 6%. If their contract rate is
> already lower, for example a promotional rate, they keep it. Active-duty cardholders pay no
> monthly fees. Our cardholders are active duty, civilian, pending verification, or exempt.
> Please formalize this policy.

Claude comes back with questions about cases you didn't cover. **That's the point**: the
compiler won't accept a policy with a gap. Answer in plain English. Then, in the same session:

1. When it says **verified**: `Yes, show me`. The policy viewer opens in the app.
2. `I could use some prebuilt test cases`, check the expected outcomes, then `Yes, add them`.
3. When they match: `Yes, matches`.

Now turn it into an app:

> Create the database and API for this policy.

The database and the API are generated from your verified policy (not written by the AI). Then
**describe the screen you want**: who uses it, what they enter, what they see. For example:

> Build a screen where a call-centre agent enters a cardholder's military status, contract APR
> and monthly fees, and sees the APR and fees the bank actually applies.

You can also ask for both at once, e.g. `create the database and an ATM app that offers the user
the various ways to pay`. The screen opens at `http://localhost:8000/app/`. It asks the API for
every answer and contains no rule of its own, so it always says what your policy says. Ask for
changes in plain English.

What came from where: the tables, the rules as database views, the sample data, the check against
Morphir, the rules as Python and the API are all **generated from your verified Morphir model by
scripts**, the same every time. The AI wrote two things: the model (from your words, then verified)
and the screen (from your description).

## Part 2: Interpret a regulation (the LRR)

The regulation is **PLA Rule 14** (`specs/pla-rule-14.md`, already in your folder), with its
Liquidity Resilience Ratio (LRR). It is fictional on purpose: no AI has read it, so everything
Claude gets right comes from the text and from you. Paste:

> I'm in Treasury. We're supervised by the Prudential Liquidity Authority, and our liquidity
> reporting follows PLA Rule 14 and the Form PL-7 instructions in specs/pla-rule-14.md. Please
> formalize the Liquidity Resilience Ratio: our retail and small-business deposits and their
> outflow rules, our eligible liquid assets, the LRR calculation, the scaling factor and the
> minimum requirement.

1. Answer its questions as Treasury (or say `you suggest`).
2. When it's verified: `Yes, show me`, then the test cases as in Part 1. The **Decorations** tab
   shows the section of the regulation each rule comes from.
3. **Ask your policy.** For example: `what's the main top level calculation?` Claude answers
   through **morphir-policy**, which runs your verified model with Morphir itself.

## Part 3: The database and the notebook

> Create the database for this policy.

Claude generates, from your verified policy, the tables (with history: when each fact was true,
and when the bank knew it), a companion table for manual corrections, sample data, a notebook,
and the rules as Python code (`out/policy_rules.py`). Every database result is checked against
your policy to the cent.

1. When it offers the notebook: `Yes, open it`. It opens in the app (if it doesn't run, say
   `didn't work, try again`). Its last section shows the rules as Python, agreeing with the database.
2. Record a correction:

> One of our deposits was misclassified: it's broker-placed, not a transaction account. Use the
> largest retail one, from the start of the record, and show me before and after.

## Part 4: Analysts ask the database (facilitator's screen)

Watch an AI analyst that has only the database answer questions about the LRR.

## Part 5: Knowledge, FIBO, CDM and DataHub

One at a time:

> Make this policy usable by our analysts and AI agents.

If a quality check finds the stored LRR out of date, say `Yes, recalculate`.

> Align our policy terms to FIBO, using the FIBO subset in ontologies/fibo/.

> Now align our policy's fields and values to CDM, using the CDM subset in ontologies/cdm/.

FIBO says what each concept **is**; CDM says where its data **lives**. Claude gives a reason for
every mapping and lists what the standard has no counterpart for. Then watch on the
facilitator's screen as it all goes into DataHub and a second analyst asks the hard questions.

## Part 6: What's next in Morphir

Facilitator presentation.

## If something stalls

If Wi-Fi or Claude is slow, your facilitator may ask you to continue from a pre-built result:

```bash
bash scripts/bootstrap-enterprise.sh --cheat-sheet scra            # part 1 (then describe the screen)
bash scripts/bootstrap-enterprise.sh --cheat-sheet lrr             # after part 2
```

## What's in this repo (for the curious)

| Path | What |
|---|---|
| `.claude/skills/morphir-logic-formalization/` | The skill that tells Claude how to formalize your policy silently |
| `scripts/morphir-policy-mcp.js` | The morphir-policy server: answers questions from your verified policy |
| `scripts/morphir-to-api.js`, `scripts/morphir-to-python.js` | Generate the API (`out/api.py`) and the rules as Python from your verified policy |
| `scripts/` | Compiler gate, Morphir → SQL transpilers, zero-drift check, bootstrap |
| `cheat-sheet/` | Pre-built verified policies for the fallback |
| `specs/` | Excerpts of PLA Rule 14 and the Form PL-7 instructions, the regulation source |
| `ontologies/fibo/` | A subset of FIBO (MIT-licensed, EDM Council) for aligning the policy's terms |
| `ontologies/cdm/` | A subset of the FINOS CDM rendered as RDF (Community Specification License 1.0) |
