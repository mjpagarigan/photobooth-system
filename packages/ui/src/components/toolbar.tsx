import { Toolbar as BaseToolbar } from '@base-ui/react';
import React, { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Toolbar = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseToolbar.Root>
>(function Toolbar({ className, ...props }, ref) {
  return (
    <BaseToolbar.Root
      className={cn('flex items-center gap-2', className)}
      ref={ref}
      {...props}
    />
  );
});

export const ToolbarButton = BaseToolbar.Button;

export const ToolbarGroup = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseToolbar.Group>
>(function ToolbarGroup({ className, ...props }, ref) {
  return (
    <BaseToolbar.Group
      className={cn('flex items-center gap-1.5', className)}
      ref={ref}
      {...props}
    />
  );
});

export const ToolbarSeparator = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseToolbar.Separator>
>(function ToolbarSeparator({ className, ...props }, ref) {
  return (
    <BaseToolbar.Separator
      className={cn('mx-1 h-5 w-px shrink-0 bg-[#e8e8ed]', className)}
      ref={ref}
      {...props}
    />
  );
});
