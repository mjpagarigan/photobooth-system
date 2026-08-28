import { Field as BaseField } from '@base-ui/react';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export type InputProps = {
  inputSize?: 'sm' | 'default' | 'lg';
} & InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, inputSize = 'default', type = 'text', ...props },
  ref,
) {
  return (
    <BaseField.Control
      className={cn(
        'flex w-full rounded-md border border-border bg-card px-3.5 font-sans text-sm text-foreground shadow-sm transition-colors',
        'placeholder:text-muted-foreground/60',
        'focus-visible:outline-2 focus-visible:outline-ring focus-visible:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:outline-destructive',
        inputSize === 'sm' && 'h-9 px-2.5 text-xs',
        inputSize === 'default' && 'h-11 px-3.5 text-sm min-h-[44px]',
        inputSize === 'lg' && 'h-14 px-4 text-base min-h-[56px]',
        className,
      )}
      ref={ref}
      render={<input type={type} />}
      {...props}
    />
  );
});
