import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export const alertVariants = cva(
  'relative w-full rounded-[14px] border p-4 text-sm font-sans flex items-start gap-3 shadow-none [&>svg]:size-5 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-white text-[#1d1d1f] border-[#e8e8ed] [&>svg]:text-[#636366]',
        info: 'bg-[#e8f2fd] text-[#1d1d1f] border-[#d6e8fb] [&>svg]:text-[#0066cc]',
        success: 'bg-[#e3f5e7] text-[#1d1d1f] border-[#b5e2c0] [&>svg]:text-[#1b6f30]',
        warning: 'bg-[#fff6e5] text-[#1d1d1f] border-[#ffd699] [&>svg]:text-[#8a5a00]',
        error: 'bg-[#ffecee] text-[#1d1d1f] border-[#ffccd1] [&>svg]:text-[#d70015]',
        destructive: 'bg-[#ffecee] text-[#1d1d1f] border-[#ffccd1] [&>svg]:text-[#d70015]',
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
