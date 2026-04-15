# UsTaxes — Claude Code Guide

## Running the app

```sh
npm start          # dev server (no Docker needed for development)
npm test           # full test suite via craco/Jest (~30 s)
npm run build      # production build
```

Docker is only needed for the Tauri desktop build (`docker compose up`).
For all web development and PDF form work, run everything locally.

> **Do NOT use `npx jest` directly** — it bypasses the CRA/craco Babel
> config and fails to parse TypeScript type annotations. Always use
> `npm test` or `craco test`.

## Fast iteration on PDF forms

```sh
# Run a single form's test (~1-5 s, watch mode reruns on save):
npm test -- --testPathPattern="f2441.test"

# Catch PDF field mapping errors across all Y2025 forms (~27 s):
npm test -- --testPathPattern="fillEquivalence" --watchAll=false

# Full suite before committing:
npm test -- --watchAll=false
```

When adding or changing `fillInstructions()` for any form, always:

1. Run the specific form test to catch computation errors quickly
2. Run `fillEquivalence` to catch field name/maxLength violations
3. Never guess field names — derive them from `schemas/Y2025/<form>.json`

## Adding a new IRS form (checklist)

### 1. Get the PDF and schema

```sh
# Add to public/catalogs.json:
"f2441": "https://www.irs.gov/pub/irs-pdf/f2441.pdf"

# Download:
curl -sL --compressed <url> -o public/forms/Y2025/irs/<form>.pdf

# Extract field schema:
npm run extract-schema public/forms/Y2025/irs/<form>.pdf schemas/Y2025/<form>.json
```

The schema gives you every field name, type (`text`/`checkbox`), and
`maxLength`. **Check maxLength before mapping** — a 2-char field is never
a dollar amount or AGI.

### 2. Data model (`src/core/data/index.ts`)

- Add a new interface for user-entered data (only what can't be derived)
- Add it as an optional field on `Information`
- **Don't ask users for anything the app can compute** (e.g. qualifying
  person count from dependents, employer benefits from W-2 box 10)

### 3. Validator + schema regen

```sh
# scripts/setup.ts — add to standaloneCode map:
MyNewType: '#/definitions/MyNewType',

# src/core/data/validate.ts — export the validator:
export const myNewType = fns.MyNewType as ValidateFunction<types.MyNewType>

# Regenerate:
npx ts-node scripts/setup.ts
```

### 4. Redux (`src/redux/actions.ts` + `src/redux/reducer.ts`)

Follow the `SET_ITEMIZED_DEDUCTIONS` / `setItemizedDeductions` pattern for
single-object forms. Use ADD/EDIT/REMOVE for array-based data (W-2s, etc.).

### 5. Form class (`src/forms/Y2025/irsForms/F<NNNN>.ts`)

