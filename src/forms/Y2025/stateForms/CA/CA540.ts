import Form, { FormMethods } from 'ustaxes/core/stateForms/Form'
import { FilingStatus, State } from 'ustaxes/core/data'
import { Field } from 'ustaxes/core/pdfFiller'
import F1040 from 'ustaxes/forms/Y2025/irsForms/F1040'
import { ValidatedInformation } from 'ustaxes/forms/F1040Base'
import CA540V from './CA540V'
import caParameters, { computeCATax } from './Parameters'

export default class CA540 extends Form {
  readonly state: State = 'CA'
  readonly formName = '540'
  readonly formOrder = 0

  readonly info: ValidatedInformation
  private readonly f1040: F1040
  private readonly methods: FormMethods

  constructor(f1040: F1040) {
    super()
    this.f1040 = f1040
    this.info = f1040.info
    this.methods = new FormMethods(this)
  }

  attachments = (): Form[] =>
    this.balanceDue() > 0 ? [new CA540V(this.f1040, this)] : []

  // ── Income ──────────────────────────────────────────────────────────────

  /** CA wages from W-2 box 16, CA state W-2s only. */
  caWages = (): number =>
    this.methods.stateW2s().reduce((sum, w2) => sum + (w2.stateWages ?? 0), 0)

  /**
   * CA AGI = Federal AGI minus Social Security income taxable federally
   * (CA does not tax SS benefits).
   */
  caAGI = (): number => Math.max(0, this.f1040.l11b() - (this.f1040.l6b() ?? 0))

  // ── Deductions ───────────────────────────────────────────────────────────

  /** CA standard deduction by filing status. */
  caStandardDeduction = (): number =>
    caParameters.standardDeduction[
      this.info.taxPayer.filingStatus ?? FilingStatus.S
    ]

  /** CA taxable income after standard deduction. */
  caTaxableIncome = (): number =>
    Math.max(0, this.caAGI() - this.caStandardDeduction())

  // ── Tax ──────────────────────────────────────────────────────────────────

  caTax = (): number =>
    computeCATax(
      this.info.taxPayer.filingStatus ?? FilingStatus.S,
      this.caTaxableIncome()
    )

  // ── Exemption Credits (dollar-for-dollar, not deductions) ────────────────

  personalExemptionCredit = (): number =>
    caParameters.personalExemptionCredit[
      this.info.taxPayer.filingStatus ?? FilingStatus.S
    ]

  dependentExemptionCredit = (): number =>
    this.info.taxPayer.dependents.length * caParameters.dependentExemptionCredit

  primarySenior = (): boolean =>
    this.info.taxPayer.primaryPerson.dateOfBirth < new Date(1961, 0, 1)

  spouseSenior = (): boolean =>
    (this.info.taxPayer.spouse?.dateOfBirth ?? new Date()) <
    new Date(1961, 0, 1)

  seniorExemptionCredit = (): number =>
    [this.primarySenior(), this.spouseSenior()].filter(Boolean).length *
    caParameters.seniorExemptionCredit

  totalExemptionCredits = (): number =>
    this.personalExemptionCredit() +
    this.dependentExemptionCredit() +
    this.seniorExemptionCredit()

  // ── Renter's Credit ───────────────────────────────────────────────────────

  rentersCredit = (): number => {
    const fs = this.info.taxPayer.filingStatus ?? FilingStatus.S
    if (!this.info.caStateInfo?.paidRentEntireYear) return 0
    if (this.caAGI() > (caParameters.rentersAGILimit[fs] ?? 0)) return 0
    return caParameters.rentersCredit[fs]
  }

  totalCredits = (): number =>
    this.totalExemptionCredits() + this.rentersCredit()

  netTax = (): number => Math.max(0, this.caTax() - this.totalCredits())

  // ── Payments ─────────────────────────────────────────────────────────────

  /** CA income tax withheld from W-2 box 17. */
  caWithholding = (): number => this.methods.stateWithholding()

  /**
   * CA estimated tax payments (Form 540 line 72).
   * Entered separately from federal — uses caStateInfo.estimatedTaxPayments.
   */
  caEstimatedTax = (): number =>
    (this.info.caStateInfo?.estimatedTaxPayments ?? []).reduce(
      (sum, et) => sum + et.payment,
      0
    )

  /**
   * Total payments (Form 540 line 78).
   * Line 71 (withholding) + line 72 (estimated tax).
   * Note: CA SDI (W-2 box 14) is a deduction on Schedule CA when itemizing,
   * NOT a direct payment on Form 540 — excluded here for Phase 1.
   */
  totalPayments = (): number => this.caWithholding() + this.caEstimatedTax()

  // ── Refund / Balance Due ──────────────────────────────────────────────────

  /** Form 540 line 115 — overpayment refund. */
  refund = (): number => Math.max(0, this.totalPayments() - this.netTax())

  /** Form 540 line 111 — amount owed. */
  balanceDue = (): number => Math.max(0, this.netTax() - this.totalPayments())

  // ── PDF field mapping ─────────────────────────────────────────────────────
  //
  // The CA 540 PDF uses FTB-assigned named fields (540_form_NNNN). The field
  // tab order does not follow a simple line-number convention, so positional
  // mapping requires testing with the actual PDF. Phase 1 ships the form with
  // blank PDF fields; computation is validated via unit tests.
  //
  // fields() returns an empty array; the positional bridge in fillPdfFromFill
  // will produce a blank-but-valid PDF. TODO: implement fillInstructions()
  // with named field mappings once the field→line mapping is confirmed.
  fields = (): Field[] => []
}
