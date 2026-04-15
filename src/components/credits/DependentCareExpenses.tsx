import { ReactElement } from 'react'
import { Helmet } from 'react-helmet'
import {
  FormProvider,
  useForm,
  useFieldArray,
  useFormContext
} from 'react-hook-form'
import { useDispatch, useSelector, TaxesState } from 'ustaxes/redux'
import { setDependentCareExpenses } from 'ustaxes/redux/actions'
import { usePager } from 'ustaxes/components/pager'
import { Currency, LabeledInput, LabeledRadio } from 'ustaxes/components/input'
import { FilingStatus } from 'ustaxes/core/data'
import { Patterns } from 'ustaxes/components/Patterns'
import {
  Box,
  Button,
  Divider,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@material-ui/core'
import DeleteIcon from '@material-ui/icons/Delete'
import { intentionallyFloat } from 'ustaxes/core/util'

const EXCLUSION_LIMIT_MFS = 2500
const EXCLUSION_LIMIT = 5000

interface ProviderInput {
  name: string
  taxId: string
  taxIdType: 'SSN' | 'EIN'
  amountPaid: string
}

interface DependentExpenseInput {
  ssid: string
  firstName: string
  lastName: string
  amount: string
}

interface FormValues {
  providers: ProviderInput[]
  dependentExpenses: DependentExpenseInput[]
}

// Inner component that consumes form context for live totals
const FormBody = ({
  employerBenefits,
  limit,
  taxableBenefits,
  filingStatus
}: {
  employerBenefits: number
  limit: number
  taxableBenefits: number
  filingStatus: FilingStatus | undefined
}): ReactElement => {
  const { control, watch } = useFormContext<FormValues>()

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'providers'
  })

  const watchedProviders = watch('providers')
  const watchedDepExpenses = watch('dependentExpenses')

  const providerTotal = watchedProviders.reduce(
    (s, p) => s + (parseFloat(p.amountPaid) || 0),
    0
  )
  const depTotal = watchedDepExpenses.reduce(
    (s, e) => s + (parseFloat(e.amount) || 0),
    0
  )
  const totalsMatch =
    providerTotal === 0 ||
    depTotal === 0 ||
    Math.abs(providerTotal - depTotal) < 0.01

  const showSummary = employerBenefits > 0 || providerTotal > 0 || depTotal > 0

  return (
    <>
      {/* ── Section 1: Care Providers ─────────────────────────────── */}
      <Paper
        variant="outlined"
        style={{ padding: '16px', marginBottom: '16px' }}
      >
        <Typography variant="h6" gutterBottom>
          Care Providers — Part I
        </Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Enter the total from each provider&apos;s annual tax statement —
          regardless of whether it was paid with DCFSA funds or cash. DCFSA
          benefits from W-2 Box 10 are accounted for automatically.
        </Typography>

        {fields.length > 0 && (
          <Table size="small" style={{ marginBottom: '8px' }}>
            <TableHead>
              <TableRow>
                <TableCell>Provider name</TableCell>
                <TableCell>TIN (9 digits)</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Total billed</TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {fields.map((field, idx) => (
                <TableRow key={field.id}>
                  <TableCell style={{ minWidth: 180 }}>
                    <LabeledInput<FormValues>
                      name={`providers.${idx}.name`}
                      label=""
                      patternConfig={Patterns.plain}
                      required={true}
                      useGrid={false}
                    />
                  </TableCell>
                  <TableCell style={{ minWidth: 130 }}>
                    <LabeledInput<FormValues>
                      name={`providers.${idx}.taxId`}
                      label=""
                      patternConfig={Patterns.plain}
                      required={true}
                      useGrid={false}
                    />
                  </TableCell>
                  <TableCell>
                    <LabeledRadio<FormValues>
                      name={`providers.${idx}.taxIdType`}
                      label=""
                      values={[
                        ['SSN', 'SSN'],
                        ['EIN', 'EIN']
                      ]}
                      useGrid={false}
                    />
                  </TableCell>
                  <TableCell align="right" style={{ minWidth: 120 }}>
                    <LabeledInput<FormValues>
                      name={`providers.${idx}.amountPaid`}
                      label=""
                      patternConfig={Patterns.currency}
                      required={true}
                      useGrid={false}
                    />
                  </TableCell>
                  <TableCell padding="checkbox">
                    <IconButton
                      size="small"
                      aria-label="remove provider"
                      onClick={() => remove(idx)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() =>
              append({ name: '', taxId: '', taxIdType: 'EIN', amountPaid: '' })
            }
          >
            + Add Provider
          </Button>
          {providerTotal > 0 && (
            <Typography variant="body2">
              <strong>
                Total: <Currency value={providerTotal} />
              </strong>
            </Typography>
          )}
        </Box>
      </Paper>

      {/* ── Section 2: Per-Dependent Expenses ─────────────────────── */}
      <Paper
        variant="outlined"
        style={{ padding: '16px', marginBottom: '16px' }}
      >
        <Typography variant="h6" gutterBottom>
          Expenses per Qualifying Person — Part II
        </Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Children under 13 or disabled dependents. Leave blank if no care
          expenses.
        </Typography>

        {watchedDepExpenses.length === 0 ? (
          <Typography variant="body2">
            No dependents found in your return.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Dependent</TableCell>
                <TableCell align="right">Qualifying expenses</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {watchedDepExpenses.map((dep, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    {dep.firstName} {dep.lastName}
                  </TableCell>
                  <TableCell align="right" style={{ minWidth: 140 }}>
                    <LabeledInput<FormValues>
                      name={`dependentExpenses.${idx}.amount`}
                      label=""
                      patternConfig={Patterns.currency}
                      required={false}
                      useGrid={false}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {depTotal > 0 && (
                <TableRow>
                  <TableCell>
                    <strong>Total</strong>
                  </TableCell>
                  <TableCell align="right">
                    <strong>
                      <Currency value={depTotal} />
                    </strong>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Paper>

      {/* ── Mismatch warning ──────────────────────────────────────── */}
      {!totalsMatch && (
        <Paper
          variant="outlined"
          style={{
            padding: '12px 16px',
            marginBottom: '16px',
            borderColor: '#f44336',
            backgroundColor: '#fff5f5'
          }}
        >
          <Typography variant="body2" style={{ color: '#c62828' }}>
            Provider total (<Currency value={providerTotal} />) does not match
            dependent total (<Currency value={depTotal} />
            ). These should be equal.
          </Typography>
        </Paper>
      )}

      {/* ── Section 3: Eligibility Summary ───────────────────────── */}
      {showSummary && (
        <Paper variant="outlined" style={{ padding: '16px' }}>
          <Typography variant="h6" gutterBottom>
            Eligibility Summary
          </Typography>
          <Divider style={{ marginBottom: '8px' }} />
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell>Employer benefits (W-2 Box 10)</TableCell>
                <TableCell align="right">
                  <Currency value={employerBenefits} />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  Max exclusion (
                  {filingStatus === FilingStatus.MFS ? 'MFS' : 'standard'})
                </TableCell>
                <TableCell align="right">
                  <Currency value={limit} />
                </TableCell>
              </TableRow>
              {taxableBenefits > 0 && (
                <TableRow>
                  <TableCell style={{ color: '#b71c1c' }}>
                    Taxable benefits added to income
                  </TableCell>
                  <TableCell align="right" style={{ color: '#b71c1c' }}>
                    <Currency value={taxableBenefits} />
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell>Total care expenses (from provider bills)</TableCell>
                <TableCell align="right">
                  <Currency value={providerTotal} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Typography
            variant="body2"
            color="textSecondary"
            style={{ marginTop: '8px' }}
          >
            The eligible credit is computed automatically. Any DCFSA benefits
            (W-2 Box 10) are subtracted from the expense cap before applying the
            credit rate — you do not need to separate cash vs. DCFSA payments.
          </Typography>
        </Paper>
      )}
    </>
  )
}

export const DependentCareExpensesInfo = (): ReactElement => {
  const dependentCareExpenses = useSelector(
    (state: TaxesState) => state.information.dependentCareExpenses
  )
  const w2s = useSelector((state: TaxesState) => state.information.w2s)
  const filingStatus = useSelector(
    (state: TaxesState) => state.information.taxPayer.filingStatus
  )
  const dependents = useSelector(
    (state: TaxesState) => state.information.taxPayer.dependents
  )

  const employerBenefits = w2s.reduce(
    (sum, w2) => sum + (w2.box10DependentCare ?? 0),
    0
  )
  const limit =
    filingStatus === FilingStatus.MFS ? EXCLUSION_LIMIT_MFS : EXCLUSION_LIMIT
  const taxableBenefits = Math.max(0, employerBenefits - limit)

  const savedProviders = dependentCareExpenses?.providers ?? []
  const savedDepExpenses = dependentCareExpenses?.dependentExpenses ?? []

  // Show ALL dependents — Form 2441 covers children under 13 AND disabled
  // dependents/spouses. Let the user fill in amounts only for those who had
  // qualifying care; the credit computation handles eligibility automatically.
  const defaultDependentExpenses: DependentExpenseInput[] = dependents.map(
    (child) => {
      const saved = savedDepExpenses.find((e) => e.ssid === child.ssid)
      return {
        ssid: child.ssid,
        firstName: child.firstName,
        lastName: child.lastName,
        amount: saved?.amount !== undefined ? saved.amount.toString() : ''
      }
    }
  )

  const defaultValues: FormValues = {
    providers: savedProviders.map((p) => ({
      name: p.name,
      taxId: p.taxId,
      taxIdType: p.taxIdType,
      amountPaid: p.amountPaid.toString()
    })),
    dependentExpenses: defaultDependentExpenses
  }

  const { onAdvance, navButtons } = usePager()
  const methods = useForm<FormValues>({ defaultValues })
  const { handleSubmit } = methods
  const dispatch = useDispatch()

  const onSubmit = (form: FormValues): void => {
    const formProviderTotal = form.providers.reduce(
      (s, p) => s + (parseFloat(p.amountPaid) || 0),
      0
    )
    dispatch(
      setDependentCareExpenses({
        providers: form.providers.map((p) => ({
          name: p.name,
          taxId: p.taxId,
          taxIdType: p.taxIdType,
          amountPaid: parseFloat(p.amountPaid) || 0
        })),
        dependentExpenses: form.dependentExpenses
          .filter((e) => parseFloat(e.amount) > 0)
          .map((e) => ({
            ssid: e.ssid,
            amount: parseFloat(e.amount) || 0
          })),
        totalExpenses: formProviderTotal || undefined
      })
    )
    onAdvance()
  }

  return (
    <form tabIndex={-1} onSubmit={intentionallyFloat(handleSubmit(onSubmit))}>
      <FormProvider {...methods}>
        <Helmet>
          <title>
            Child and Dependent Care Expenses | Credits | UsTaxes.org
          </title>
        </Helmet>
        <h2>Child and Dependent Care Expenses (Form 2441)</h2>
        <p>
          If you do not have qualifying dependent care expenses, you can skip
          this form.
        </p>
        <FormBody
          employerBenefits={employerBenefits}
          limit={limit}
          taxableBenefits={taxableBenefits}
          filingStatus={filingStatus}
        />
        {navButtons}
      </FormProvider>
    </form>
  )
}

export default DependentCareExpensesInfo
