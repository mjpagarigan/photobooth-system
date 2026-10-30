import type { ReactNode } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@grace-booth/ui';

import type { AdminView } from '../types';

type AdminShellProps = {
  children: ReactNode;
  onExit: () => void;
  onViewChange: (view: AdminView) => void;
  view: AdminView;
};

export function AdminShell({ children, onExit, onViewChange, view }: AdminShellProps) {
  return (
    <SidebarProvider className="admin-shell" data-testid="admin-shell">
      <Sidebar aria-label="Operator navigation" className="admin-nav">
        <SidebarHeader className="admin-nav__header">
          <div className="admin-nav__title">
            <strong>M.A.T. Photobooth</strong>
            <span>Operator</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'frame'}
                    onClick={() => onViewChange('frame')}
                  >
                    <span>Frame editor</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'gallery'}
                    onClick={() => onViewChange('gallery')}
                  >
                    <span>Recent photos</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'settings'}
                    onClick={() => onViewChange('settings')}
                  >
                    <span>Settings &amp; health</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="admin-nav__exit">
          <button className="admin-nav__back" onClick={onExit} type="button">
            Back to booth
          </button>
          <span className="admin-nav__lock-note">Access locks when you leave.</span>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="admin-workspace">{children}</SidebarInset>
    </SidebarProvider>
  );
}
