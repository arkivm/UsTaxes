import { FilingStatus } from 'ustaxes/core/data'

// 2025 CA tax parameters (FTB Schedule X/Y/Z)
// Brackets verified against FTB 2025 540 Booklet — confirm before production use
const caParameters = {
  standardDeduction: {
    [FilingStatus.S]: 4803,
    [FilingStatus.MFJ]: 9606,
    [FilingStatus.MFS]: 4803,
    [FilingStatus.HOH]: 4803,
    [FilingStatus.W]: 9606
  },
  // Dollar-for-dollar tax credits (not deductions)
  personalExemptionCredit: {
    [FilingStatus.S]: 144,
    [FilingStatus.MFJ]: 288,
    [FilingStatus.MFS]: 144,
    [FilingStatus.HOH]: 433,
    [FilingStatus.W]: 288
  },
  dependentExemptionCredit: 433,
  seniorExemptionCredit: 144, // per qualifying person age 65+
  // Renter's credit (non-refundable)
  rentersCredit: {
    [FilingStatus.S]: 60,
    [FilingStatus.MFJ]: 120,
    [FilingStatus.MFS]: 60,
    [FilingStatus.HOH]: 60,
    [FilingStatus.W]: 120
  },
  rentersAGILimit: {
    [FilingStatus.S]: 50746,
    [FilingStatus.MFJ]: 101492,
    [FilingStatus.MFS]: 50746,
    [FilingStatus.HOH]: 50746,
    [FilingStatus.W]: 101492
  },
  // 9-bracket tax schedule
  taxBrackets: {
    [FilingStatus.S]: [
      10756, 25499, 40245, 54982, 275738, 330884, 550998, 1000000
    ],
    [FilingStatus.MFJ]: [
      21512, 50998, 80490, 109964, 551476, 661768, 1101996, 1000000
    ],
    [FilingStatus.MFS]: [
      10756, 25499, 40245, 54982, 275738, 330884, 550998, 1000000
    ],
    [FilingStatus.HOH]: [
      21527, 51066, 65744, 81364, 421095, 505798, 843196, 1000000
    ],
    [FilingStatus.W]: [
      21512, 50998, 80490, 109964, 551476, 661768, 1101996, 1000000
    ]
  },
  // Rates as decimals: 1%, 2%, 4%, 6%, 8%, 9.3%, 10.3%, 11.3%, 12.3% + 1% surtax >$1M
  taxRates: [0.01, 0.02, 0.04, 0.06, 0.08, 0.093, 0.103, 0.113, 0.123, 0.133]
}

export const computeCATax = (
  filingStatus: FilingStatus,
  income: number
): number => {
  if (income <= 0) return 0
  const brackets = caParameters.taxBrackets[filingStatus]
  const rates = caParameters.taxRates
  let tax = 0
  let remaining = income
  let prevBracket = 0
  for (let i = 0; i < brackets.length; i++) {
    const bracketSize = brackets[i] - prevBracket
    const inBracket = Math.min(remaining, bracketSize)
    tax += inBracket * rates[i]
    remaining -= inBracket
    prevBracket = brackets[i]
    if (remaining <= 0) break
  }
  // Remaining income above last bracket taxed at top rate
  if (remaining > 0) {
    tax += remaining * rates[rates.length - 1]
  }
  return Math.round(tax * 100) / 100
}

export default caParameters