- Extends `F1040Attachment`
- Set `tag` and `sequenceIndex` (sequenceIndex controls PDF output order)
- `isNeeded()` — return true when the form must appear; **also trigger on
  related W-2/1099 data** (e.g. F2441 triggers when W-2 box 10 > 0 even
  if user hasn't visited the credits page)
- `fillInstructions()` — map every field by name using `text()` and
  `checkbox()` helpers; count must equal `schemas/Y2025/<form>.json` total
- `fields()` — derive from `fillInstructions()`:
  ```typescript
  fields = (): Field[] =>
    this.fillInstructions().map((instr) =>
      instr.kind === 'text'
        ? instr.value === undefined
          ? ''
          : instr.value
        : instr.value
    )
  ```
- Add `this.fNNNN` to the `res1` array in **`F1040.schedules()`**

### 6. UI component (`src/components/credits/<Form>.tsx`)

- Model after `ItemizedDeductions.tsx` (single SET dispatch) or
  `healthSavingsAccounts.tsx` (array ADD/EDIT/REMOVE)
- Only collect what can't be derived; show auto-computed values as read-only

### 7. Navigation

- Add URL to `src/data/urls.ts`
- Import component and add menu item in `src/components/Menu.tsx`

### 8. Tests (`src/forms/Y2025/tests/<form>.test.ts`)

Write a concrete test with known inputs covering:

- `isNeeded()` — with and without data
- Key computed values (credit amounts, taxable benefits)
- `fillPDFByName` in strict mode — no warnings
- Edge cases that previously broke (e.g. large AGI in a maxLength=2 field)

## Form 2441 specifics

- User enters **only** raw daycare receipts (`totalExpenses`)
- Qualifying person count → auto-derived from `qualifyingDependents.qualifyingChildren()`
- DCFSA / employer benefits → auto-pulled from W-2 `box10DependentCare`
- Credit rate → looked up from `CREDIT_RATE_TABLE` by AGI
- `taxableBenefits()` → F1040 line 1e
- `credit()` → Schedule 3 line 2
- `isNeeded()` triggers when `employerBenefits() > 0` OR `totalExpenses > 0`

## Dependent table (Y2025 Row 5 "lived with / in the U.S.")

Row 5 checkboxes gate on **the dependent's own index** — a common
copy-paste bug is using `deps[0]` for all four slots. The "in the U.S."
checkbox should be `deps[n] !== undefined` (only checked when that slot
is occupied), not hardcoded `true`.

## Key conventions

### Date picker fields — always use the existing pattern

Use the project's `DatePicker` component (from `ustaxes/components/input`).
Form field type is **`Date | undefined`**, default is **`undefined`**.
Never use `Date | null` or `null` — that is not the project's pattern.

Reference implementation: `dateOfBirth` in `src/components/TaxPayer/SpouseAndDependent.tsx`.

```typescript
// Form interface
interface MyForm {
  someDate: Date | undefined
}
// Default
const blank: MyForm = { someDate: undefined }
// Submission — convert to ISO string for the action
someDate: formData.someDate?.toISOString() ?? ''
// UI
<DatePicker name="someDate" label="..." required={true}
  minDate={new Date(1900, 0, 1)} maxDate={new Date()} />
```

### `fillInstructions()` vs legacy `fields()`

Y2025 forms use named `fillInstructions()` (field name → value mapping).
Pre-Y2024 forms use positional `fields()` and the legacy bridge. When
adding a Y2025 form, always implement `fillInstructions()`.

### `formerSpouseSSN` (F1040 page 2)

The `SSN_ReadOrder[0].f2_22[0]` field is "If you made estimated tax
payments with your **former** spouse, enter their SSN." Leave it `undefined`
— do not put the current spouse's SSN here.

### `QualifyingInformation.livedInUS`

Default is `false` — user must explicitly check the box. Fallback in
`toDependentForm` is also `false` so existing records without the field
don't silently get checked.

### Date fields MUST use the `<D = Date>` generic — no exceptions

Every interface that contains a date field uses the `<D = Date>` generic
pattern. **Never store a date as a plain `string` field.**

```typescript
// WRONG — will crash at runtime with "toISOString is not a function"
export interface MyType {
  someDate: string
}

// RIGHT — follows the existing pattern
export interface MyType<D = Date> {
  someDate: D
}
export type MyTypeDateString = MyType<string>
```

The redux persist layer (`src/redux/store.ts`) scans all keys matching
`/(^date)|(Date)/` and calls `.toISOString()` on them. A plain `string`
field with a date-like key name will crash the serializer.

When you add a new type with dates, you must also:

1. Add the `DateString` alias: `export type MyTypeDateString = MyType<string>`
2. Use `MyType<D>` in `Information<D = Date>` so it propagates through
3. Add conversions in `src/redux/data.ts`:
   - `stringToDateInfo`: `someDate: new Date(m.someDate)`
   - `infoToStringInfo`: `someDate: m.someDate.toISOString()`
4. Use `MyTypeDateString` for the action creator and redux action type
   (reducer receives strings from the UI and converts to `Date`)
5. Use `MyTypeDateString` in `scripts/setup.ts` (e.g.
   `'#/definitions/MyTypeDateString'`, not `'#/definitions/MyType'`)

Reference implementations: `HealthSavingsAccount<D>`, `Asset<D>`,
`Dependent<D>`.

### Schema regen after data model changes

Any change to a type in `src/core/data/index.ts` that has a validator
needs `npx ts-node scripts/setup.ts` rerun to regenerate `validate-fns.js`.

## PDF field debugging tips

- `maxLength=2` → likely a rate/percentage or 2-digit code, never a dollar amount
- `maxLength=9` → SSN field
- No `maxLength`, no limit → name or dollar amount field
- Field order in the schema (`schemas/Y2025/<form>.json`) is the fill
  order, which may differ from visual order in the PDF
- `fillPDFByName` in `'strict'` mode throws immediately on any violation;
  use `'warn'` mode to collect all issues at once during debugging
