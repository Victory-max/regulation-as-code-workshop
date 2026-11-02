# PLA Rule 14 and Form PL-7: Retail Deposits and Outflow Rules (excerpt)

An excerpt of Rule 14 (Liquidity Resilience) of the Prudential Liquidity Authority (PLA) and
the instructions for Form PL-7, the Liquidity Position Report (revision 3, effective
2026-07-01). It covers retail and small-business deposits and the outflow rules 14.21 to
14.25 that apply to them, with their run-off rates.

Fiction Bank is supervised by the PLA and reports Form PL-7 every business day. All amounts
are reported in millions of Fictonian crowns (FCR).

**Source.** PLA Rule 14 and the Form PL-7 instructions, revision 3, as published to
supervised institutions. The Rule text remains authoritative; this is a working copy of the
sections Fiction Bank's liquidity policy relies on.

## Part R: Retail Deposits

Report each deposit balance by product, by the type of counterparty that placed it, and by
whether the National Deposit Guarantee Scheme covers it in full (the Guarantee field).

The following products are reported in Part R:

### R.1: Transaction Accounts

Refers to current and payment accounts that the depositor uses for day-to-day transactions:
salary credits, card settlement, direct debits and transfers.

### R.2: Relationship Savings Accounts

Refers to savings accounts held by a depositor who also holds a transaction account or a loan
with the reporting institution, where the relationship makes withdrawal in a stress unlikely.

### R.3: Rate-Seeking Savings Accounts

Refers to savings accounts that do not qualify under R.2, including accounts opened through a
rate comparison service or carrying a promotional rate.

### R.4: Intermediated Deposits

Refers to deposits placed by a third party, such as a deposit broker, platform or wealth
manager, on behalf of retail or small-business customers.

### R.5: Other Retail Balances

Refers to retail balances that do not meet any of the definitions above, including banker's
drafts, unclaimed balances and merchant settlement balances.

## Field definitions

### Counterparty

Report the type of the legal counterparty that placed the balance (not its ultimate parent).

- Retail — a natural person, including a joint account held only by natural persons.
- Small Business — an entity managed as a retail exposure whose total funding from the reporting institution's group does not exceed FCR 2.5 million.
- Non-Financial Corporate — a commercial entity that is not a financial institution.
- Sovereign — a central government, or one of its agencies or ministries.
- Central Bank — a bank responsible for its jurisdiction's monetary policy.
- Regional Government — a province, municipality or other government below the sovereign level.
- Bank — a deposit-taking institution.
- Non-Bank Financial — an insurer, fund, broker-dealer or other financial institution that is not a bank.
- Other — any counterparty not covered above.

### Guarantee

Use this field to show whether a balance is covered in full by a deposit guarantee scheme.

- NDGS — covered in full by the National Deposit Guarantee Scheme of Fictonia.
- Foreign Scheme — covered in full by another jurisdiction's government deposit guarantee scheme.
- Unguaranteed — not covered in full by any government deposit guarantee scheme.

Only NDGS coverage counts as guaranteed for Rule 14; a balance covered by a foreign scheme is
treated as unguaranteed.

### Balance

Report the balance of the account or group of accounts on the reporting date, in millions of
FCR, including accrued interest. Aggregate accounts that share all non-numeric field values
into one record.

## Rule 14: Retail Outflow Rules

Each balance falls under the first rule below that it matches. Its stressed outflow is the
balance times the rule's run-off rate. A rule that does not name a Guarantee value applies
whatever the guarantee.

### (14.21) Guaranteed Core Retail Deposits

| Field | Value |
|-------|-------|
| Part | R.1 and R.2 |
| Counterparty | Retail or Small Business |
| Guarantee | NDGS |
| Run-off rate | 4 percent |

### (14.22) Unguaranteed Core Retail Deposits

| Field | Value |
|-------|-------|
| Part | R.1 and R.2 |
| Counterparty | Retail or Small Business |
| Guarantee | Foreign Scheme or Unguaranteed |
| Run-off rate | 8 percent |

### (14.23) Rate-Seeking Retail Deposits

| Field | Value |
|-------|-------|
| Part | R.3 |
| Counterparty | Retail or Small Business |
| Run-off rate | 15 percent |

### (14.24) Intermediated Retail Deposits

| Field | Value |
|-------|-------|
| Part | R.4 |
| Counterparty | Retail or Small Business |
| Run-off rate | 25 percent |

### (14.25) Other Retail Balances

| Field | Value |
|-------|-------|
| Part | R.5 |
| Counterparty | Retail or Small Business |
| Run-off rate | 50 percent |
