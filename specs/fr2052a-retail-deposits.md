# FR 2052a: Retail Deposits and LCR Outflow Rules (excerpt)

An excerpt of the FR 2052a Complex Institution Liquidity Monitoring Report instructions
(revision dated 2025-02-26) covering retail and small-business deposits and the LCR rules
(10) to (14) that apply to them.

**Source.** Transcribed from the Federal Reserve's PDF by the FINOS
[open-reg-tech-us-lcr](https://github.com/finos/open-reg-tech-us-lcr) project, commit
`4fdc68d`. The PDF remains authoritative; this is a convenience copy. Sections are copied
verbatim from:

- [O.D: Outflows-Deposits](https://github.com/finos/open-reg-tech-us-lcr/blob/4fdc68d7b3d8e6735596f1898cbb9df4c1157f51/doc/fr2052a/03-product-definitions/O.D-outflows-deposits.md): introduction, O.D.1, O.D.2, O.D.3, O.D.14, O.D.15
- [Field Definitions](https://github.com/finos/open-reg-tech-us-lcr/blob/4fdc68d7b3d8e6735596f1898cbb9df4c1157f51/doc/fr2052a/02-field-definitions.md): Counterparty, Insured, Maturity Amount
- [Appendix VI: LCR to FR 2052a Mapping](https://github.com/finos/open-reg-tech-us-lcr/blob/4fdc68d7b3d8e6735596f1898cbb9df4c1157f51/doc/fr2052a/04-appendices/VI-lcr-mapping.md): Key, rules (10) to (14)

As a work of the United States government, the instructions are not subject to copyright
protection in the U.S. (17 U.S.C. § 105).

## O.D: Outflows-Deposits

Collateralized Deposits has the same meaning as it does under the LRM Standards.

For collateralized deposits, report the type of collateral using the [Collateral Class] field using
the asset categories listed in the Asset Category Table (Appendix III). Report the fair value of
collateral held against these deposits using the [Collateral Value] field.

Insured Deposits: Use the [Insured] field to distinguish between balances that are FDIC-insured,
foreign deposits insured by a non-US local-jurisdiction government insurance system, and
uninsured deposits as described in the field definitions section.

- FDIC

- Other
- Uninsured

Instructions on reporting by counterparty: Deposit products must be reported by the type of
counterparty that made the deposit. Certain deposit products apply only to a subset of
counterparty types. The lists of reportable counterparty types are identified by product in the
following section.

- Retail
- Small Business
- Non-Financial Corporate
- Sovereign
- Central Bank
- GSE
- PSE
- MDB
- Other Supranational
- Pension Fund
- Bank
- Broker-Dealer
- Investment Company or Advisor
- Financial Market Utility
- Other Supervised Non-Bank Financial Entity
- Debt Issuing SPE
- Non-Regulated Fund
- Other

The following list defines the scope of products to be reported in the Outflows-Deposits table:

### O.D.1: Transactional Accounts

For purposes of this report, the term "Transactional Accounts" includes demand deposits as
defined under Regulation D 12 CFR section 204 (Reserve Requirements of Depository
Institutions); however this product only includes demand deposits placed by Retail and Small
Business customers.

### O.D.2: Non-Transactional Relationship Accounts

Refers to Retail and Small Business deposits in accounts that are not transactional accounts
under O.D.1, but where the underlying depositors have other established relationships with the
reporting entity such as another deposit account, a loan, bill payment services, or any similar

service or product provided to the depositor that the reporting entity has demonstrated to the
satisfaction of the supervisory team would make deposit withdrawal highly unlikely during a
liquidity stress event. Do not report brokered, sweep or reciprocal deposits using this product,
as they should be reported using products O.D.8 through O.D.13.

### O.D.3: Non-Transactional Non-Relationship Accounts

Refers to Retail and Small Business deposits in accounts that are not transactional accounts
under O.D.1 where the underlying depositors do not have other established relationships with
the reporting entity that would otherwise make deposit withdrawal highly unlikely. Do not
report brokered, sweep or reciprocal deposits using this product, as they should be reported
using products O.D.8 through O.D.13.

### O.D.14: Other Third-Party Deposits

Refers to deposit accounts that are placed by a third party on behalf of counterparties that do
not otherwise meet the definitions of O.D.8 through O.D.12. Use the comments table to
provide a general description of deposits included in this product on at least a monthly basis
and in the event of a material change in reported values.

### O.D.15: Other Accounts

Refers to other deposit accounts that do not meet any of the definitions outlined above.
Examples include but are not limited to cashier’s checks, money orders, other official checks,
merchant credits, and lock box. Notify the supervisory team of any balance reported in this
category. Use the comments table to provide a general description of other deposits
included in this product on at least a monthly basis and in the event of a material change in
reported values.

## Field definitions

### Counterparty

The following counterparty types are used across all tables except the Inflow-Assets,
Supplemental-Informational, and Comment tables.8 The definitions for these types should align
with the classification of the legal counterparty to a given exposure and not the counterparty’s
ultimate parent; however two product-specific exceptions to this approach are detailed below
in the definitions of the Debt Issuing SPE and Bank counterparty types.

- Retail Refers to a counterparty who is a natural person. Retail includes a living or testamentary trust that is solely for the benefit of natural persons, does not have a corporate trustee, and terminates within 21 years and 10 months after the death of grantors or beneficiaries of the trust living on the effective date of the trust or within 25 years, if applicable under state law. Retail does not include other legal entities, sole proprietorships, or partnerships. Other legal entities, proprietorships and partnerships should be reported, as appropriate, in one of the sub-products as defined below.

- Small Business Refers to entities managed as retail exposures that exhibit the same liquidity risk characteristics as retail customers. The total aggregate funding raised from these entities should not exceed $1.5 million from the perspective of the consolidated

8 This listing does not include “Municipalities for VRDNs”, which is applicable only to O.O.5: Liquidity Facilities and
is defined in that section.

    reporting entity. Under circumstances where small business entities are affiliated, the
    $1.5 million threshold should be assessed against the aggregate funding exposures of
    the affiliated group.

- Non-Financial Corporate Refers to commercial entities that are not owned by central governments, local governments or local authorities with revenue-raising powers, and that are non- financial in nature (i.e., do not meet the definition of Pension Fund, Bank, Broker-Dealer, Investment Company or Advisor, Financial Market Utility, Other Supervised Non-Bank Financial Entity, or Non-Regulated Fund as identified in the sections below).

- Sovereign Refers to a central government or an agency, department or ministry.

- Central Bank Refers to a bank responsible for implementing its jurisdiction’s monetary policy.

- Government Sponsored Entity (GSE) Refers to entities established or chartered by the Federal government to serve public purposes specified by the United States Congress, but whose debt obligations are not explicitly guaranteed by the full faith and credit of the United States government.

- Public Sector Entity (PSE) Refers to a state, local authority, or other governmental subdivision below the sovereign level.

- Multilateral Development Bank (MDB) Refers to the International Bank for Reconstruction and Development, the Multilateral Investment Guarantee Agency, the International Finance Corporation, the Inter- American Development Bank, the Asian Development Bank, the African Development Bank, the European Bank for Reconstruction and Development, the European Investment Bank, the European Investment Fund, the Nordic Investment Bank, the Caribbean Development Bank, the Islamic Development Bank, the Council of Europe Development Bank, and any other entity that provides financing for national or regional development in which the U.S. government is a shareholder or contributing member or which the appropriate Federal banking agency determines poses comparable risk.

- Other Supranational International or regional organizations or subordinate or affiliated agencies thereof, created by treaty or convention between sovereign states that are not multilateral development banks, including the International Monetary Fund, the Bank for International Settlements, and the United Nations.

- Pension Fund Refers to an employee benefit plan as defined in paragraphs (3) and (32) of section 3 of the Employee Retirement Income and Security Act of 1974 (29 U.S.C. 1001 et seq.), a “governmental plan” (as defined in 29 U.S.C. 1002(32)) that complies with the tax deferral qualification requirements provided in the Internal Revenue Code, or any similar employee benefit plan established under the laws of a foreign jurisdiction.

- Bank Refers to a depository institution; bank holding company or savings and loan holding company; foreign bank; credit union; industrial loan company, industrial bank, or other similar institution described in section 2 of the Bank Holding Company Act of 1956, as amended (12 U.S.C. 1841 et seq.); national bank, state member bank, or state non- member bank that is not a depository institution. This term does not include non-bank financial entities that have an affiliated banking entity, except for exposures reported in the Outflows-Other table under products O.O.4: Credit Facilities and O.O.5: Liquidity Facilities. Any company that is not a bank but is included in the organization chart of a bank holding company or savings and loan holding company on the Form FR Y-6, as listed in the hierarchy report of the bank holding company or savings and loan holding company produced by the National Information Center (NIC) Web site, must be designated as a Bank for products O.O.4 and O.O.5. This term does not include bridge financial companies as defined in 12 U.S.C. 5381(a)(3), or new depository institutions or bridge depository institutions as defined in 12 U.S.C. 1813(i).

- Broker-Dealer Refers to a securities holding company as defined in section 618 of the Dodd-Frank Act (12 U.S.C. 1850a); broker or dealer registered with the SEC under section 15 of the Securities Exchange Act (15 U.S.C. 78o); futures commission merchant as defined in section 1a of the Commodity Exchange Act of 1936 (7 U.S.C. 1 et seq.); swap dealer as defined in section 1a of the Commodity Exchange Act (7 U.S.C. 1a); security-based swap dealer as defined in section 3 of the Securities Exchange Act (15 U.S.C. 78c); or any company not domiciled in the United States (or a political subdivision thereof) that is

    supervised and regulated in a manner similar to these entities.

- Investment Company or Advisor Refers to a person or company registered with the SEC under the Investment Company Act of 1940 (15 U.S.C. 80a-1 et seq.); a company registered with the SEC as an investment adviser under the Investment Advisers Act of 1940 (15 U.S.C. 80b-1 et seq.); or foreign equivalents of such persons or companies. An investment company or advisor does not include small business investment companies, as defined in section 102 of the Small Business Investment Act of 1958 (15 U.S.C. 661 et seq.).

- Financial Market Utility Refers to a designated financial market utility, as defined in section 803 of the Dodd- Frank Act (12 U.S.C. 5462) and any company not domiciled in the United States (or a political subdivision thereof) that is supervised and regulated in a similar manner.

- Other Supervised Non-Bank Financial Entity (1) A company that the Financial Stability Oversight Council has determined under section 113 of the Dodd-Frank Act (12 U.S.C. 5323) shall be supervised by the Board of Governors of the Federal Reserve System and for which such determination is still in effect; (2) A company that is not a bank, broker-dealer, investment company or advisor or financial market utility, but is included in the organization chart of a bank holding company or savings and loan holding company on the Form FR Y-6, as listed in the hierarchy report of the bank holding company or savings and loan holding company produced by the National Information Center (NIC) Web site; (3) An insurance company; and (4) Any company not domiciled in the United States (or a political subdivision thereof) that is supervised and regulated in a manner similar to entities described in paragraphs (1) through (3) of this definition (e.g., a non-bank subsidiary of a foreign banking organization, foreign insurance company, etc.). (5) A supervised non-bank financial entity does not include: a. U.S. government-sponsored enterprises; b. Entities designated as Community Development Financial Institutions (CDFIs) under 12 U.S.C. 4701 et seq. and 12 CFR part 1805; or c. Central banks, the Bank for International Settlements, the International Monetary Fund, or multilateral development banks.

- Debt Issuing Special Purpose Entity (SPE) Refers to an SPE9 that issues or has issued commercial paper or securities (other than equity securities issued to a company of which the SPE is a consolidated subsidiary) to finance its purchases or operations. This counterparty type should only be used to identify stand-alone SPEs that issue debt and are not consolidated on an affiliated entity’s balance sheet for purposes of financial reporting, except for exposures reported in the Outflows-Other table under products O.O.4: Credit Facilities and O.O.5: Liquidity Facilities. All debt issuing SPEs should be identified as Debt Issuing SPEs for products O.O.4 and O.O.5, regardless of whether they are consolidated by an affiliate for financial reporting.

- Non-Regulated Fund Refers to a hedge fund or private equity fund whose investment advisor is required to file SEC Form PF (Reporting Form for Investment Advisers to Private Funds and Certain Commodity Pool Operators and Commodity Trading Advisors), other than a small business investment company as defined in section 102 of the Small Business Investment Act of 1958 (15 U.S.C. 661 et seq.)).

- Other Refers to any counterparty that does not fall into any of the above categories. Consult with your supervisory team before reporting balances using this counterparty type. Use the comments table to provide description of the counterparty on at least a monthly basis and in the event of a material change in reported values.

### Insured

This field is only applicable to the Outflows-Deposits table. Use this field to identify
balances that are fully insured by the FDIC or other foreign government-sponsored deposit
insurance systems.

- FDIC Refers to deposits fully insured by FDIC deposit insurance.

- Other Refers to deposits that are fully insured by non-US local-jurisdiction government deposit insurance.

- Uninsured Refers to deposits that are not fully insured by FDIC deposit insurance or other non- US local-jurisdiction government deposit insurance.

### Maturity Amount

Report the notional amount contractually due to be paid or received at maturity for each data
element.

- All notional currency-denominated values should be reported in millions (e.g., U.S. dollar-denominated transactions in USD millions, sterling-denominated transactions in GBP millions).

- This amount represents the aggregate balance of trades, positions or accounts that share common data characteristics (i.e., common non-numerical field values). If the aggregate amount rounds to less than ten thousand currency units (i.e., 0.01 for this report), the record should not be reported. o Example: The banking entity has corporate customers with a total of $2.25 billion in operational and non-operational deposits, of which:
- $1 billion is operational and fully FDIC insured with an open maturity;
- $500 million is non-operational uninsured with an open maturity; and
- $750 million is non-operational uninsured maturing on calendar day 5. o Table 1 below illustrates how the total operational and non-operational corporate deposit balance should be disaggregated and reported across these three distinct combinations of fields in the deposit table (O.D).

                            Table 1 – Example: maturity amount aggregation

## Appendix VI: LCR to FR 2052a Mapping

### Key

| Symbol | Meaning |
|--------|---------|
| `*` | Values relevant to the LCR |
| `#` | Values not relevant to the LCR |
| `NULL` | Should not have an associated value |

### (10) Stable Retail Deposits (§.32(a)(1))

| Field | Value |
|-------|-------|
| Reporting Entity | LCR Firm |
| PID | O.D.1 and 2 |
| Product | Matches PID |
| Counterparty | Retail or Small Business |
| G‐SIB | # |
| Maturity Amount | * |
| Maturity Bucket | # |
| Maturity Optionality | # |
| Collateral Class | # |
| Collateral Value | # |
| Insured | FDIC |
| Trigger | # |
| Rehypothecated | # |
| Business Line | # |
| Internal | # |
| Internal Counterparty | # |

### (11) Other Retail Deposits (§.32(a)(2))

| Field | Value |
|-------|-------|
| Reporting Entity | LCR Firm |
| PID | O.D.1, 2, and 3 |
| Product | Matches PID |
| Counterparty | Retail or Small Business |
| G‐SIB | # |
| Maturity Amount | * |
| Maturity Bucket | # |
| Maturity Optionality | # |
| Collateral Class | # |
| Collateral Value | # |
| Insured | Not FDIC for PID = 1 and 2, and # for PID = 3 |
| Trigger | # |
| Rehypothecated | # |
| Business Line | # |
| Internal | # |
| Internal Counterparty | # |

### (12) Insured Placed Retail Deposits (§.32(a)(3))

| Field | Value |
|-------|-------|
| Reporting Entity | LCR Firm |
| PID | O.D.14 |
| Product | Matches PID |
| Counterparty | Retail or Small Business |
| G‐SIB | # |
| Maturity Amount | * |
| Maturity Bucket | # |
| Maturity Optionality | # |
| Collateral Class | # |
| Collateral Value | # |
| Insured | FDIC |
| Trigger | # |
| Rehypothecated | # |
| Business Line | # |
| Internal | # |
| Internal Counterparty | # |

### (13) Non-Insured Placed Retail Deposits (§.32(a)(4))

| Field | Value |
|-------|-------|
| Reporting Entity | LCR Firm |
| PID | O.D.14 |
| Product | Matches PID |
| Counterparty | Retail or Small Business |
| G‐SIB | # |
| Maturity Amount | * |
| Maturity Bucket | # |
| Maturity Optionality | # |
| Collateral Class | # |
| Collateral Value | # |
| Insured | Not FDIC |
| Trigger | # |
| Rehypothecated | # |
| Business Line | # |
| Internal | # |
| Internal Counterparty | # |

### (14) Other Retail Funding (§.32(a)(5))

| Field | Value |
|-------|-------|
| Reporting Entity | LCR Firm |
| PID | O.D.15 |
| Product | Matches PID |
| Counterparty | Retail or Small Business |
| G‐SIB | # |
| Maturity Amount | * |
| Maturity Bucket | # |
| Maturity Optionality | # |
| Collateral Class | # |
| Collateral Value | # |
| Insured | # |
| Trigger | # |
| Rehypothecated | # |
| Business Line | # |
| Internal | # |
| Internal Counterparty | # |
