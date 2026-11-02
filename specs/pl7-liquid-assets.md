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
credit-enhance any transaction. Exclude assets pre-positioned with the central bank and
purchases that have traded but not settled.

## Field definitions

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
