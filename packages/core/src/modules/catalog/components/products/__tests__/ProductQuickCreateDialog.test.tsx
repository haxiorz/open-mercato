/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockApiCall = jest.fn()
const mockCreateCrud = jest.fn()
const mockFlash = jest.fn()

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverMock,
})

type MockSubmitter = {
  id?: string
  name?: string
  value?: string
  dataset: Record<string, string>
}

type MockSubmitContext = {
  submitter?: MockSubmitter
}

type MockCustomFieldProps = {
  id: string
  value: unknown
  values: Record<string, unknown>
  setValue: (value: unknown) => void
  setFormValue: (id: string, value: unknown) => void
  disabled: boolean
}

type MockField = {
  id: string
  label: string
  type: string
  placeholder?: string
  component?: (props: MockCustomFieldProps) => React.ReactNode
}

type MockCrudFormProps = {
  formId?: string
  fields: MockField[]
  initialValues?: Record<string, unknown>
  onSubmit?: (
    values: Record<string, unknown>,
    context?: MockSubmitContext,
  ) => Promise<void> | void
}

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({
    formId,
    fields,
    initialValues,
    onSubmit,
  }: MockCrudFormProps) => {
    const [values, setValues] = React.useState<Record<string, unknown>>(
      () => ({ ...(initialValues ?? {}) }),
    )
    const setFormValue = React.useCallback((id: string, value: unknown) => {
      setValues((current) => ({ ...current, [id]: value }))
    }, [])

    return (
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          const nativeSubmitter = (event.nativeEvent as SubmitEvent).submitter
          const submitter =
            nativeSubmitter instanceof HTMLElement
              ? {
                  id: nativeSubmitter.id || undefined,
                  name:
                    'name' in nativeSubmitter && typeof nativeSubmitter.name === 'string'
                      ? nativeSubmitter.name
                      : undefined,
                  value:
                    'value' in nativeSubmitter && typeof nativeSubmitter.value === 'string'
                      ? nativeSubmitter.value
                      : undefined,
                  dataset: Object.fromEntries(
                    Object.entries(nativeSubmitter.dataset).filter(
                      (entry): entry is [string, string] =>
                        typeof entry[1] === 'string',
                    ),
                  ),
                }
              : undefined
          void onSubmit?.(values, submitter ? { submitter } : undefined)
        }}
      >
        {fields.map((field) => (
          <div key={field.id}>
            {field.label ? <label>{field.label}</label> : null}
            {field.type === 'text' ? (
              <input
                aria-label={field.label}
                placeholder={field.placeholder}
                value={typeof values[field.id] === 'string' ? values[field.id] : ''}
                onChange={(event) => setFormValue(field.id, event.target.value)}
              />
            ) : null}
            {field.type === 'textarea' ? (
              <textarea
                aria-label={field.label}
                placeholder={field.placeholder}
                value={typeof values[field.id] === 'string' ? values[field.id] : ''}
                onChange={(event) => setFormValue(field.id, event.target.value)}
              />
            ) : null}
            {field.type === 'custom' && field.component
              ? field.component({
                  id: field.id,
                  value: values[field.id],
                  values,
                  setValue: (value) => setFormValue(field.id, value),
                  setFormValue,
                  disabled: false,
                })
              : null}
          </div>
        ))}
      </form>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/inputs/LookupSelect', () => ({
  LookupSelect: ({
    onChange,
    selectLabel,
  }: {
    onChange: (value: string | null) => void
    selectLabel?: string
  }) => (
    <button type="button" onClick={() => onChange('category-1')}>
      {selectLabel ?? 'Select category'}
    </button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/amount-input', () => ({
  AmountInput: ({
    value,
    onChange,
    'aria-label': ariaLabel,
  }: {
    value: { amount: string; currency: string }
    onChange: (value: { amount: string; currency: string }) => void
    'aria-label'?: string
  }) => (
    <input
      aria-label={ariaLabel}
      value={value.amount}
      onChange={(event) => onChange({ ...value, amount: event.target.value })}
    />
  ),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open === false ? null : <>{children}</>,
  DialogContent: ({
    children,
    onKeyDown,
  }: {
    children: React.ReactNode
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  }) => <div onKeyDown={onKeyDown}>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({
    children,
    leading,
  }: {
    children: React.ReactNode
    leading?: React.ReactNode
  }) => (
    <div>
      {leading}
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import { ProductQuickCreateDialog } from '../ProductQuickCreateDialog'

function setFeatureAccess(allowed: boolean) {
  mockApiCall.mockImplementation(async (input: unknown) => {
    if (input === '/api/auth/feature-check') {
      return {
        ok: true,
        result: {
          ok: allowed,
          granted: allowed ? ['catalog.pricing.manage'] : [],
        },
      }
    }
    if (input === '/api/catalog/dictionaries/unit') {
      return {
        ok: true,
        result: {
          entries: [
            { value: 'hour', label: 'Per hour' },
            { value: 'project', label: 'Per project' },
          ],
        },
      }
    }
    return { ok: true, result: { items: [] } }
  })
}

function renderDialog() {
  const onCreated = jest.fn()
  const onOpenChange = jest.fn()
  const rendered = render(
    <ProductQuickCreateDialog
      open
      onOpenChange={onOpenChange}
      onCreated={onCreated}
    />,
  )
  return { ...rendered, onCreated, onOpenChange }
}

describe('ProductQuickCreateDialog', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockCreateCrud.mockReset()
    mockFlash.mockReset()
    setFeatureAccess(true)
    mockCreateCrud.mockResolvedValue({
      result: { id: 'product-1', basePriceApplied: true },
    })
  })

  it('swaps type-adaptive fields while preserving common values', async () => {
    renderDialog()

    await screen.findByText('Base price')
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), {
      target: { value: 'Common product name' },
    })
    expect(screen.getByText('Stock and barcodes are managed after creation.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Service' }))
    expect(await screen.findByText('Billing unit')).toBeInTheDocument()
    expect(screen.queryByText('Stock and barcodes are managed after creation.')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue(
      'Common product name',
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Subscription' }))
    expect(screen.getByText('Plan code')).toBeInTheDocument()
    expect(screen.getByText('Monthly price')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Configure billing cycles, trials, seats, and entitlements in the follow-up plans phase.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Billing unit')).not.toBeInTheDocument()
  })

  it('uses active for publish and draft for save-as-draft submissions', async () => {
    const first = renderDialog()
    await screen.findByText('Base price')
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), {
      target: { value: 'Published product' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publish product' }))

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalledTimes(1))
    expect(mockCreateCrud.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ lifecycleState: 'active' }),
    )

    first.unmount()
    mockCreateCrud.mockClear()
    renderDialog()
    await screen.findByText('Base price')
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), {
      target: { value: 'Draft product' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalledTimes(1))
    expect(mockCreateCrud.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ lifecycleState: 'draft' }),
    )
  })

  it('submits category and base price in the same create call', async () => {
    renderDialog()
    await screen.findByText('Base price')
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), {
      target: { value: 'Oak Lounge Chair' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Select category' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Base price' }), {
      target: { value: '1290.00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publish product' }))

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalledTimes(1))
    expect(mockCreateCrud).toHaveBeenCalledWith(
      'catalog/products',
      expect.objectContaining({
        categoryIds: ['category-1'],
        basePrice: {
          unitPriceNet: '1290.00',
          currencyCode: 'PLN',
        },
      }),
    )
  })

  it('hides price inputs and shows the pricing-locked alert without permission', async () => {
    setFeatureAccess(false)
    renderDialog()

    expect(
      await screen.findByText(
        'You need catalog pricing permission to set a price during creation.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Base price' })).not.toBeInTheDocument()
  })

  it('shows an informational flash when an entered base price was not applied', async () => {
    mockCreateCrud.mockResolvedValue({
      result: { id: 'product-1', basePriceApplied: false },
    })
    renderDialog()
    await screen.findByText('Base price')
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), {
      target: { value: 'Unpriced product' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Base price' }), {
      target: { value: '49.00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publish product' }))

    await waitFor(() =>
      expect(mockFlash).toHaveBeenCalledWith(
        'The product was created, but no regular price kind is available for its base price.',
        'info',
      ),
    )
  })
})
