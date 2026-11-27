import { Field as BaseField } from '@base-ui/react';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export type InputProps = {
  inputSize?: 'sm' | 'default' | 'lg';
} & InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, inputSize = 'default', type = 'text', ...props },
  ref,
) {
  return (
    <BaseField.Control
      className={cn(
        'flex w-full rounded-[12px] border border-[#d2d2d7] bg-white px-3 font-sans text-sm leading-5 text-[#1d1d1f] shadow-none transition-[border-color,box-shadow,background-color] duration-100',
        'placeholder:text-[#636366]',
        'hover:border-[#86868b] focus-visible:border-primary focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
        'disabled:cursor-not-allowed disabled:border-[#e8e8ed] disabled:bg-[#f5f5f7] disabled:text-[#aeaeb2]',
        'aria-[invalid=true]:border-[#d70015] aria-[invalid=true]:focus-visible:border-[#d70015]',
        inputSize === 'sm' && 'h-8 px-2.5 text-sm',
        inputSize === 'default' && 'h-10 px-3 text-sm min-h-[40px]',
        inputSize === 'lg' && 'h-12 px-4 text-base min-h-[48px]',
        className,
      )}
      ref={ref}
      render={<input type={type} />}
      {...props}
    />
  );
});
