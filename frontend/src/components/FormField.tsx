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
      <label className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">{label}</label>
      {children}
      {hint && <p className="text-2xs text-zinc-400 mt-1">{hint}</p>}
    </div>
  )
}

const INPUT_CLS = 'w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent'

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
