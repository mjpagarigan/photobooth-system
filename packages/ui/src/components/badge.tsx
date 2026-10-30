import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export const badgeVariants = cva(
  'inline-flex min-h-5 items-center gap-1 rounded-full px-1.5 py-0.5 font-sans text-xs font-semibold leading-4 tracking-normal transition-colors select-none [&>svg]:size-3.5',
  {
    variants: {
      variant: {
        default: 'bg-[#e8f2fd] text-[#00539f] border border-[#d6e8fb]',
        outline: 'border border-[#d2d2d7] text-[#1d1d1f] bg-white',
        secondary: 'bg-[#f5f5f7] text-[#424245] border border-[#e8e8ed]',
        destructive: 'bg-[#fdf3f4] text-[#d70015] border border-[#f1bbbc]',
        error: 'bg-[#fdf3f4] text-[#d70015] border border-[#f1bbbc]',
        success: 'bg-[#e3f5e7] text-[#1b6f30] border border-[#b5e2c0]',
        warning: 'bg-[#fff4ce] text-[#795e00] border border-[#ffe380]',
        info: 'bg-[#e8f2fd] text-[#00539f] border border-[#d6e8fb]',
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
  return <div className={cn(badgeVariants({ variant, size }), className)} ref={ref} {...props} />;
});
