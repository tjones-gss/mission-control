import { useRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog } from '../../components/ui/Dialog.jsx'

function renderDialog(props = {}) {
  return render(
    <Dialog onClose={props.onClose || vi.fn()} label="Test dialog" {...props}>
      {props.children ?? (
        <div>
          <button>first</button>
          <button>last</button>
        </div>
      )}
    </Dialog>,
  )
}

describe('Dialog — portal (overlap regression)', () => {
  it('renders the panel as a child of document.body, not inside the render container', () => {
    const { container } = renderDialog()
    // The portal escapes the app tree — this is what frees a modal from the
    // z-0 <main> stacking context so the z-10 sidebar can no longer cover it.
    expect(container).toBeEmptyDOMElement()
    const panel = screen.getByRole('dialog')
    expect(panel.closest('body')).toBe(document.body)
    expect(container.contains(panel)).toBe(false)
  })

  it('does not render when open is false', () => {
    renderDialog({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Dialog — accessibility', () => {
  it('exposes role=dialog and aria-modal', () => {
    renderDialog()
    const panel = screen.getByRole('dialog')
    expect(panel).toHaveAttribute('aria-modal', 'true')
    expect(panel).toHaveAttribute('aria-label', 'Test dialog')
  })

  it('uses aria-labelledby when provided instead of aria-label', () => {
    renderDialog({ labelledBy: 'title-1' })
    const panel = screen.getByRole('dialog')
    expect(panel).toHaveAttribute('aria-labelledby', 'title-1')
    expect(panel).not.toHaveAttribute('aria-label')
  })

  it('moves focus to the first focusable element on open', () => {
    renderDialog()
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('focuses initialFocusRef on open when provided', () => {
    function WithInitialFocus() {
      const ref = useRef(null)
      return (
        <Dialog onClose={vi.fn()} label="x" initialFocusRef={ref}>
          <button>first</button>
          <input ref={ref} aria-label="target" />
        </Dialog>
      )
    }
    render(<WithInitialFocus />)
    expect(screen.getByLabelText('target')).toHaveFocus()
  })

  it('restores focus to the previously focused element on close', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'trigger'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(trigger).toHaveFocus()

    const { unmount } = renderDialog()
    expect(screen.getByText('first')).toHaveFocus()

    unmount()
    expect(trigger).toHaveFocus()
    document.body.removeChild(trigger)
  })
})

describe('Dialog — focus stability', () => {
  // Regression: modals that pass dismissible={!submitting} flip dismissible on
  // their primary action. The focus lifecycle must NOT re-run and yank focus off
  // the just-clicked submit button back into the dialog.
  it('does not steal focus when dismissible flips (submit path)', () => {
    function Wrapper({ dismissible }) {
      return (
        <Dialog onClose={vi.fn()} label="x" dismissible={dismissible}>
          <button>first</button>
          <button>submit</button>
        </Dialog>
      )
    }
    const { rerender } = render(<Wrapper dismissible={true} />)
    const submit = screen.getByText('submit')
    submit.focus()
    expect(submit).toHaveFocus()

    rerender(<Wrapper dismissible={false} />)
    expect(submit).toHaveFocus()
  })
})

describe('Dialog — focus trap', () => {
  it('wraps Tab from the last focusable back to the first', () => {
    renderDialog()
    const last = screen.getByText('last')
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('wraps Shift+Tab from the first focusable to the last', () => {
    renderDialog()
    const first = screen.getByText('first')
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByText('last')).toHaveFocus()
  })
})

describe('Dialog — dismissal', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on backdrop click', () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    fireEvent.click(document.querySelector('[data-dialog-backdrop]'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on Escape or backdrop click when dismissible is false', () => {
    const onClose = vi.fn()
    renderDialog({ onClose, dismissible: false })
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('[data-dialog-backdrop]'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Dialog — scroll lock', () => {
  it('locks body scroll while open and restores it on close', () => {
    expect(document.body.style.overflow).toBe('')
    const { unmount } = renderDialog()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})

describe('Dialog — placement', () => {
  it('anchors to the bottom when placement is "bottom"', () => {
    renderDialog({ placement: 'bottom' })
    expect(screen.getByRole('dialog').className).toContain('bottom-0')
  })
})
