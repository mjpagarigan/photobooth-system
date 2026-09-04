import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export const badgeVariants = cva(
  'inline-flex min-h-5 items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-sans text-xs font-semibold leading-4 tracking-normal transition-colors select-none [&>svg]:size-3.5',
  {
    variants: {
      variant: {
        default: 'bg-[#ebf3fc] text-[#0f548c] border border-[#cfe4fa]',
        outline: 'border border-[#d1d1d1] text-[#242424] bg-white',
        secondary: 'bg-[#f5f5f5] text-[#424242] border border-[#e0e0e0]',
        destructive: 'bg-[#fdf3f4] text-[#c50f1f] border border-[#f1bbbc]',
        error: 'bg-[#fdf3f4] text-[#c50f1f] border border-[#f1bbbc]',
        success: 'bg-[#dff6dd] text-[#107c41] border border-[#b2e5b8]',
        warning: 'bg-[#fff4ce] text-[#795e00] border border-[#ffe380]',
        info: 'bg-[#ebf3fc] text-[#0f548c] border border-[#cfe4fa]',
      },
      size: {
        sm: 'min-h-4 px-1 text-[10px] leading-3',
        default: 'min-h-5 px-1.5 py-0.5 text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type BadgeProps = {} & HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

export const Badge = forwardRef<HTMLDivElement, BadgeProps>(function Badge(
  { className, variant, size, ...props },
  ref,
) {
  return (
    <div
      className={cn(badgeVariants({ variant, size }), className)}
      ref={ref}
      {...props}
    />
  );
});
