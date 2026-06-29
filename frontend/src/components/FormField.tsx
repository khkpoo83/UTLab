import React from 'react'

interface FormFieldProps {
  label: string
  children: React.ReactNode
  className?: string
  hint?: string
}

/** 공통 폼 필드 래퍼 (label + input/textarea 등) */
export function FormField({ label, children, className = '', hint }: FormFieldProps) {
  return (
    <div className={className}>
      <label className="text-xs text-ink-3 block mb-1">{label}</label>
      {children}
      {hint && <p className="text-2xs text-ink-4 mt-1">{hint}</p>}
    </div>
  )
}

const INPUT_CLS = 'w-full px-3 py-2 text-sm border border-ink-5 rounded-lg bg-white dark:bg-zinc-800 text-ink-0 placeholder-ink-4 focus:outline-none focus:ring-2 focus:ring-accent'

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  wrapperClassName?: string
}

/** label + input 한 세트 */
export function FormInput({ label, hint, wrapperClassName, className, ...props }: FormInputProps) {
  if (!label) {
    return <input className={`${INPUT_CLS} ${className ?? ''}`} {...props} />
  }
  return (
    <FormField label={label} className={wrapperClassName} hint={hint}>
      <input className={`${INPUT_CLS} ${className ?? ''}`} {...props} />
    </FormField>
  )
}

interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  wrapperClassName?: string
}

/** label + textarea 한 세트 */
export function FormTextarea({ label, hint, wrapperClassName, className, ...props }: FormTextareaProps) {
  const el = (
    <textarea
      className={`${INPUT_CLS} resize-none ${className ?? ''}`}
      {...props}
    />
  )
  if (!label) return el
  return (
    <FormField label={label} className={wrapperClassName} hint={hint}>
      {el}
    </FormField>
  )
}
