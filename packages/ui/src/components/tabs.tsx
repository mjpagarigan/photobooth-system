import { Tabs as BaseTabs } from '@base-ui/react';
import React, { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Tabs = BaseTabs.Root;

export type TabsListProps = {
  variant?: 'default' | 'underline' | 'segmented';
  size?: 'sm' | 'default' | 'lg';
} & React.ComponentPropsWithoutRef<typeof BaseTabs.List>

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(function TabsList(
  { className, variant = 'default', size = 'default', ...props },
  ref,
) {
  return (
    <BaseTabs.List
      className={cn(
        'inline-flex items-center gap-1 rounded-lg bg-secondary/80 p-1 text-muted-foreground border border-border/40',
        variant === 'underline' && 'rounded-none bg-transparent p-0 border-b border-border/60 gap-4',
        variant === 'segmented' && 'w-full grid grid-flow-col auto-cols-fr bg-secondary p-1 rounded-lg',
        size === 'sm' && 'h-9 text-xs',
        size === 'default' && 'h-11 text-sm',
        size === 'lg' && 'h-13 text-base',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export type TabsTabProps = {
  size?: 'sm' | 'default' | 'lg';
} & React.ComponentPropsWithoutRef<typeof BaseTabs.Tab>

export const TabsTab = forwardRef<HTMLButtonElement, TabsTabProps>(function TabsTab(
  { className, size, ...props },
  ref,
) {
  return (
    <BaseTabs.Tab
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3.5 py-1.5 font-sans font-semibold tracking-wide transition-all cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
        'data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm',
        'hover:text-foreground',
        size === 'sm' && 'px-2.5 py-1 text-xs',
        size === 'default' && 'px-3.5 py-1.5 text-sm',
        size === 'lg' && 'px-5 py-2 text-base',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export const TabsPanel = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseTabs.Panel>
>(function TabsPanel({ className, ...props }, ref) {
  return (
    <BaseTabs.Panel
      className={cn('flex-1 focus-visible:outline-none', className)}
      ref={ref}
      {...props}
    />
  );
});
