import F1040Attachment from './F1040Attachment'
import {
  CareProvider,
  FilingStatus,
  PersonRole,
  Dependent
} from 'ustaxes/core/data'
import { CURRENT_YEAR } from '../data/federal'
import { Field, FillInstructions, text, checkbox } from 'ustaxes/core/pdfFiller'
import { FormTag } from 'ustaxes/core/irsForms/Form'

/**
 * Credit percentage table for Form 2441 line 8 (unchanged from prior years,
 * not indexed for inflation). AGI thresholds are the lower bounds of each bracket.
 *
 * TODO: Move to federal, maybe? even if mostly unchaged?
 */
const CREDIT_RATE_TABLE: [number, number][] = [
  [0, 0.35],
  [15001, 0.34],
  [17001, 0.33],
  [19001, 0.32],
  [21001, 0.31],
  [23001, 0.3],
  [25001, 0.29],
  [27001, 0.28],
  [29001, 0.27],
  [31001, 0.26],
  [33001, 0.25],
  [35001, 0.24],
  [37001, 0.23],
  [39001, 0.22],
  [41001, 0.21],
  [43001, 0.2]
]

/** Maximum allowable expense per qualifying person for the credit. */
const EXPENSE_CAP_PER_PERSON = 3000

/** Maximum excludable employer-provided dependent care benefits. */
const EMPLOYER_BENEFIT_EXCLUSION = 5000

/**
 * Form 2441 — Child and Dependent Care Expenses.
 *
 * Produces two outputs:
 * - `taxableBenefits()`: employer-provided care includible in income (→ F1040 line 1e)
 * - `credit()`: nonrefundable care credit (→ Schedule 3 line 2)
 */
export default class F2441 extends F1040Attachment {
  tag: FormTag = 'f2441'
  sequenceIndex = 21

  private get dce() {
    return this.f1040.info.dependentCareExpenses
  }

  /** Total out-of-pocket qualifying expenses across all providers. */
  private get qualifyingExpensesTotal(): number {
    const providers = this.dce?.providers ?? []
    if (providers.length > 0) {
      return providers.reduce((sum, p) => sum + p.amountPaid, 0)
    }
    return this.dce?.totalExpenses ?? 0
  }

  isNeeded = (): boolean =>
    this.employerBenefits() > 0 || this.qualifyingExpensesTotal > 0

  /**
   * Qualifying persons for Form 2441 — dependents under age 13.
   * Form 2441 uses age < 13, not the CTC/EIC childMaxAge of 17.
   */
  get qualifyingChildren(): Dependent[] {
    return this.f1040.info.taxPayer.dependents.filter(
      (d) => CURRENT_YEAR - d.dateOfBirth.getFullYear() < 13
    )
  }

  /** Total employer-provided dependent care benefits across all W-2s. */
  employerBenefits = (): number =>
    this.f1040.info.w2s.reduce(
      (sum, w2) => sum + (w2.box10DependentCare ?? 0),
      0
    )

  /** Earned income of the primary taxpayer. */
  primaryEarnedIncome = (): number =>
    this.f1040.info.w2s
      .filter((w2) => w2.personRole === PersonRole.PRIMARY)
      .reduce((sum, w2) => sum + w2.income, 0) +
    (this.f1040.info.selfEmployedIncome
      ?.filter((s) => s.personRole === PersonRole.PRIMARY)
      .reduce((sum, s) => sum + Math.max(0, s.grossReceipts - s.expenses), 0) ??
      0)

  /** Earned income of the spouse. Returns undefined if no spouse. */
  spouseEarnedIncome = (): number | undefined => {
    const info = this.f1040.info
    if (info.taxPayer.filingStatus !== FilingStatus.MFJ) return undefined
    return (
      info.w2s
        .filter((w2) => w2.personRole === PersonRole.SPOUSE)
        .reduce((sum, w2) => sum + w2.income, 0) +
      (info.selfEmployedIncome
        ?.filter((s) => s.personRole === PersonRole.SPOUSE)
        .reduce(
          (sum, s) => sum + Math.max(0, s.grossReceipts - s.expenses),
          0
        ) ?? 0)
    )
  }

  /**
   * Maximum excludable employer-provided care benefits (Part III).
   * Capped at $5,000 ($2,500 MFS), also cannot exceed the lesser of
   * earned incomes or the benefit exclusion limit.
   */
  maxExclusion = (): number => {
    const fs = this.f1040.info.taxPayer.filingStatus
    const cap =
      fs === FilingStatus.MFS
        ? EMPLOYER_BENEFIT_EXCLUSION / 2
        : EMPLOYER_BENEFIT_EXCLUSION
    const primary = this.primaryEarnedIncome()
    const spouse = this.spouseEarnedIncome()
    const earnedIncomeLimit =
      spouse !== undefined ? Math.min(primary, spouse) : primary
    return Math.min(cap, earnedIncomeLimit)
  }

