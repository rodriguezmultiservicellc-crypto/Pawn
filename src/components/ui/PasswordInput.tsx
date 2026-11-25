'use client'

import { useState } from 'react'
import { Eye, EyeSlash } from '@phosphor-icons/react'

/**
 * A password field with an eye button that shows or hides what was typed —
 * on a phone it is easy to mistype a password you cannot see (Eddy,
 * 2026-11-25). The button never submits the form and is skipped by Tab
 * order only in the sense that it comes right after the field.
 */
export function PasswordInput({
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  className,
  showLabel,
  hideLabel,
}: {
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  required?: boolean
  minLength?: number
  /** The field's own classes; room is kept on the right for the eye. */
  className: string
  showLabel: string
  hideLabel: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={`${className} pr-12`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        title={visible ? hideLabel : showLabel}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted transition-colors hover:text-foreground focus:outline-none focus-visible:text-blue"
      >
        {visible ? <EyeSlash size={20} /> : <Eye size={20} />}
      </button>
    </div>
  )
}
