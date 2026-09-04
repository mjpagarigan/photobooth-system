import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return (
      <div
        className={cn(
          'flex flex-col rounded-[4px] border border-[#e0e0e0] bg-white text-[#242424] shadow-[var(--shadow-2)]',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);

export function CardHeader({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col gap-1 p-4', className)} {...props}>
      {children}
    </div>
  );
}

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, ...props }, ref) {
    return (
      <h3
        className={cn('font-heading text-base font-semibold leading-[22px] tracking-normal text-[#242424]', className)}
        ref={ref}
        {...props}
      />
    );
  },
);

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return (
    <p
      className={cn('text-sm leading-5 text-[#616161]', className)}
      ref={ref}
      {...props}
    />
  );
});

export function CardPanel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex-1 p-4 pt-0', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center p-4 pt-0', className)}
      {...props}
    >
      {children}
    </div>
  );
}
