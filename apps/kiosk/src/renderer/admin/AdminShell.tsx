import {
  ArrowLeftIcon as ArrowLeft,
  FrameCornersIcon as FrameCorners,
  GearIcon as Gear,
  ImagesIcon as Images,
  SignOutIcon as SignOut,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@grace-booth/ui';

import { BrandMark } from '../components/BrandMark';
import { Button } from '../components/Button';
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
          <BrandMark compact />
          <div className="admin-nav__title">
            <strong>Operator panel</strong>
            <span>Local booth controls</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'frame'}
                    onClick={() => onViewChange('frame')}
                  >
                    <FrameCorners aria-hidden="true" weight="bold" />
                    <span>Frame editor</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'gallery'}
                    onClick={() => onViewChange('gallery')}
                  >
                    <Images aria-hidden="true" weight="bold" />
                    <span>Recent photos</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'settings'}
                    onClick={() => onViewChange('settings')}
                  >
                    <Gear aria-hidden="true" weight="bold" />
                    <span>Settings &amp; health</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="admin-nav__exit">
          <Button
            icon={<ArrowLeft aria-hidden="true" weight="bold" />}
            onClick={onExit}
            variant="secondary"
            wide
          >
            Back to booth
          </Button>
          <span className="admin-nav__lock-note">
            <SignOut aria-hidden="true" weight="bold" />
            <span>ACCESS LOCKS ON DISMISSAL</span>
          </span>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="admin-workspace">{children}</SidebarInset>
    </SidebarProvider>
  );
}
