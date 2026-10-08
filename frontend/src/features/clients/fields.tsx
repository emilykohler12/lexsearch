import { useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldProps {
  label: string;
  /** The AI filled this in: it stands out until the lawyer edits it. */
  suggested?: boolean;
  className?: string;
}

export function TextField({
  label,
  suggested = false,
  className,
  ...input
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} className="input" data-suggested={suggested} {...input} />
    </div>
  );
}

export function TextAreaField({
  label,
  suggested = false,
  className,
  ...input
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <textarea id={id} className="input resize-y leading-relaxed" data-suggested={suggested} {...input} />
    </div>
  );
}

export function SelectField({
  label,
  suggested = false,
  className,
  children,
  ...select
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} className="input" data-suggested={suggested} {...select}>
        {children}
      </select>
    </div>
  );
}