  /**
   * Line 26: taxable employer-provided dependent care benefits.
   * = employer benefits received − allowed exclusion.
   * Flows to F1040 line 1e as additional income.
   */
  taxableBenefits = (): number | undefined => {
    const benefits = this.employerBenefits()
    if (benefits <= 0) return undefined
    const taxable = Math.max(0, benefits - this.maxExclusion())
    return taxable > 0 ? taxable : undefined
  }

  /**
   * Part II line 3 value (= Part III line 31 when DCFSA is present).
   *
   * Per the 2025 Form 2441 Part III instructions:
   *   line 29 = cap − excluded DCFSA
   *   line 30 = out-of-pocket expenses (total − excluded)
   *   line 31 = min(line 29, line 30) → enters Part II line 3
   *
   * When no DCFSA: line 3 = min(totalExpenses, cap) directly.
   */
  private partIILine3 = (): number => {
    const totalExpenses = this.qualifyingExpensesTotal
    const qualifyingPersonCount = this.qualifyingChildren.length
    const expenseCap =
      qualifyingPersonCount >= 2
        ? EXPENSE_CAP_PER_PERSON * 2
        : EXPENSE_CAP_PER_PERSON
    const excluded = Math.min(this.employerBenefits(), this.maxExclusion())
    const outOfPocket = Math.max(0, totalExpenses - excluded)
    // Part III line 29: cap reduced by excluded DCFSA
    const remainingCap = Math.max(0, expenseCap - excluded)
    return Math.min(remainingCap, outOfPocket)
  }

  /**
   * Part II: nonrefundable Child and Dependent Care Credit.
   * Flows to Schedule 3 line 2.
   */
  credit = (): number | undefined => {
    const totalExpenses = this.qualifyingExpensesTotal
    if (totalExpenses <= 0) return undefined
    const qualifyingPersonCount = this.qualifyingChildren.length
    if (qualifyingPersonCount === 0) return undefined

    // Part II line 3: qualifying expenses after DCFSA offset and cap
    const line3 = this.partIILine3()

    const primary = this.primaryEarnedIncome()
    const spouse = this.spouseEarnedIncome()

    // Part II line 6: smallest of line 3, primary earned income, spouse earned income
    const line6 =
      spouse !== undefined
        ? Math.min(line3, primary, spouse)
        : Math.min(line3, primary)

    const qualifyingExpenses = line6
    if (qualifyingExpenses <= 0) return undefined

    const agi = this.f1040.l11b()
    const rate =
      CREDIT_RATE_TABLE.slice()
        .reverse()
        .find(([threshold]) => agi >= threshold)?.[1] ?? 0.2

    const creditAmount = Math.round(qualifyingExpenses * rate)
    return creditAmount > 0 ? creditAmount : undefined
  }

  fields = (): Field[] =>
    this.fillInstructions().map((instr) => {
      if (instr.kind === 'text')
        return instr.value === undefined ? '' : instr.value
      return instr.value
    })

