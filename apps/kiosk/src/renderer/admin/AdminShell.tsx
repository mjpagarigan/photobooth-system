import {
  ArrowLeftIcon as ArrowLeft,
  FrameCornersIcon as FrameCorners,
  GearIcon as Gear,
  ImagesIcon as Images,
  SignOutIcon as SignOut,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

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
    <main className="admin-shell" data-testid="admin-shell">
      <aside className="admin-nav" aria-label="Operator navigation">
        <BrandMark compact />
        <div className="admin-nav__title">
          <strong>OPERATOR PANEL</strong>
          <span>M.A.T. // LOCAL TELEMETRY</span>
        </div>
        <nav>
          <button
            className={view === 'frame' ? 'is-active' : ''}
            onClick={() => onViewChange('frame')}
            aria-current={view === 'frame' ? 'page' : undefined}
          >
            <FrameCorners aria-hidden="true" weight="bold" />
            <span>FRAME EDITOR</span>
          </button>
          <button
            className={view === 'gallery' ? 'is-active' : ''}
            onClick={() => onViewChange('gallery')}
            aria-current={view === 'gallery' ? 'page' : undefined}
          >
            <Images aria-hidden="true" weight="bold" />
            <span>RECENT PHOTOS</span>
          </button>
          <button
            className={view === 'settings' ? 'is-active' : ''}
            onClick={() => onViewChange('settings')}
            aria-current={view === 'settings' ? 'page' : undefined}
          >
            <Gear aria-hidden="true" weight="bold" />
            <span>SETTINGS &amp; HEALTH</span>
          </button>
        </nav>
        <div className="admin-nav__exit">
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
        </div>
      </aside>
      <section className="admin-workspace">{children}</section>
    </main>
  );
}
