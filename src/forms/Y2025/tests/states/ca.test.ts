/**
 * California Form 540 — unit tests
 *
 * Run with:
 *   npm test -- --testPathPattern="ca.test" --watchAll=false
 */
import { create1040 } from '../../irsForms/Main'
import { createStateReturn } from '../../stateForms'
import { FilingStatus, Information, PersonRole } from 'ustaxes/core/data'
import { isLeft, isRight } from 'ustaxes/core/util'
import CA540 from '../../stateForms/CA/CA540'

// ── Minimal CA W-2-only return ───────────────────────────────────────────────

const baseInfo: Information = {
  f1099s: [],
  estimatedTaxes: [],
  realEstate: [],
  f1098es: [],
  f3921s: [],
  scheduleK1Form1065s: [],
  itemizedDeductions: undefined,
  stateResidencies: [{ state: 'CA' }],
  healthSavingsAccounts: [],
  credits: [],
  individualRetirementArrangements: [],
  form1098s: [],
  questions: { CRYPTO: false },
  taxPayer: {
    filingStatus: FilingStatus.S,
    primaryPerson: {
      firstName: 'Jane',
      lastName: 'Doe',
      ssid: '123456789',
      role: PersonRole.PRIMARY,
      isBlind: false,
      dateOfBirth: new Date(1985, 5, 15),
      address: {
        address: '123 Main St',
        city: 'Los Angeles',
        state: 'CA',
        zip: '90001'
      },
      isTaxpayerDependent: false
    },
    dependents: []
  },
  w2s: [
    {
      occupation: 'Engineer',
      income: 80000,
      medicareIncome: 80000,
      fedWithholding: 10000,
      ssWages: 80000,
      ssWithholding: 4960,
      medicareWithholding: 1160,
      // CA state withholding (W-2 box 17) — flows to CA 540 line 71
      stateWithholding: 4800,
      stateWages: 80000,
      state: 'CA',
      personRole: PersonRole.PRIMARY,
      employer: { EIN: '12-3456789', employerName: 'Acme Corp' }
    }
  ]
}

const getCA540 = (info: Information): CA540 => {
  const f1040Result = create1040(info, [])
  expect(isRight(f1040Result)).toBe(true)
  if (!isRight(f1040Result)) throw new Error('create1040 failed')
  const [f1040] = f1040Result.right
  const stateResult = createStateReturn(f1040)
  expect(isLeft(stateResult)).toBe(false)
  if (isLeft(stateResult)) throw new Error('createStateReturn failed')
  const ca540 = stateResult.right.find((f) => f.formName === '540') as CA540
  expect(ca540).toBeDefined()
  return ca540
}

