import { createRoot } from 'react-dom/client';
import { GraceBoothFluentProvider } from '@grace-booth/ui';
import { App } from './App';
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Application root is unavailable');

createRoot(root).render(
  <GraceBoothFluentProvider>
    <App />
  </GraceBoothFluentProvider>,
);
