import Form from 'ustaxes/core/stateForms/Form'
import { State } from 'ustaxes/core/data'
import { Field } from 'ustaxes/core/pdfFiller'
import F1040 from 'ustaxes/forms/Y2025/irsForms/F1040'
import { ValidatedInformation } from 'ustaxes/forms/F1040Base'
import CA540 from './CA540'

export default class CA540V extends Form {
  readonly state: State = 'CA'
  readonly formName = '540V'
  readonly formOrder = -1

  readonly info: ValidatedInformation
  private readonly ca540: CA540

  constructor(f1040: F1040, ca540: CA540) {
    super()
    this.info = f1040.info
    this.ca540 = ca540
  }

  attachments = (): Form[] => []

  balanceDueDollars = (): number => Math.floor(this.ca540.balanceDue())

  balanceDueCents = (): number =>
    Math.round((this.ca540.balanceDue() - this.balanceDueDollars()) * 100)

  fields = (): Field[] => [
    this.info.taxPayer.primaryPerson.lastName,
    this.info.taxPayer.primaryPerson.firstName,
    this.info.taxPayer.primaryPerson.ssid,
    // Spouse (if applicable)
    this.info.taxPayer.spouse?.lastName,
    this.info.taxPayer.spouse?.firstName,
    this.info.taxPayer.spouse?.ssid,
    // Address
    this.info.taxPayer.primaryPerson.address.address,
    this.info.taxPayer.primaryPerson.address.city,
    this.info.taxPayer.primaryPerson.address.state,
    this.info.taxPayer.primaryPerson.address.zip,
    // Payment amount
    this.balanceDueDollars() > 0 ? this.balanceDueDollars() : undefined,
    this.balanceDueCents() > 0 ? this.balanceDueCents() : undefined,
    // Tax year
    '2025'
  ]
}
