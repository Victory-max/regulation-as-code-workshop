# FR 2052a: High-Quality Liquid Assets (excerpt)

An excerpt of the FR 2052a Complex Institution Liquidity Monitoring Report instructions
(revision dated 2025-02-26) covering unencumbered assets, the asset categories that make them
high-quality liquid assets (HQLA), and the LCR calculation of the HQLA amount.

**Source.** Transcribed from the Federal Reserve's PDF by the FINOS
[open-reg-tech-us-lcr](https://github.com/finos/open-reg-tech-us-lcr) project, commit
`4fdc68d`. The PDF remains authoritative; this is a convenience copy. Sections are copied
verbatim from:

- [I.A: Inflows-Assets](https://github.com/finos/open-reg-tech-us-lcr/blob/4fdc68d7b3d8e6735596f1898cbb9df4c1157f51/doc/fr2052a/03-product-definitions/I.A-inflows-assets.md): I.A.1
- [Field Definitions](https://github.com/finos/open-reg-tech-us-lcr/blob/4fdc68d7b3d8e6735596f1898cbb9df4c1157f51/doc/fr2052a/02-field-definitions.md): Collateral Class (a stray footnote from the PDF layout omitted), Market Value, Treasury Control
- [Appendix III: FR 2052a Asset Category Table](https://github.com/finos/open-reg-tech-us-lcr/blob/4fdc68d7b3d8e6735596f1898cbb9df4c1157f51/doc/fr2052a/04-appendices/III-asset-category-table.md): introduction and a representative selection of asset category codes (the full table lists many more)
- [Appendix VI: LCR to FR 2052a Mapping](https://github.com/finos/open-reg-tech-us-lcr/blob/4fdc68d7b3d8e6735596f1898cbb9df4c1157f51/doc/fr2052a/04-appendices/VI-lcr-mapping.md): Key, LCR Calculation, rule (1)

As a work of the United States government, the instructions are not subject to copyright
protection in the U.S. (17 U.S.C. § 105).

## I.A: Inflows-Assets

### I.A.1: Unencumbered Assets

Refers to assets that are owned outright that are (i) free of legal, regulatory, contractual, or
other restrictions on the ability of the reporting entity to monetize the assets; and (ii) not
pledged, explicitly or implicitly, to secure or to provide credit enhancement to any transaction.
Exclude all unencumbered assets that are pledged to a central bank or a U.S. government-
sponsored enterprise that meet the specifications of, and should be reported under, product
I.A.2: Capacity. Exclude transactions involving the purchase of securities that have been
executed, but not yet settled as those transactions should be reported in lines I.A.5: Unsettled
Asset Purchases or I.A.6: Forward Asset Purchases, depending on the timing of settlement. Any
amounts due to the reporting institution with respect to any associated hedges should not be
added or subtracted from the fair value of the asset. Include unencumbered loans and leases
even though these loans and leases must also be reported under the appropriate Inflows-
Unsecured and Inflows-Secured products. Do not exclude assets that are owned outright at a
subsidiary of the reporting entity, but have been pledged to secure a transaction with another
subsidiary of the reporting entity; to the extent these assets remain unencumbered.

## Field definitions

### Collateral Class

Use the asset category table in Appendix III to identify the type of collateral for all relevant
inflows, outflows, and informational items.

- For securities that have multiple credit risk profiles, report the transaction or asset based on the lowest quality.

- Use the standardized risk weightings as specified under subpart D of Regulation Q (12 CFR part 217).



- Work with supervisory teams to address questions on the categorization of specific assets.

### Market Value

This field is only applicable to the Inflows-Assets, Supplemental-Derivatives & Collateral,
Supplemental-LRM, Supplemental-Balance sheet and Supplemental-Informational tables.
Report the fair value under GAAP for each applicable data element.

- In general, report values according to the close-of-business marks on the as-of date. For loans that are accounted for on an accrual basis, report the most recent available fair valuation.

### Treasury Control

This field is only applicable to the Inflows-Assets, Inflows-Secured, Inflows-Other, Outflows-
Secured and Supplemental-Derivatives & Collateral tables. Use this field to flag (“Yes”) assets, or
transactions secured by assets that meet the operational requirements for eligible HQLA in the
LRM Standards other than the requirement to be unencumbered, which addresses: the
operational capability to monetize; policies that require control by the function of the bank
charged with managing liquidity risk; policies and procedures that determine the composition;
and not being client pool securities or designated to cover operational costs.

Do not set [Treasury Control]=”Yes” in the Secured-Inflows table where the collateral received
has been rehypothecated and pledged to secure a collateral swap where the collateral that
must be returned at the maturity of the swap transaction does not qualify as HQLA per the FR
2052a Asset Category Table (Appendix III).

## Appendix III: FR 2052a Asset Category Table

The `-Q` suffix indicates that assets meet all the asset-specific tests
detailed in section 20 of Regulation WW (e.g., risk profile and
market-based characteristics).

- **HQLA Level 1**
  - A-1-Q — Debt issued by the U.S. Treasury
  - A-2-Q — U.S. Government Agency-issued debt (excluding the US Treasury) with a US Government guarantee
  - S-1-Q — Debt issued by non-U.S. Sovereigns (excluding central banks) with a 0% RW
  - CB-1-Q — Securities issued or guaranteed by a central bank with a 0% RW
- **HQLA Level 2a**
  - G-1-Q — Senior to preferred debt issued by a U.S. Government Sponsored Entity (GSE)
  - G-2-Q — Vanilla debt (including pass-through MBS) guaranteed by a U.S. GSE
  - S-5-Q — Debt issued by non-U.S. Sovereigns (excluding central banks) with a 20% RW, not otherwise included
- **HQLA Level 2b**
  - E-1-Q — U.S. equities - Russell 1000
  - IG-1-Q — Investment grade corporate debt
  - IG-2-Q — Investment grade municipal obligations
- **Non-HQLA — Assets that do not meet the asset-specific tests detailed in section 20 of Regulation WW**
  - G-1 — Senior to preferred debt issued by a U.S. Government Sponsored Entity (GSE)
  - E-1 — U.S. equities - Russell 1000
- **Non-HQLA — Other**
  - E-3 — All other U.S.-listed common equity securities
  - IG-3 — Investment grade Vanilla ABS
  - Z-1 — All other assets

## Appendix VI: LCR to FR 2052a Mapping

### Key

| Symbol | Meaning |
|--------|---------|
| `*` | Values relevant to the LCR |
| `#` | Values not relevant to the LCR |
| `NULL` | Should not have an associated value |

### LCR Calculation

```
LCR = HQLA adjusted / Total Net Cash Outflows

HQLA adjusted = (Level 1 HQLA adjusted values - Level 1 HQLA haircut values)
    + .85 * (Level 2A HQLA adjusted values - Level 2A HQLA haircut values)
    + .5 * (Level 2B HQLA adjusted values - Level 2B HQLA haircut values)
    - MAX[ Unadjusted excess HQLA, Adjusted excess HQLA ]

Unadjusted excess HQLA = Level 2 cap excess amount + Level 2B cap excess amount

Level 2 cap excess amount = MAX[ 0,
    .85 * (Level 2A HQLA adjusted values - Level 2A HQLA haircut values)
    + .5 * (Level 2B HQLA adjusted values - Level 2B HQLA haircut values)
    - .6667 * (Level 1 HQLA adjusted values - Level 1 HQLA haircut values) ]

Level 2B cap excess amount = MAX[ 0,
    .5 * (Level 2B HQLA adjusted values - Level 2B HQLA haircut values)
    - Level 2 cap excess amount
    - .1765 * ( (Level 1 HQLA adjusted values - Level 1 HQLA haircut values)
        + .85 * (Level 2A HQLA adjusted values - Level 2A HQLA haircut values) ) ]

Adjusted level 1 HQLA adjusted values
    = Level 1 HQLA adjusted values + Secured lending unwind maturity amount
    - Secured lending unwind collateral value with Level 1 collateral class
    - Secured funding unwind maturity amount

Adjusted level 2A HQLA adjusted values
    = Level 2A HQLA adjusted values
    - Secured lending unwind collateral value with Level 2A collateral class
    + Secured funding unwind collateral value with Level 2A collateral class
    + Asset exchange unwind maturity amount with Level 2A security
    - Asset exchange unwind collateral value with Level 2A collateral class

Adjusted level 2B HQLA adjusted values
    = Level 2B HQLA adjusted values
    - Secured lending unwind collateral value with Level 2B collateral class
    + Secured funding unwind collateral value with Level 2B collateral class
    + Asset exchange unwind maturity amount with Level 2B security
    - Asset exchange unwind collateral value with Level 2B collateral class

Adjusted excess HQLA = Adjusted level 2 cap excess amount +
    Adjusted level 2B cap excess amount

Adjusted level 2 cap excess amount = MAX[ 0,
    .85 * (Adjusted level 2A HQLA adjusted values
        - Level 2A HQLA haircut values)
    + .5 * (Adjusted level 2B HQLA adjusted values
        - Level 2B HQLA haircut values)
    - .6667 * (Adjusted level 1 HQLA adjusted values
        - Level 1 HQLA haircut values) ]

Adjusted level 2B cap excess amount = MAX[ 0,
    .5 * (Adjusted level 2B HQLA adjusted values
        - Level 2B HQLA haircut values)
    - Adjusted level 2 cap excess amount
    - .1765 * ( (Adjusted level 1 HQLA adjusted values
        - Level 1 HQLA haircut values)
        + .85 * (Adjusted level 2A HQLA adjusted values
            - Level 2A HQLA haircut values) ) ]

Total Net Cash Outflows
    = Outflow Adjustment Percentage * [ Outflow values
        * Runoff or rate
        - MIN [ Inflow values
            * Runoff inflow rate, .75 * (Outflow values * Runoff or rate) ]
        + Maturity mismatch add on ]

Maturity mismatch add on
    = MAX [ 0, Largest net cumulative maturity outflow amount ]
    - MAX [ 0, Net day 30 cumulative maturity outflow amount ]

Largest net cumulative maturity outflow amount
    = MAX [
        SUM(n=1 to m) [
            (Outflow values corresponding to .32(g), (h)(1), (h)(2),
                (h)(5), (j), (k), and (l) with maturity bucket of n
                * Respective outflow rates)
            - (Inflow values corresponding to .33(c), (d), (e), and (f)
                with maturity bucket of n * Respective inflow rates)
        ]
        ∀ m ∈ {1, 2, …, 30}
    ]

Net day 30 cumulative maturity outflow amount
    = SUM(n=1 to 30) [
        (Outflow values corresponding to .32(g), (h)(1), (h)(2),
            (h)(5), (j), (k), and (l) with maturity bucket of n
            * Respective outflow rates)
        - (Inflow values corresponding to .33(c), (d), (e), and (f)
            with maturity bucket of n * Respective inflow rates)
    ]
```

[^1]: Refer to LCR Rule as defined as specified in section 10(c) of the LRM standards.
[^2]: For the maturity mismatch add-on, please note that Open maturity should still be reported in FR 2052a, and the LCR calculation will convert Open to day 1 pursuant to section 31(a)(4) of the LCR Rule.

### (1) High-Quality Liquid Assets (Subpart C, §.20-.22)

| Field | Value |
|-------|-------|
| Reporting Entity | LCR Firm |
| PID | I.A.1, 2, and 3 |
| Product | Matches PID |
| Sub‐Product | Not Currency and Coin |
| Market Value | * |
| Lendable Value | # |
| Maturity Bucket | Open for I.A.3, # otherwise |
| Forward Start Amount | NULL |
| Forward Start Bucket | NULL |
| Collateral Class | HQLA (except A‐0‐Q for I.A.2) |
| Treasury Control | Y |
| Accounting Designation | # |
| Encumbrance Type | NULL |
| Internal Counterparty | # |
