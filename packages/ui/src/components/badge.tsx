import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors select-none [&>svg]:size-3.5',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        outline: 'border border-border text-foreground bg-transparent',
        secondary: 'bg-secondary text-secondary-foreground border border-border/40',
        destructive: 'bg-destructive/20 text-[#ef4444] border border-destructive/40',
        error: 'bg-destructive/20 text-[#ef4444] border border-destructive/40',
        success: 'bg-success/20 text-[#4ade80] border border-success/40',
        warning: 'bg-[#d97706]/20 text-[#fbbf24] border border-[#d97706]/40',
        info: 'bg-primary/20 text-primary border border-primary/40',
      },
      size: {
        sm: 'px-2 py-0.2 text-[10px]',
        default: 'px-2.5 py-0.5 text-[11px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type BadgeProps = {} & HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>

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
