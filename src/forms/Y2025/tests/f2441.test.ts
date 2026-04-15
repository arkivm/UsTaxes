/**
 * Form 2441 — Child and Dependent Care Expenses
 *
 * Fast iteration test: concrete inputs, no property testing, runs in ~5 s.
 * Run with:
 *   npm test -- --testPathPattern="f2441" --watchAll=false
 *
 * This catches PDF field mapping errors (wrong types, maxLength violations)
 * without needing Docker or a browser.
 */
import { FilingStatus, Information, PersonRole } from 'ustaxes/core/data'
import { isRight } from 'ustaxes/core/util'
import { create1040 } from '../irsForms/Main'
import { fillPDFByName } from 'ustaxes/core/pdfFiller/fillPdf'
import { testKit } from '.'

jest.setTimeout(30000)

/** Minimal return: MFJ, one child under 13, W-2 with box 10 DCFSA, daycare expenses. */
const baseInfo: Information = {
  f1099s: [],
  estimatedTaxes: [],
  realEstate: [],
  form1098s: [],
  f1098es: [],
  f3921s: [],
  scheduleK1Form1065s: [],
  itemizedDeductions: undefined,
  stateResidencies: [{ state: 'CA' }],
  healthSavingsAccounts: [],
  credits: [],
  individualRetirementArrangements: [],
  questions: { CRYPTO: false },
  taxPayer: {
    filingStatus: FilingStatus.MFJ,
    primaryPerson: {
      firstName: 'Jane',
      lastName: 'Smith',
      ssid: '111223333',
      role: PersonRole.PRIMARY,
      isBlind: false,
      dateOfBirth: new Date(1985, 0, 1),
      address: {
        address: '123 Main St',
        city: 'Springfield',
        state: 'CA',
        zip: '90001'
      },
      isTaxpayerDependent: false
    },
    spouse: {
      firstName: 'John',
      lastName: 'Smith',
      ssid: '444556666',
      role: PersonRole.SPOUSE,
      isBlind: false,
      dateOfBirth: new Date(1983, 5, 15),
      isTaxpayerDependent: false
    },
    dependents: [
      {
        firstName: 'Emma',
        lastName: 'Smith',
        ssid: '777889999',
        role: PersonRole.DEPENDENT,
        isBlind: false,
        // Age 5 — qualifies for child care credit
        dateOfBirth: new Date(2020, 3, 10),
        relationship: 'Daughter',
        qualifyingInfo: {
          numberOfMonths: 12,
          isStudent: false
        }
      }
    ]
  },
  w2s: [
    {
      occupation: 'Engineer',
      income: 95000,
      medicareIncome: 95000,
      fedWithholding: 12000,
      ssWages: 95000,
      ssWithholding: 5890,
      medicareWithholding: 1378,
      box10DependentCare: 3000, // DCFSA employer benefit
      personRole: PersonRole.PRIMARY,
      state: 'CA',
      stateWages: 95000,
      stateWithholding: 5000,
      employer: { EIN: '12-3456789', employerName: 'Acme Corp' }
    },
    {
      occupation: 'Teacher',
      income: 55000,
      medicareIncome: 55000,
      fedWithholding: 7000,
      ssWages: 55000,
      ssWithholding: 3410,
      medicareWithholding: 798,
      personRole: PersonRole.SPOUSE,
      state: 'CA',
      stateWages: 55000,
      stateWithholding: 3000,
      employer: { EIN: '98-7654321', employerName: 'School District' }
    }
  ],
  dependentCareExpenses: {
    providers: [],
    dependentExpenses: [],
    totalExpenses: 5500 // paid to daycare from receipts (legacy fallback)
  }
}

