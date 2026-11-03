# PLA Rule 14 and Form PL-7: the Liquidity Resilience Ratio (excerpt)

An excerpt of Rule 14 (Liquidity Resilience) of the Prudential Liquidity Authority (PLA) and
the instructions for Form PL-7, the Liquidity Position Report (revision 3, effective
2026-07-01). It covers retail and small-business deposits and their outflow rules, unrestricted
liquid assets and the asset codes that make them eligible, and the Liquidity Resilience Ratio
(LRR): the stock of eligible liquid assets, the tier limits, net stressed outflows, the scaling
factor and the minimum requirement.

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

## Part L: Liquid Assets

### L.1: Unrestricted Assets

Refers to assets owned outright by the reporting institution that are (i) free of legal,
regulatory, contractual or other restrictions on the institution's ability to sell or
repledge them; and (ii) not pledged, explicitly or implicitly, to secure, collateralise or
credit-enhance any transaction. Exclude assets pre-positioned with the central bank and
purchases that have traded but not settled.

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

### Asset Code

Use the asset code table in Schedule B to identify each asset.

- Where an asset could take more than one code, report the code of the lowest tier it qualifies for.
- Credit quality steps are those published by the PLA's credit assessment register.

### Market Value

Report the fair value of each asset under IFRS 13, at close of business on the reporting date,
in millions of FCR.

### Liquidity Desk Control

Flag ("Yes") assets that meet the operational requirements of Rule 14.7: the asset is under the
control of the function charged with managing the institution's liquidity; it can be sold or
repledged within three business days; and it is not designated to cover operational costs or
held as part of a client pool. Flag all other assets "No".

## Schedule B: Asset Code Table

The `-E` suffix indicates that the asset meets all the asset-specific tests of Rule 14.6
(credit quality, an active outright sale or repo market, and not issued by a financial
institution or its affiliates). Each eligible code belongs to one tier. The issuer type and
security type columns describe the asset; only the code and its tier are used by Rule 14.

| Code | Asset | Issuer type | Security type | Tier |
|------|-------|-------------|---------------|------|
| GV-1-E | Debt issued by the National Treasury of Fictonia | Sovereign | Debt | Tier 1 |
| GV-2-E | Debt issued by a Fictonian government agency with an explicit National Treasury guarantee | Quasi-government | Debt | Tier 1 |
| CB-0-E | Securities issued or guaranteed by a central bank, credit quality step 1 | Central bank | Debt | Tier 1 |
| SV-0-E | Debt issued by a foreign sovereign, credit quality step 1 | Sovereign | Debt | Tier 1 |
| SV-2-E | Debt issued by a foreign sovereign, credit quality step 2 | Sovereign | Debt | Tier 2 |
| SN-1-E | Debt issued by a supranational entity or multilateral development bank | Supranational | Debt | Tier 2 |
| RG-1-E | Debt issued by a Fictonian province | Regional government | Debt | Tier 2 |
| CR-1-E | Investment-grade debt issued by a non-financial corporate | Corporate | Debt | Tier 3 |
| EQ-1-E | Ordinary shares in the FX-200 index of the Fictonian Exchange | Corporate | Equity | Tier 3 |
| SN-1 | Supranational or development-bank debt that fails the Rule 14.6 tests | Supranational | Debt | Not eligible |
| EQ-1 | FX-200 ordinary shares that fail the Rule 14.6 tests | Corporate | Equity | Not eligible |
| EQ-2 | All other listed ordinary shares | Corporate | Equity | Not eligible |
| MU-1 | Debt issued by a municipality, whatever its rating | Regional government | Debt | Not eligible |
| AB-1 | Asset-backed securities | Special purpose vehicle | Debt | Not eligible |
| ZZ-9 | All other assets | Other | Other | Not eligible |

## Rule 14: Liquidity Resilience Ratio

### LRR Calculation

The LRR compares the stock of eligible liquid assets with the outflows the institution would
face over a 45-day stress period.

```
LRR = Stock of eligible liquid assets / Net stressed outflows

Tier 1 value = sum of the market values of eligible liquid assets (14.6) with a Tier 1 asset code
Tier 2 value = sum of the market values of eligible liquid assets (14.6) with a Tier 2 asset code
Tier 3 value = sum of the market values of eligible liquid assets (14.6) with a Tier 3 asset code

Stock of eligible liquid assets = Tier 1 value
    + .80 * Tier 2 value
    + .40 * Tier 3 value
    - Excess over tier limits

Excess over tier limits = Tier 2 and 3 limit excess + Tier 3 limit excess

Tier 2 and 3 limit excess = MAX[ 0,
    .80 * Tier 2 value
    + .40 * Tier 3 value
    - .8182 * Tier 1 value ]

Tier 3 limit excess = MAX[ 0,
    .40 * Tier 3 value
    - Tier 2 and 3 limit excess
    - .1111 * ( Tier 1 value + .80 * Tier 2 value ) ]

Net stressed outflows = Scaling factor * [ Stressed outflows
    - MIN [ Stressed inflows, .70 * Stressed outflows ]
    + Concentration add-on ]

Stressed outflows = sum of each outflow balance * its run-off rate (rules 14.21 onward)
```

The tier limits keep Tier 2 and Tier 3 together to at most 45 percent of the stock
(.8182 = 45/55), and Tier 3 alone to at most 10 percent (.1111 = 10/90). Report the LRR as a
percentage to two decimal places. The concentration add-on is calculated under Rule 14.40
and reported on Schedule F.

### Scaling Factor Table

Each institution applies the scaling factor for its PLA supervisory category.

| Supervisory category | Scaling factor |
|----------------------|----------------|
| Systemic institution | 100 percent |
| Large institution | 100 percent |
| Mid-sized institution with FCR 40 billion or more in short-term wholesale funding | 90 percent |
| Mid-sized institution with less than FCR 40 billion in short-term wholesale funding | 80 percent |
| Regional institution | 65 percent |

### Minimum Requirement

An institution must maintain an LRR of at least 110 percent on every business day.

### (14.6) Eligible Liquid Assets

An asset is an eligible liquid asset when all of the following hold.

| Field | Value |
|-------|-------|
| Part | L.1 |
| Asset Code | Tier 1, Tier 2 or Tier 3 (an `-E` code) |
| Liquidity Desk Control | Yes |

### Retail Outflow Rules

Each balance falls under the first rule below that it matches. Its stressed outflow is the
balance times the rule's run-off rate. A rule that does not name a Guarantee value applies
whatever the guarantee.

#### (14.21) Guaranteed Core Retail Deposits

| Field | Value |
|-------|-------|
| Part | R.1 and R.2 |
| Counterparty | Retail or Small Business |
| Guarantee | NDGS |
| Run-off rate | 4 percent |

#### (14.22) Unguaranteed Core Retail Deposits

| Field | Value |
|-------|-------|
| Part | R.1 and R.2 |
| Counterparty | Retail or Small Business |
| Guarantee | Foreign Scheme or Unguaranteed |
| Run-off rate | 8 percent |

#### (14.23) Rate-Seeking Retail Deposits

| Field | Value |
|-------|-------|
| Part | R.3 |
| Counterparty | Retail or Small Business |
| Run-off rate | 15 percent |

#### (14.24) Intermediated Retail Deposits

| Field | Value |
|-------|-------|
| Part | R.4 |
| Counterparty | Retail or Small Business |
| Run-off rate | 25 percent |

#### (14.25) Other Retail Balances

| Field | Value |
|-------|-------|
| Part | R.5 |
| Counterparty | Retail or Small Business |
| Run-off rate | 50 percent |