  // Generated from Y2025 PDF schema (schemas/Y2025/f2441.json) — 72 fields total
  fillInstructions = (): FillInstructions => {
    const dce = this.dce
    const qc = this.qualifyingChildren
    const employerBenefits = this.employerBenefits()
    const maxExcl = this.maxExclusion()
    const providers = dce?.providers ?? []
    const depExpenses = dce?.dependentExpenses ?? []

    // Look up a qualifying child's expense by SSN, not by array index.
    // depExpenses covers ALL dependents; qc covers only those under 13.
    // Without SSN matching they can diverge when older siblings are listed first.
    const expenseForChild = (
      child: Dependent | undefined
    ): number | undefined => {
      if (child === undefined) return undefined
      const entry = depExpenses.find((e) => e.ssid === child.ssid)
      return entry && entry.amount > 0 ? entry.amount : undefined
    }

    // Helper: returns the SSN/EIN checkbox value for a provider slot.
    // Cast is required because noUncheckedIndexedAccess is off, so TypeScript
    // types providers[n] as CareProvider (not CareProvider | undefined).
    const providerTidBox = (
      idx: number,
      type: 'SSN' | 'EIN'
    ): boolean | undefined => {
      const p = providers[idx] as CareProvider | undefined
      return p !== undefined ? p.taxIdType === type : undefined
    }

    const totalExpenses = this.qualifyingExpensesTotal
    const qualifyingPersonCount = this.qualifyingChildren.length

    // Part II:
    // Line 3 = Part III line 31 when DCFSA present; else min(total, cap)
    const pIILine3 = this.partIILine3()
    // Line 4 = primary earned income
    const pIILine4 = this.primaryEarnedIncome()
    // Line 5 = spouse earned income (same as line 4 if not MFJ)
    const spouseIncome = this.spouseEarnedIncome()
    const pIILine5 = spouseIncome ?? pIILine4
    // Line 6 = min(3, 4, 5)
    const pIILine6 = Math.min(pIILine3, pIILine4, pIILine5)
    // Line 7 = AGI
    const pIILine7 = this.f1040.l11b()
    // Line 8 = credit rate (as integer percentage, maxLength=2 field)
    const rate =
      CREDIT_RATE_TABLE.slice()
        .reverse()
        .find(([threshold]) => pIILine7 >= threshold)?.[1] ?? 0.2
    // Line 9 = line 6 × rate
    const pIILine9 = Math.round(pIILine6 * rate)

    // Part III: excluded DCFSA benefits (used in multiple lines)
    const excludedBenefits = Math.min(employerBenefits, maxExcl)

    const primaryPerson = this.f1040.info.taxPayer.primaryPerson

    return [
      // 0: taxpayer name
      text(
        'topmostSubform[0].Page1[0].f1_1[0]',
        `${primaryPerson.firstName} ${primaryPerson.lastName}`
      ),
      // 1: taxpayer SSN
      text('topmostSubform[0].Page1[0].f1_2[0]', primaryPerson.ssid),
      // 2-3: unknown checkboxes
      checkbox('topmostSubform[0].Page1[0].c1_1[0]', undefined),
      checkbox('topmostSubform[0].Page1[0].c1_2[0]', undefined),
      // 4: Part I tax-exempt provider checkbox
      checkbox('topmostSubform[0].Page1[0].PartI[0].c1_3[0]', undefined),

      // Part I provider table — 3 rows
      // Row 1 — provider 0 (indices 5-10)
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow1[0].f1_3[0]',
        providers[0]?.name
      ),
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow1[0].ColB[0].f1_4[0]',
        undefined
      ),
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow1[0].f1_5[0]',
        providers[0]?.taxId
      ),
      checkbox(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow1[0].ColD[0].c1_4[0]',
        providerTidBox(0, 'SSN')
      ),
      checkbox(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow1[0].ColD[0].c1_4[1]',
        providerTidBox(0, 'EIN')
      ),
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow1[0].f1_6[0]',
        providers[0]?.amountPaid
      ),
      // Row 2 — provider 1 (indices 11-16)
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow2[0].f1_7[0]',
        providers[1]?.name
      ),
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow2[0].ColB[0].f1_8[0]',
        undefined
      ),
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow2[0].f1_9[0]',
        providers[1]?.taxId
      ),
      checkbox(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow2[0].ColD[0].c1_5[0]',
        providerTidBox(1, 'SSN')
      ),
      checkbox(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow2[0].ColD[0].c1_5[1]',
        providerTidBox(1, 'EIN')
      ),
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow2[0].f1_10[0]',
        providers[1]?.amountPaid
      ),
      // Row 3 — provider 2 (indices 17-22)
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow3[0].f1_11[0]',
        providers[2]?.name
      ),
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow3[0].ColB[0].f1_12[0]',
        undefined
      ),
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow3[0].f1_13[0]',
        providers[2]?.taxId
      ),
      checkbox(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow3[0].ColD[0].c1_6[0]',
        providerTidBox(2, 'SSN')
      ),
      checkbox(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow3[0].ColD[0].c1_6[1]',
        providerTidBox(2, 'EIN')
      ),
      text(
        'topmostSubform[0].Page1[0].PartITable[0].BodyRow3[0].f1_14[0]',
        providers[2]?.amountPaid
      ),

      // 23: additional providers checkbox
      checkbox('topmostSubform[0].Page1[0].c1_7[0]', undefined),

      // Part II qualifying persons table — 3 rows (indices 24-38)
      // Row 1
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row1[0].f1_15[0]',
        qc[0]?.firstName
      ),
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row1[0].f1_16[0]',
        qc[0]?.lastName
      ),
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row1[0].f1_17[0]',
        qc[0]?.ssid
      ),
      checkbox(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row1[0].c1_8[0]',
        (qc[0] as Dependent | undefined) !== undefined
      ),
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row1[0].f1_18[0]',
        expenseForChild(qc[0] as Dependent | undefined)
      ),
      // Row 2
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row2[0].f1_19[0]',
        qc[1]?.firstName
      ),
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row2[0].f1_20[0]',
        qc[1]?.lastName
      ),
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row2[0].f1_21[0]',
        qc[1]?.ssid
      ),
      checkbox(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row2[0].c1_9[0]',
        (qc[1] as Dependent | undefined) !== undefined
      ),
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row2[0].f1_22[0]',
        expenseForChild(qc[1] as Dependent | undefined)
      ),
      // Row 3
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row3[0].f1_23[0]',
        qc[2]?.firstName
      ),
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row3[0].f1_24[0]',
        qc[2]?.lastName
      ),
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row3[0].f1_25[0]',
        qc[2]?.ssid
      ),
      checkbox(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row3[0].c1_10[0]',
        (qc[2] as Dependent | undefined) !== undefined
      ),
      text(
        'topmostSubform[0].Page1[0].Table_Line2[0].Row3[0].f1_26[0]',
        expenseForChild(qc[2] as Dependent | undefined)
      ),

      // Part II calculation lines (indices 39-49)
      // f1_27 (39): Line 3 — capped qualifying expenses (Part III line 31 if DCFSA)
      text(
        'topmostSubform[0].Page1[0].f1_27[0]',
        pIILine3 > 0 ? pIILine3 : undefined
      ),
      // f1_28 (40): Line 4 — primary earned income
      text(
        'topmostSubform[0].Page1[0].f1_28[0]',
        pIILine4 > 0 ? pIILine4 : undefined
      ),
      // f1_29 (41): Line 5 — spouse earned income (or same as line 4)
      text(
        'topmostSubform[0].Page1[0].f1_29[0]',
        pIILine5 > 0 ? pIILine5 : undefined
      ),
      // f1_30 (42): Line 6 — smallest of lines 3, 4, 5
      text(
        'topmostSubform[0].Page1[0].f1_30[0]',
        pIILine6 > 0 ? pIILine6 : undefined
      ),
      // f1_31 (43): Line 7 — AGI (no maxLength field)
      text('topmostSubform[0].Page1[0].f1_31[0]', pIILine7),
      // f1_32 (44): Line 8 — credit rate as integer percentage (maxLength=2)
      text(
        'topmostSubform[0].Page1[0].f1_32[0]',
        Math.round(rate * 100).toString()
      ),
      // f1_33 (45): Line 9 — line 6 × rate
      text(
        'topmostSubform[0].Page1[0].f1_33[0]',
        pIILine9 > 0 ? pIILine9 : undefined
      ),
      // f1_34 (46): Line 10 — tax liability limit (F1040 line 18 as approximation)
      text('topmostSubform[0].Page1[0].f1_34[0]', this.f1040.l18()),
      // f1_35 (47): Line 11 — credit (smaller of line 9 or 10)
      text('topmostSubform[0].Page1[0].f1_35[0]', this.credit()),
      // f1_36 (48): unknown extra field
      text('topmostSubform[0].Page1[0].f1_36[0]', undefined),
      // f1_37 (49): unknown extra field
      text('topmostSubform[0].Page1[0].f1_37[0]', undefined),

      // Page 2, Part III — Dependent Care Benefits (indices 50-71)
      // Only completed when employer-provided benefits (W-2 Box 10) exist.

      // Line 12: Total employer-provided benefits (W-2 Box 10)
      text(
        'topmostSubform[0].Page2[0].f2_1[0]',
        employerBenefits > 0 ? employerBenefits : undefined
      ),
      // Line 13: Prior-year carryover (grace period) — not applicable
      text('topmostSubform[0].Page2[0].f2_2[0]', undefined),
      // Line 14: Amounts forfeited or carried forward to 2026 — none
      text('topmostSubform[0].Page2[0].f2_3[0]', undefined),
      // Line 15: Combine lines 12–14 = employerBenefits + 0 − 0
      text(
        'topmostSubform[0].Page2[0].f2_4[0]',
        employerBenefits > 0 ? employerBenefits : undefined
      ),
      // Line 16: Total qualified care expenses incurred in 2025
      text(
        'topmostSubform[0].Page2[0].Line16_ReadOrder[0].f2_5[0]',
        totalExpenses > 0 ? totalExpenses : undefined
      ),
      // Line 17: Smaller of line 15 or 16
      text(
        'topmostSubform[0].Page2[0].f2_6[0]',
        Math.min(employerBenefits, totalExpenses) > 0
          ? Math.min(employerBenefits, totalExpenses)
          : undefined
      ),
      // Line 18: Primary taxpayer earned income
      text(
        'topmostSubform[0].Page2[0].f2_7[0]',
        this.primaryEarnedIncome() > 0 ? this.primaryEarnedIncome() : undefined
      ),
      // Line 19: Spouse earned income (or same as line 18 if not MFJ)
      text(
        'topmostSubform[0].Page2[0].f2_8[0]',
        this.spouseEarnedIncome() ?? this.primaryEarnedIncome() > 0
          ? this.spouseEarnedIncome() ?? this.primaryEarnedIncome()
          : undefined
      ),
      // Line 20: Smallest of lines 17, 18, 19 = maxExclusion
      text(
        'topmostSubform[0].Page2[0].f2_9[0]',
        maxExcl > 0 ? maxExcl : undefined
      ),
      // Line 21: $5,000 ($2,500 if MFS) — statutory annual exclusion cap
      text(
        'topmostSubform[0].Page2[0].f2_10[0]',
        this.f1040.info.taxPayer.filingStatus === FilingStatus.MFS
          ? EMPLOYER_BENEFIT_EXCLUSION / 2
          : EMPLOYER_BENEFIT_EXCLUSION
      ),
      // Line 22: Is any of line 12 from self-employment? No for W-2 employees.
      checkbox(
        'topmostSubform[0].Page2[0].c2_1[0]',
        employerBenefits > 0 ? true : undefined
      ), // No checkbox
      checkbox('topmostSubform[0].Page2[0].c2_1[1]', undefined), // Yes checkbox
      text('topmostSubform[0].Page2[0].f2_11[0]', undefined), // Line 22 amount = 0 (No)
      // Line 23: Line 15 − Line 22 = employerBenefits − 0 = employerBenefits
      text(
        'topmostSubform[0].Page2[0].f2_12[0]',
        employerBenefits > 0 ? employerBenefits : undefined
      ),
      // Line 24: Deductible benefits = smallest of 20, 21, 22 = 0 for W-2 employees (line 22 = 0)
      text('topmostSubform[0].Page2[0].f2_13[0]', undefined),
      // Line 25: Excluded benefits = smaller of line 20 or 21 (since line 22 = No)
      text(
        'topmostSubform[0].Page2[0].f2_14[0]',
        excludedBenefits > 0 ? excludedBenefits : undefined
      ),
      // Line 26: Taxable benefits = line 23 − line 25 → F1040 line 1e
      text('topmostSubform[0].Page2[0].f2_15[0]', this.taxableBenefits()),
      // Line 27: $3,000 or $6,000 (credit expense cap)
      text(
        'topmostSubform[0].Page2[0].f2_16[0]',
        qualifyingPersonCount >= 2
          ? EXPENSE_CAP_PER_PERSON * 2
          : EXPENSE_CAP_PER_PERSON
      ),
      // Line 28: Add lines 24 and 25 = 0 + excludedBenefits = excludedBenefits
      text(
        'topmostSubform[0].Page2[0].f2_17[0]',
        excludedBenefits > 0 ? excludedBenefits : undefined
      ),
      // Line 29: Subtract line 28 from line 27 = remaining cap for credit
      text(
        'topmostSubform[0].Page2[0].f2_18[0]',
        Math.max(
          0,
          (qualifyingPersonCount >= 2
            ? EXPENSE_CAP_PER_PERSON * 2
            : EXPENSE_CAP_PER_PERSON) - excludedBenefits
        ) > 0
          ? Math.max(
              0,
              (qualifyingPersonCount >= 2
                ? EXPENSE_CAP_PER_PERSON * 2
                : EXPENSE_CAP_PER_PERSON) - excludedBenefits
            )
          : undefined
      ),
      // Line 30: Out-of-pocket expenses (column d total, excluding line 28 DCFSA benefits)
      text(
        'topmostSubform[0].Page2[0].f2_19[0]',
        Math.max(0, totalExpenses - excludedBenefits) > 0
          ? Math.max(0, totalExpenses - excludedBenefits)
          : undefined
      ),
      // Line 31: Smaller of line 29 or 30 → enters Part II line 3
      text(
        'topmostSubform[0].Page2[0].f2_20[0]',
        pIILine3 > 0 ? pIILine3 : undefined
      )
    ]
  }
}