describe('Form 2441 — Child and Dependent Care Expenses', () => {
  describe('computation', () => {
    it('isNeeded when expenses entered', () => {
      const result = create1040(baseInfo, [])
      expect(isRight(result)).toBe(true)
      if (!isRight(result)) return
      const f1040 = result.right[0]
      expect(f1040.f2441.isNeeded()).toBe(true)
    })

    it('isNeeded when only W-2 box 10 present (no expenses entered)', () => {
      const info = { ...baseInfo, dependentCareExpenses: undefined }
      const result = create1040(info, [])
      expect(isRight(result)).toBe(true)
      if (!isRight(result)) return
      const f1040 = result.right[0]
      expect(f1040.f2441.isNeeded()).toBe(true)
    })

    it('qualifyingPersonCount derived from dependents under 13', () => {
      const result = create1040(baseInfo, [])
      expect(isRight(result)).toBe(true)
      if (!isRight(result)) return
      const f1040 = result.right[0]
      expect(f1040.f2441.qualifyingChildren.length).toBe(1)
    })

    it('employerBenefits read from W-2 box 10', () => {
      const result = create1040(baseInfo, [])
      expect(isRight(result)).toBe(true)
      if (!isRight(result)) return
      expect(result.right[0].f2441.employerBenefits()).toBe(3000)
    })

    it('taxableBenefits = 0 when exclusion covers all employer benefits', () => {
      // $3000 box 10, AGI ~$150k → maxExclusion = $5000 → taxable = 0
      const result = create1040(baseInfo, [])
      expect(isRight(result)).toBe(true)
      if (!isRight(result)) return
      // taxable = max(0, 3000 - 5000) = 0 → undefined
      expect(result.right[0].f2441.taxableBenefits()).toBeUndefined()
    })

    it('credit is zero when DCFSA fills the full cap (1 child, $3k DCFSA = $3k cap)', () => {
      // With 1 qualifying child: cap = $3,000. DCFSA = $3,000.
      // remainingCap = $3,000 - $3,000 = $0 → no credit.
      const result = create1040(baseInfo, [])
      expect(isRight(result)).toBe(true)
      if (!isRight(result)) return
      expect(result.right[0].f2441.credit()).toBeUndefined()
    })

    it('credit is non-zero when out-of-pocket expenses exceed DCFSA cap', () => {
      // No DCFSA — full $3,000 cap available for the credit.
      const noDcfsaInfo = {
        ...baseInfo,
        w2s: baseInfo.w2s.map((w2) => ({
          ...w2,
          box10DependentCare: undefined
        }))
      }
      const result = create1040(noDcfsaInfo, [])
      expect(isRight(result)).toBe(true)
      if (!isRight(result)) return
      const credit = result.right[0].f2441.credit()
      expect(credit).toBeDefined()
      expect(credit ?? 0).toBeGreaterThan(0)
    })

    it('credit flows to F1040 line 1e (taxableBenefits)', () => {
      const result = create1040(baseInfo, [])
      expect(isRight(result)).toBe(true)
      if (!isRight(result)) return
      // taxableBenefits → F1040.l1e
      const f1040 = result.right[0]
      expect(f1040.l1e()).toEqual(f1040.f2441.taxableBenefits())
    })
  })

  describe('PDF fill — no field errors', () => {
    it('fillInstructions count matches PDF field count', async () => {
      const result = create1040(baseInfo, [])
      expect(isRight(result)).toBe(true)
      if (!isRight(result)) return
      const f1040 = result.right[0]

      const pdf = await testKit.downloader('irs/f2441.pdf')
      const pdfFields = pdf.getForm().getFields()
      const instructions = f1040.f2441.fillInstructions()

      expect(instructions.length).toBe(pdfFields.length)
    })

    it('fills PDF in strict mode — no maxLength or type violations', async () => {
      const result = create1040(baseInfo, [])
      expect(isRight(result)).toBe(true)
      if (!isRight(result)) return
      const f1040 = result.right[0]

      const pdf = await testKit.downloader('irs/f2441.pdf')
      const instructions = f1040.f2441.fillInstructions()

      const { warnings } = fillPDFByName(pdf, instructions, 'f2441', 'strict')
      expect(warnings).toEqual([])
    })

    it('fills PDF with high AGI (6-digit) — maxLength regression', async () => {
      // This is the case that previously broke: AGI in wrong maxLength=2 field
      const highAgiInfo: Information = {
        ...baseInfo,
        w2s: [
          { ...baseInfo.w2s[0], income: 180000, medicareIncome: 180000 },
          { ...baseInfo.w2s[1], income: 80000, medicareIncome: 80000 }
        ]
      }
      const result = create1040(highAgiInfo, [])
      expect(isRight(result)).toBe(true)
      if (!isRight(result)) return

      const pdf = await testKit.downloader('irs/f2441.pdf')
      const instructions = result.right[0].f2441.fillInstructions()
      const { warnings } = fillPDFByName(pdf, instructions, 'f2441', 'strict')
      expect(warnings).toEqual([])
    })
  })
})
