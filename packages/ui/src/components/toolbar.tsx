import { Toolbar as BaseToolbar } from '@base-ui/react';
import React, { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Toolbar = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseToolbar.Root>
>(function Toolbar({ className, ...props }, ref) {
  return (
    <BaseToolbar.Root
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border/40 bg-card p-1.5 text-card-foreground shadow-sm',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export const ToolbarButton = BaseToolbar.Button;

export function ToolbarGroup({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center gap-1.5', className)} {...props}>
      {children}
    </div>
  );
}

export function ToolbarSeparator({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('h-5 w-px bg-border/40 my-auto', className)}
      {...props}
    />
  );
}
