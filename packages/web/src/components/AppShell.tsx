import { useEffect, useId, useState } from 'react';
import { cn } from '../lib/cn';
import './AppShell.css';

interface AppShellProps {
  sidebar: (opts: { onNavigate: () => void }) => React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({ sidebar, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  useEffect(() => {
    document.body.classList.toggle('app-shell-lock-scroll', sidebarOpen);
    return () => document.body.classList.remove('app-shell-lock-scroll');
  }, [sidebarOpen]);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="app-shell">
      <div className="app-shell__desktop-sidebar">{sidebar({ onNavigate: closeSidebar })}</div>

      <div
        className={cn('app-shell__mobile-drawer', sidebarOpen && 'app-shell__mobile-drawer--open')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!sidebarOpen}
      >
        <button
          type="button"
          className="app-shell__scrim"
          onClick={closeSidebar}
          aria-label="Close navigation"
          tabIndex={sidebarOpen ? 0 : -1}
        />
        <div className="app-shell__drawer-panel">
          <div className="app-shell__drawer-header">
            <span id={titleId} className="section-header">
              Navigation
            </span>
            <button
              type="button"
              className="app-shell__icon-button"
              onClick={closeSidebar}
              aria-label="Close navigation"
              tabIndex={sidebarOpen ? 0 : -1}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          {sidebar({ onNavigate: closeSidebar })}
        </div>
      </div>

      <main className="app-shell__main">
        <button
          type="button"
          className="app-shell__menu-button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open navigation"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
          >
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
        {children}
      </main>
    </div>
  );
}

interface ResponsiveSidePanelProps {
  open?: boolean;
  onClose?: () => void;
  labelledBy?: string;
  children: React.ReactNode;
}

export function ResponsiveSidePanel({
  open = true,
  onClose,
  labelledBy,
  children,
}: ResponsiveSidePanelProps) {
  if (!open) return null;

  return (
    <div className="app-side-panel" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <button
        type="button"
        className="app-side-panel__mobile-close"
        onClick={onClose}
        aria-label="Close panel"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
      </button>
      {children}
    </div>
  );
}