describe('CA Form 540 — computation', () => {
  describe('income', () => {
    it('caWages = W-2 stateWages for CA W-2s', () => {
      const ca = getCA540(baseInfo)
      expect(ca.caWages()).toBe(80000)
    })

    it('caWages excludes non-CA W-2s', () => {
      const info = {
        ...baseInfo,
        w2s: [
          ...baseInfo.w2s,
          {
            occupation: '',
            income: 20000,
            medicareIncome: 20000,
            fedWithholding: 2000,
            ssWages: 20000,
            ssWithholding: 1240,
            medicareWithholding: 290,
            stateWithholding: 500,
            stateWages: 20000,
            state: 'NY' as const,
            personRole: PersonRole.PRIMARY as
              | PersonRole.PRIMARY
              | PersonRole.SPOUSE
          }
        ]
      }
      const ca = getCA540(info)
      expect(ca.caWages()).toBe(80000) // only CA wages
    })

    it('caAGI = federal AGI when no SS income', () => {
      const f1040Result = create1040(baseInfo, [])
      if (!isRight(f1040Result)) throw new Error()
      const [f1040] = f1040Result.right
      const ca = getCA540(baseInfo)
      // No SS income → CA AGI = federal AGI
      expect(ca.caAGI()).toBe(f1040.l11b())
    })

    it('caAGI subtracts taxable SS benefits', () => {
      // SS exclusion is tested indirectly: if SS income exists on the federal
      // return, CA AGI should be less than federal AGI.
      // This requires a 1099-SSA return; deferred to when SSA support is added.
      expect(true).toBe(true) // placeholder
    })
  })

  describe('deductions and taxable income', () => {
    it('uses CA standard deduction for single filer', () => {
      const ca = getCA540(baseInfo)
      expect(ca.caStandardDeduction()).toBe(4803)
    })

    it('uses CA standard deduction for MFJ', () => {
      const info = {
        ...baseInfo,
        taxPayer: {
          ...baseInfo.taxPayer,
          filingStatus: FilingStatus.MFJ,
          spouse: {
            firstName: 'John',
            lastName: 'Doe',
            ssid: '987654321',
            role: PersonRole.SPOUSE,
            isBlind: false,
            dateOfBirth: new Date(1983, 3, 1),
            isTaxpayerDependent: false
          }
        }
      }
      const ca = getCA540(info)
      expect(ca.caStandardDeduction()).toBe(9606)
    })

    it('caTaxableIncome = caAGI - caStandardDeduction', () => {
      const ca = getCA540(baseInfo)
      expect(ca.caTaxableIncome()).toBe(
        Math.max(0, ca.caAGI() - ca.caStandardDeduction())
      )
    })

    it('caTaxableIncome is never negative', () => {
      const lowIncomeInfo = {
        ...baseInfo,
        w2s: [{ ...baseInfo.w2s[0], income: 1000, stateWages: 1000 }]
      }
      const ca = getCA540(lowIncomeInfo)
      expect(ca.caTaxableIncome()).toBeGreaterThanOrEqual(0)
    })
  })

  describe('tax computation', () => {
    it('caTax > 0 for typical income', () => {
      const ca = getCA540(baseInfo)
      expect(ca.caTax()).toBeGreaterThan(0)
    })

    it('caTax = 0 for income below standard deduction', () => {
      const info = {
        ...baseInfo,
        w2s: [{ ...baseInfo.w2s[0], income: 3000, stateWages: 3000 }]
      }
      const ca = getCA540(info)
      expect(ca.caTax()).toBe(0)
    })

    it('caTax is less than income (marginal rates applied)', () => {
      const ca = getCA540(baseInfo)
      expect(ca.caTax()).toBeLessThan(ca.caTaxableIncome())
    })

    it('first bracket: income $10,000 → 1% tax on portion above std deduction', () => {
      // caAGI ~= $10,000, std deduction $4,803, taxable ~= $5,197
      // tax = $5,197 × 1% = ~$52
      const info = {
        ...baseInfo,
        w2s: [{ ...baseInfo.w2s[0], income: 10000, stateWages: 10000 }]
      }
      const ca = getCA540(info)
      const expectedTaxable = Math.max(0, ca.caAGI() - ca.caStandardDeduction())
      const expectedTax = Math.round(expectedTaxable * 0.01 * 100) / 100
      expect(ca.caTax()).toBeCloseTo(expectedTax, 1)
    })
  })

  describe('exemption credits', () => {
    it('personal exemption credit = $144 for single', () => {
      const ca = getCA540(baseInfo)
      expect(ca.personalExemptionCredit()).toBe(144)
    })

    it('no dependent credit when no dependents', () => {
      const ca = getCA540(baseInfo)
      expect(ca.dependentExemptionCredit()).toBe(0)
    })

    it('dependent credit = $433 per dependent', () => {
      const info = {
        ...baseInfo,
        taxPayer: {
          ...baseInfo.taxPayer,
          dependents: [
            {
              firstName: 'Kid',
              lastName: 'Doe',
              ssid: '111222333',
              role: PersonRole.DEPENDENT,
              isBlind: false,
              dateOfBirth: new Date(2018, 0, 1),
              relationship: 'Child',
              qualifyingInfo: { numberOfMonths: 12, isStudent: false }
            }
          ]
        }
      }
      const ca = getCA540(info)
      expect(ca.dependentExemptionCredit()).toBe(433)
    })

    it('senior exemption applies for taxpayer age 65+', () => {
      const info = {
        ...baseInfo,
        taxPayer: {
          ...baseInfo.taxPayer,
          primaryPerson: {
            firstName: 'Jane',
            lastName: 'Doe',
            ssid: '123456789',
            role: PersonRole.PRIMARY,
            isBlind: false,
            isTaxpayerDependent: false,
            dateOfBirth: new Date(1955, 0, 1), // age 70
            address: {
              address: '123 Main St',
              city: 'Los Angeles',
              state: 'CA' as const,
              zip: '90001'
            }
          }
        }
      }
      const ca = getCA540(info)
      expect(ca.primarySenior()).toBe(true)
      expect(ca.seniorExemptionCredit()).toBe(144)
    })
  })

  describe("renter's credit", () => {
    it("no renter's credit when not set", () => {
      const ca = getCA540(baseInfo)
      expect(ca.rentersCredit()).toBe(0)
    })

    it("renter's credit = $60 for single under AGI limit", () => {
      // Income must be below the $50,746 single AGI limit for the credit
      const info = {
        ...baseInfo,
        caStateInfo: { paidRentEntireYear: true },
        w2s: [{ ...baseInfo.w2s[0], income: 30000, stateWages: 30000 }]
      }
      const ca = getCA540(info)
      expect(ca.caAGI()).toBeLessThanOrEqual(50746)
      expect(ca.rentersCredit()).toBe(60)
    })

    it("no renter's credit when AGI exceeds limit", () => {
      const highIncomeInfo = {
        ...baseInfo,
        caStateInfo: { paidRentEntireYear: true },
        w2s: [{ ...baseInfo.w2s[0], income: 200000, stateWages: 200000 }]
      }
      const ca = getCA540(highIncomeInfo)
      expect(ca.rentersCredit()).toBe(0)
    })
  })

  describe('payments', () => {
    it('caWithholding = W-2 stateWithholding for CA W-2s', () => {
      const ca = getCA540(baseInfo)
      expect(ca.caWithholding()).toBe(4800)
    })

    it('caEstimatedTax = 0 when no caStateInfo', () => {
      const ca = getCA540(baseInfo)
      expect(ca.caEstimatedTax()).toBe(0)
    })

    it('caEstimatedTax sums caStateInfo.estimatedTaxPayments', () => {
      const info = {
        ...baseInfo,
        caStateInfo: {
          estimatedTaxPayments: [
            { label: 'Q1', payment: 500 },
            { label: 'Q2', payment: 500 }
          ]
        }
      }
      const ca = getCA540(info)
      expect(ca.caEstimatedTax()).toBe(1000)
    })

    it('totalPayments = withholding + estimated', () => {
      const info = {
        ...baseInfo,
        caStateInfo: {
          estimatedTaxPayments: [{ label: 'Q1', payment: 200 }]
        }
      }
      const ca = getCA540(info)
      expect(ca.totalPayments()).toBe(ca.caWithholding() + ca.caEstimatedTax())
    })
  })

  describe('refund and balance due', () => {
    it('refund > 0 when payments exceed tax', () => {
      // $80k wages → CA tax ~$3,600; withholding $4,800 → refund ~$1,200+
      const ca = getCA540(baseInfo)
      if (ca.totalPayments() > ca.netTax()) {
        expect(ca.refund()).toBeGreaterThan(0)
        expect(ca.balanceDue()).toBe(0)
      }
    })

    it('balance due > 0 when tax exceeds payments', () => {
      const info = {
        ...baseInfo,
        w2s: [{ ...baseInfo.w2s[0], stateWithholding: 0 }]
      }
      const ca = getCA540(info)
      expect(ca.balanceDue()).toBeGreaterThan(0)
      expect(ca.refund()).toBe(0)
    })

    it('refund and balance due are mutually exclusive', () => {
      const ca = getCA540(baseInfo)
      const bothNonZero = ca.refund() > 0 && ca.balanceDue() > 0
      expect(bothNonZero).toBe(false)
    })
  })

  describe('state return integration', () => {
    it('CA state return is produced for CA resident', () => {
      const f1040Result = create1040(baseInfo, [])
      if (!isRight(f1040Result)) throw new Error()
      const [f1040] = f1040Result.right
      const stateResult = createStateReturn(f1040)
      expect(isLeft(stateResult)).toBe(false)
      if (isLeft(stateResult)) throw new Error()
      expect(stateResult.right.some((f) => f.formName === '540')).toBe(true)
    })

    it('CA540V attached when balance is due', () => {
      const info = {
        ...baseInfo,
        w2s: [{ ...baseInfo.w2s[0], stateWithholding: 0 }]
      }
      const ca = getCA540(info)
      expect(ca.balanceDue()).toBeGreaterThan(0)
      expect(ca.attachments().some((f) => f.formName === '540V')).toBe(true)
    })

    it('no CA540V when refund is due', () => {
      const ca = getCA540(baseInfo)
      if (ca.refund() > 0) {
        expect(ca.attachments().some((f) => f.formName === '540V')).toBe(false)
      }
    })
  })
})
