import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { QrStationScreen } from './screens/QrStationScreen';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('M.A.T. Photobooth renderer root is unavailable');
}

const params = new URLSearchParams(window.location.search);
const isQrStation = params.get('view') === 'qr-station';

createRoot(rootElement).render(
  <StrictMode>{isQrStation ? <QrStationScreen /> : <App />}</StrictMode>,
);
