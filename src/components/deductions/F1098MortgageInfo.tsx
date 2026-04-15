import { ReactElement } from 'react'
import { Helmet } from 'react-helmet'
import { FormProvider, useForm } from 'react-hook-form'
import HomeIcon from '@material-ui/icons/Home'
import { useDispatch, useSelector, TaxesState } from 'ustaxes/redux'
import {
  addForm1098Mortgage,
  editForm1098Mortgage,
  removeForm1098Mortgage
} from 'ustaxes/redux/actions'
import { usePager } from 'ustaxes/components/pager'
import { Currency, DatePicker, LabeledInput } from 'ustaxes/components/input'
import { Form1098Mortgage, Form1098MortgageDateString } from 'ustaxes/core/data'
import { Patterns } from 'ustaxes/components/Patterns'
import { FormListContainer } from 'ustaxes/components/FormContainer'
import { Grid } from '@material-ui/core'
import { intentionallyFloat } from 'ustaxes/core/util'

// TCJA acquisition debt limit cutoff
const TCJA_CUTOFF = new Date('2017-12-16')
const TCJA_LIMIT = 750_000
const PRE_TCJA_LIMIT = 1_000_000

/** Compute the deductible interest for display in the list secondary line. */
const deductibleInterest = (m: Form1098Mortgage<Date | string>): number => {
  const d =
    m.originationDate instanceof Date
      ? m.originationDate
      : new Date(m.originationDate)
  const limit = d >= TCJA_CUTOFF ? TCJA_LIMIT : PRE_TCJA_LIMIT
  if (m.outstandingPrincipal <= limit) return m.mortgageInterestReceived
  return m.mortgageInterestReceived * (limit / m.outstandingPrincipal)
}

const showSummary = (m: Form1098Mortgage<Date | string>): ReactElement => {
  const deductible = deductibleInterest(m)
  const isPartial = deductible < m.mortgageInterestReceived
  return (
    <>
      <Currency value={deductible} />
      {isPartial && ' (prorated)'}
    </>
  )
}

interface Form1098MortgageUserInput {
  lenderName: string
  mortgageInterestReceived: string | number
  outstandingPrincipal: string | number
  originationDate: Date | undefined
  mortgageInsurancePremiums: string | number
  points: string | number
}

const blankUserInput: Form1098MortgageUserInput = {
  lenderName: '',
  mortgageInterestReceived: '',
  outstandingPrincipal: '',
  originationDate: undefined,
  mortgageInsurancePremiums: '',
  points: ''
}

const toUserInput = (m: Form1098Mortgage): Form1098MortgageUserInput => ({
  lenderName: m.lenderName,
  mortgageInterestReceived: m.mortgageInterestReceived,
  outstandingPrincipal: m.outstandingPrincipal,
  originationDate:
    m.originationDate instanceof Date
      ? m.originationDate
      : new Date(m.originationDate),
  mortgageInsurancePremiums: m.mortgageInsurancePremiums ?? '',
  points: m.points ?? ''
})

const toForm1098Mortgage = (
  f: Form1098MortgageUserInput
): Form1098MortgageDateString => ({
  lenderName: f.lenderName,
  mortgageInterestReceived: Number(f.mortgageInterestReceived),
  outstandingPrincipal: Number(f.outstandingPrincipal),
  // DatePicker gives a Date; send as ISO string — reducer converts back to Date
  originationDate: f.originationDate?.toISOString() ?? '',

  ...(f.mortgageInsurancePremiums !== '' && {
    mortgageInsurancePremiums: Number(f.mortgageInsurancePremiums)
  }),
  ...(f.points !== '' && { points: Number(f.points) })
})

export default function F1098MortgageInfo(): ReactElement {
  const form1098s = useSelector(
    (state: TaxesState) => state.information.form1098s
  )

  const defaultValues: Form1098MortgageUserInput = blankUserInput

  const { onAdvance, navButtons } = usePager()

  const methods = useForm<Form1098MortgageUserInput>({ defaultValues })
  const { handleSubmit } = methods

  const dispatch = useDispatch()

  const onAdd = (formData: Form1098MortgageUserInput): void => {
    dispatch(addForm1098Mortgage(toForm1098Mortgage(formData)))
  }

  const onEdit =
    (index: number) =>
    (formData: Form1098MortgageUserInput): void => {
      dispatch(
        editForm1098Mortgage({ value: toForm1098Mortgage(formData), index })
      )
    }

  return (
    <FormProvider {...methods}>
      <form
        tabIndex={-1}
        onSubmit={intentionallyFloat(handleSubmit(onAdvance))}
      >
        <Helmet>
          <title>
            Mortgage Interest (Form 1098) | Deductions | UsTaxes.org
          </title>
        </Helmet>
        <h2>Mortgage Interest — Form 1098</h2>
        <p>
          Enter each Form 1098 you received from your mortgage lender(s). The
          deductible amount is computed automatically based on the{' '}
          <strong>$750,000</strong> acquisition debt limit (TCJA, for loans
          originated Dec 16 2017 or later) or <strong>$1,000,000</strong> (for
          loans originated before that date).
        </p>
        <FormListContainer
          defaultValues={defaultValues}
          onSubmitAdd={onAdd}
          onSubmitEdit={onEdit}
          items={form1098s.map(toUserInput)}
          removeItem={(i) => dispatch(removeForm1098Mortgage(i))}
          primary={(f) => f.lenderName}
          secondary={(f) => showSummary(toForm1098Mortgage(f))}
          icon={() => <HomeIcon />}
        >
          <p>Enter details from your Form 1098</p>
          <Grid container spacing={2}>
            <LabeledInput
              autofocus={true}
              label="Lender name"
              required={true}
              name="lenderName"
            />
            <LabeledInput
              label="Box 1 — Mortgage interest received"
              patternConfig={Patterns.currency}
              required={true}
              name="mortgageInterestReceived"
            />
            <LabeledInput
              label="Box 2 — Outstanding mortgage principal (as of Jan 1)"
              patternConfig={Patterns.currency}
              required={true}
              name="outstandingPrincipal"
            />
            <DatePicker
              label="Box 3 — Mortgage origination date"
              required={true}
              name="originationDate"
              minDate={new Date(1970, 0, 1)}
              maxDate={new Date()}
            />
            <LabeledInput
              label="Box 5 — Mortgage insurance premiums (optional)"
              patternConfig={Patterns.currency}
              required={false}
              name="mortgageInsurancePremiums"
            />
            <LabeledInput
              label="Box 6 — Points paid on purchase (optional)"
              patternConfig={Patterns.currency}
              required={false}
              name="points"
            />
          </Grid>
        </FormListContainer>
        {navButtons}
      </form>
    </FormProvider>
  )
}
