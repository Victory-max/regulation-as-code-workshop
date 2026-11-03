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
npm install
pip install -r requirements.txt
claude
```

The last line starts Claude in this folder. Using the Claude desktop app instead? Open its
**Code** tab and choose the `regulation-as-code-workshop` folder.

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
| 1 | Write a policy: credit cards | Your Claude |
| 2 | Interpret a regulation: the Liquidity Resilience Ratio | Your Claude |
| 3 | The database and the notebook | Your Claude |
| 4 | Analysts ask the database | Facilitator's screen |
| 5 | Knowledge, FIBO, CDM and DataHub | Your Claude, then the facilitator's screen |
| 6 | What's next | Facilitator |

## Part 1: Write a policy (credit cards)

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

When the policy is **verified**, say yes to the visual view and the worked examples. Check
Claude's expected outcomes and correct any you disagree with.

**Ask your policy.** Once it's verified, describe a case and ask what happens:

> What happens to an active-duty cardholder with a 9% APR and a $25 late fee? Show me why.

The answer is your verified policy, run by Morphir, step by step. It isn't Claude guessing.

## Part 2: Interpret a regulation (the LRR)

The regulation is **PLA Rule 14** (`specs/pla-rule-14.md`, already in your folder) of the Prudential Liquidity Authority, and its Liquidity
Resilience Ratio (LRR). It is fictional on purpose: no AI has read it, so everything Claude
gets right comes from the text and from you. Paste:

> I'm in Treasury. We're supervised by the Prudential Liquidity Authority, and our liquidity
> reporting follows PLA Rule 14 and the Form PL-7 instructions in specs/pla-rule-14.md. Please
> formalize the Liquidity Resilience Ratio: our retail and small-business deposits and their
> outflow rules, our eligible liquid assets, the LRR calculation, the scaling factor and the
> minimum requirement.

Claude confirms the sections it will cover and asks you wherever the text is silent or
ambiguous. Every rule links back to the section it came from (the **Decorations** tab in the
visual view). Parts of the LRR this workshop doesn't model (other outflows, inflows, the
concentration add-on) are kept in the formula as reported figures.

**Ask your policy:**

> What would we assume runs off from a 2,000 deposit placed by a broker for a retail customer?

> Where does the LRR come from? Which sections of the rule?

## Part 3: The database and the notebook

> Create the database tables for this policy.

Claude generates the tables (with history: when each fact was true, and when the bank knew
it), a companion table for manual corrections, and sample data. Then it checks every result
against your policy, to the cent.

> Open the notebook.

Open `out/policy-notebook.ipynb` and choose **Run All**. In a Codespace or VS Code, click the
file in the explorer. Otherwise, in a second terminal in the same folder:

```bash
pip install jupyterlab
jupyter lab out/policy-notebook.ipynb
```

Then, back in Claude, try:

> What's our LRR today, and do we meet the minimum?

> One of our deposits was misclassified: it's broker-placed, not a transaction account.
> Record the correction.

## Part 4: Analysts ask the database (facilitator's screen)

Watch an AI analyst that has only the database answer questions about the LRR.

## Part 5: Knowledge, FIBO, CDM and DataHub

> Make this policy usable by our analysts and AI agents.

> Show me where the LRR comes from.

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
bash scripts/bootstrap-enterprise.sh --cheat-sheet scra            # after part 1
bash scripts/bootstrap-enterprise.sh --cheat-sheet lrr             # after part 2
```

## What's in this repo (for the curious)

| Path | What |
|---|---|
| `.claude/skills/morphir-logic-formalization/` | The skill that tells Claude how to formalize your policy silently |
| `scripts/morphir-policy-mcp.js` | The morphir-policy server: answers questions from your verified policy |
| `scripts/` | Compiler gate, Morphir → SQL transpilers, zero-drift check, bootstrap |
| `cheat-sheet/` | Pre-built verified policies for the fallback |
| `specs/` | Excerpts of PLA Rule 14 and the Form PL-7 instructions, the regulation source |
| `ontologies/fibo/` | A subset of FIBO (MIT-licensed, EDM Council) for aligning the policy's terms |
| `ontologies/cdm/` | A subset of the FINOS CDM rendered as RDF (Community Specification License 1.0) |
