import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../lib/utils';

type SidebarContextType = {
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextType | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}

export function SidebarProvider({
  children,
  defaultExpanded = true,
  className,
  ...props
}: {
  defaultExpanded?: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);
  const value = useMemo(() => ({ expanded, setExpanded, toggle }), [expanded, toggle]);

  return (
    <SidebarContext.Provider value={value}>
      <div data-slot="sidebar-provider" className={cn('flex h-full w-full overflow-hidden', className)} {...props}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <aside
      data-slot="sidebar"
      className={cn(
        'relative flex h-full w-72 flex-col shrink-0 border-r border-[#e8e8ed] bg-[#f5f5f7] text-[#1d1d1f] transition-all duration-200 select-none z-20',
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

export function SidebarHeader({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="sidebar-header" className={cn('flex flex-col gap-1.5 px-4 pt-5 pb-3', className)} {...props}>
      {children}
    </div>
  );
}

export function SidebarContent({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-sidebar="content" data-slot="sidebar-content" className={cn('flex flex-1 flex-col overflow-y-auto px-3 py-2 gap-4', className)} {...props}>
      {children}
    </div>
  );
}

export function SidebarGroup({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="sidebar-group" className={cn('flex flex-col gap-1', className)} {...props}>
      {children}
    </div>
  );
}

export function SidebarGroupLabel({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'px-3 py-1 font-sans text-xs font-semibold tracking-normal text-[#636366]',
        className,
      )}
      data-slot="sidebar-group-label"
      {...props}
    >
      {children}
    </span>
  );
}

export function SidebarGroupContent({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-sidebar="group-content" data-slot="sidebar-group-content" className={cn('flex flex-col gap-1', className)} {...props}>
      {children}
    </div>
  );
}

export function SidebarMenu({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul data-slot="sidebar-menu" className={cn('flex flex-col gap-1 list-none p-0 m-0', className)} {...props}>
      {children}
    </ul>
  );
}

export function SidebarMenuItem({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLLIElement>) {
  return (
    <li data-slot="sidebar-menu-item" className={cn('list-none p-0 m-0', className)} {...props}>
      {children}
    </li>
  );
}

export type SidebarMenuButtonProps = {
  isActive?: boolean;
  render?: ReactElement<{ className?: string; children?: ReactNode }>;
  disabled?: boolean;
} & HTMLAttributes<HTMLButtonElement>

export const SidebarMenuButton = forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  function SidebarMenuButton({ children, className, isActive, render, disabled, ...props }, ref) {
    const classNames = cn(
      'flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 font-sans text-sm font-medium tracking-normal transition-colors cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2',
      isActive
        ? 'bg-white text-[#1d1d1f] font-semibold shadow-[var(--shadow-2)]'
        : 'text-[#424245] hover:bg-[#e8e8ed] hover:text-[#1d1d1f] active:bg-[#e8e8ed]',
      disabled && 'pointer-events-none opacity-50',
      className,
    );

    if (render) {
      return React.cloneElement(render, {
        className: cn(classNames, render.props.className),
        children,
        ...props,
      });
    }

    return (
      <button
        aria-current={isActive ? 'page' : undefined}
        className={classNames}
        data-active={isActive ? 'true' : 'false'}
        data-sidebar="menu-button"
        data-slot="sidebar-menu-button"
        disabled={disabled}
        ref={ref}
        type="button"
        {...props}
      >
        {children}
      </button>
    );
  },
);

export function SidebarFooter({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-auto flex flex-col gap-2 p-4 border-t border-[#e8e8ed]', className)}
      data-slot="sidebar-footer"
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarInset({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <main data-slot="sidebar-inset" className={cn('flex min-w-0 flex-1 flex-col overflow-hidden bg-background', className)} {...props}>
      {children}
    </main>
  );
}
