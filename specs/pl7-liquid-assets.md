# PLA Rule 14 and Form PL-7: Eligible Liquid Assets and the LRR Calculation (excerpt)

An excerpt of Rule 14 (Liquidity Resilience) of the Prudential Liquidity Authority (PLA) and
the instructions for Form PL-7, the Liquidity Position Report (revision 3, effective
2026-07-01). It covers unrestricted liquid assets, the asset codes that make them eligible,
and the Liquidity Resilience Ratio (LRR): the stock of eligible liquid assets, the tier
limits, net stressed outflows, the scaling factor and the minimum requirement.

Fiction Bank is supervised by the PLA and reports Form PL-7 every business day. All amounts
are reported in millions of Fictonian crowns (FCR).

**Source.** PLA Rule 14 and the Form PL-7 instructions, revision 3, as published to
supervised institutions. The Rule text remains authoritative; this is a working copy of the
sections Fiction Bank's liquidity policy relies on.

## Part L: Liquid Assets

### L.1: Unrestricted Assets

Refers to assets owned outright by the reporting institution that are (i) free of legal,
regulatory, contractual or other restrictions on the institution's ability to sell or
repledge them; and (ii) not pledged, explicitly or implicitly, to secure, collateralise or
credit-enhance any transaction. Exclude assets pre-positioned with the central bank under
its standing facilities; report them under L.2: Pre-positioned Assets. Exclude purchases that
have traded but not settled; report them under L.4: Pending Purchases. Do not net the value
of hedges against the value of the asset.

## Field definitions

### Asset Code

Use the asset code table in Schedule B to identify each asset.

- Where an asset could take more than one code, report the code of the lowest tier it qualifies for.
- Credit quality steps are those published by the PLA's credit assessment register.
- Refer questions on the coding of a specific asset to the institution's PLA supervision team.

### Market Value

Report the fair value of each asset under IFRS 13, at close of business on the reporting date,
in millions of FCR.

- For assets without an observable price, report the most recent independent valuation.

### Liquidity Desk Control

Flag ("Yes") assets that meet the operational requirements of Rule 14.7: the asset is under the
control of the function charged with managing the institution's liquidity; it can be sold or
repledged within three business days; and it is not designated to cover operational costs or
held as part of a client pool. Flag all other assets "No".

## Schedule B: Asset Code Table

The `-E` suffix indicates that the asset meets all the asset-specific tests of Rule 14.6
(credit quality, an active outright sale or repo market, and not issued by a financial
institution or its affiliates). Each eligible code belongs to one tier.

- **Tier 1**
  - GV-1-E — Debt issued by the National Treasury of Fictonia
  - GV-2-E — Debt issued by a Fictonian government agency with an explicit National Treasury guarantee
  - CB-0-E — Securities issued or guaranteed by a central bank, credit quality step 1
  - SV-0-E — Debt issued by a foreign sovereign (excluding central banks), credit quality step 1
- **Tier 2**
  - SV-2-E — Debt issued by a foreign sovereign (excluding central banks), credit quality step 2
  - PS-1-E — Senior debt issued by a Fictonian public-sector enterprise
  - CV-1-E — Covered bonds rated AA- or better
- **Tier 3**
  - CR-1-E — Investment-grade debt issued by a non-financial corporate
  - EQ-1-E — Common equity in the FX-200 index of the Fictonian Exchange
- **Not eligible — assets that fail the asset-specific tests of Rule 14.6**
  - PS-1 — Senior debt issued by a Fictonian public-sector enterprise
  - EQ-1 — Common equity in the FX-200 index of the Fictonian Exchange
- **Not eligible — other**
  - EQ-2 — All other listed common equity
  - MU-1 — Debt issued by a municipality (not eligible under Rule 14, whatever its rating)
  - AB-1 — Asset-backed securities
  - ZZ-9 — All other assets

## Rule 14: Liquidity Resilience Ratio

### Key

| Symbol | Meaning |
|--------|---------|
| `*` | Values used by Rule 14 |
| `#` | Values not used by Rule 14 |
| `NULL` | Should not have an associated value |

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

An institution must maintain an LRR of at least 110 percent on every business day. An
institution whose LRR falls below 110 percent must notify the PLA the same day.

### (14.6) Eligible Liquid Assets

| Field | Value |
|-------|-------|
| Reporting Entity | PL-7 Filer |
| Part | L.1 |
| Market Value | * |
| Maturity Bucket | # |
| Asset Code | Tier 1, Tier 2 or Tier 3 (an `-E` code) |
| Liquidity Desk Control | Yes |
| Encumbrance Type | NULL |
| Internal Counterparty | # |
