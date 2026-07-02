import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

// Ref-counted body scroll lock, shared across all Dialog instances. Per-dialog
// save/restore would break if two dialogs ever stacked (the inner one would
// capture `overflow:hidden` from the outer and restore it on close, leaving the
// page locked). Counting keeps the original value and only restores it when the
// last dialog closes.
let scrollLockCount = 0
let savedBodyOverflow = ''
function lockBodyScroll() {
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}
function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow
  }
}

/**
 * Accessible modal primitive. Renders through a portal to document.body so it
 * escapes every in-app stacking context — this is what stops the z-0 `<main>`
 * column from trapping a modal beneath the z-10 sidebar (see ADR / plan).
 *
 * Behavior, in one place so no modal has to re-derive it:
 *  - portals to <body>; backdrop at z-modalBackdrop, panel at z-modal
 *  - focus moves into the panel on open and is restored to the trigger on close
 *  - Tab / Shift+Tab are trapped within the panel
 *  - Escape and backdrop click close it (both gated by `dismissible`)
 *  - body scroll is locked while open (ref-counted, stack-safe)
 *
 * The focus/scroll lifecycle is keyed ONLY on `open`. `dismissible` and
 * `onClose` are read through refs inside the key handler, so a caller that flips
 * `dismissible={!submitting}` on its primary action does NOT tear down and
 * re-run focus management (which would yank focus off the submit button).
 *
 * The panel's look (bg, border, radius, size) is the caller's `className` — the
 * primitive owns behavior and positioning only, so each modal keeps its design.
 *
 * @param {boolean} [open=true] - render when true; parents may also just unmount
 * @param {() => void} onClose
 * @param {'center'|'bottom'|'left'|'right'} [placement='center'] - 'left'/'right'
 *   anchor a full-height side drawer (used by the mobile sidebar / activity panels)
 * @param {boolean} [dismissible=true] - when false, Escape/backdrop won't close
 * @param {string} [label] - aria-label (used when labelledBy is absent)
 * @param {string} [labelledBy] - id of the element labeling the dialog
 * @param {React.RefObject} [initialFocusRef] - element to focus on open instead
 *   of the first focusable child (e.g. a textarea the user should type into)
 * @param {string} [className] - classes for the panel (size + visual styling)
 * @param {string} [backdropClassName] - extra classes for the backdrop
 */
export function Dialog({
  open = true,
  onClose,
  placement = 'center',
  dismissible = true,
  label,
  labelledBy,
  initialFocusRef,
  className = '',
  backdropClassName = '',
  children,
}) {
  const panelRef = useRef(null)
  const previouslyFocused = useRef(null)

  // Hold the latest dismissible/onClose so the key handler always sees current
  // values without those props being effect dependencies. Assigning during
  // render is the standard "latest value" ref pattern.
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const initialFocusRefRef = useRef(initialFocusRef)
  initialFocusRefRef.current = initialFocusRef

  useEffect(() => {
    if (!open) return undefined

    previouslyFocused.current = document.activeElement

    // Move focus into the panel: caller-chosen element, else first focusable
    // child, else the panel itself.
    const panel = panelRef.current
    const focusables = panel?.querySelectorAll(FOCUSABLE_SELECTOR)
    if (initialFocusRefRef.current?.current) initialFocusRefRef.current.current.focus()
    else if (focusables && focusables.length > 0) focusables[0].focus()
    else panel?.focus()

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (dismissibleRef.current) onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return

      const node = panelRef.current
      if (!node) return
      const f = node.querySelectorAll(FOCUSABLE_SELECTOR)
      if (f.length === 0) {
        // Nothing focusable inside — keep focus on the panel.
        e.preventDefault()
        node.focus()
        return
      }
      const first = f[0]
      const last = f[f.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !node.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    lockBodyScroll()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      unlockBodyScroll()
      const prev = previouslyFocused.current
      if (prev && typeof prev.focus === 'function') prev.focus()
    }
  }, [open])

  if (!open) return null

  const positionClasses = {
    bottom: 'fixed left-1/2 bottom-0 -translate-x-1/2 z-modal',
    left: 'fixed left-0 top-0 bottom-0 z-modal',
    right: 'fixed right-0 top-0 bottom-0 z-modal',
    center: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-modal',
  }[placement]

  return createPortal(
    <>
      <div
        data-dialog-backdrop=""
        className={`fixed inset-0 z-modalBackdrop ${backdropClassName || 'bg-black/60'}`}
        onClick={() => dismissible && onClose?.()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`${positionClasses} mc-panel-in ${className}`}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}
