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
        'flex w-full rounded-[4px] border border-[#616161] bg-white px-3 font-sans text-sm leading-5 text-[#242424] shadow-none transition-[border-color,box-shadow,background-color] duration-100',
        'placeholder:text-[#616161]',
        'hover:border-[#424242] focus-visible:border-[#242424] focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-0 focus-visible:shadow-[0_0_0_2px_#000]',
        'disabled:cursor-not-allowed disabled:border-[#e0e0e0] disabled:bg-[#f0f0f0] disabled:text-[#bdbdbd]',
        'aria-[invalid=true]:border-[#c50f1f] aria-[invalid=true]:focus-visible:border-[#c50f1f]',
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
