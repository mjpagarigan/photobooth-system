import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export const alertVariants = cva(
  'relative w-full rounded-xl border p-4 text-sm font-sans flex items-start gap-3 shadow-sm [&>svg]:size-5 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-card text-foreground border-border/50 [&>svg]:text-muted-foreground',
        info: 'bg-card text-foreground border-primary/40 [&>svg]:text-primary',
        success: 'bg-card text-foreground border-success/40 [&>svg]:text-success',
        warning: 'bg-card text-foreground border-[#d97706]/40 [&>svg]:text-[#fbbf24]',
        error: 'bg-card text-foreground border-destructive/50 [&>svg]:text-destructive',
        destructive: 'bg-card text-foreground border-destructive/50 [&>svg]:text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type AlertProps = {} & HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { className, variant, children, ...props },
  ref,
) {
  return (
    <div
      aria-live="polite"
      className={cn(alertVariants({ variant }), className)}
      ref={ref}
      role="alert"
      {...props}
    >
      {children}
    </div>
  );
});

export const AlertTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  function AlertTitle({ className, ...props }, ref) {
    return (
      <h5
        className={cn('font-heading text-sm font-bold tracking-tight text-foreground', className)}
        ref={ref}
        {...props}
      />
    );
  },
);

export const AlertDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(function AlertDescription({ className, ...props }, ref) {
  return (
    <p
      className={cn('text-xs text-muted-foreground leading-relaxed mt-0.5', className)}
      ref={ref}
      {...props}
    />
  );
});

export function AlertAction({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('ml-auto flex shrink-0 items-center gap-2', className)}
      {...props}
    />
  );
}
