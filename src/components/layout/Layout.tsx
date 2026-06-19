import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { usePeriods } from '../../hooks/usePeriods';
import { usePlatform } from '../../context/PlatformContext';
import './Layout.css';

/** Map of route paths to page titles */
const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/products': 'Products',
  '/financials': 'Financials',
  '/orders': 'Orders',
  '/upload': 'Upload Data',
  '/settings': 'Settings',
};

export function Layout() {
  // Fetch periods on app mount — populates PeriodContext
  usePeriods();
  const location = useLocation();
  const { platform } = usePlatform();
  const title = PAGE_TITLES[location.pathname] ?? 'Dashboard';

  // Update document title
  document.title = `${title} — ${platform === 'shopify' ? 'Shopify' : 'Amazon'} Sales Dashboard`;

  return (
    <div className="layout">
      <Sidebar />
      <div className="layout-main">
        <TopBar title={title} />
        <main className="layout-content" role="main">
          <div className="fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
