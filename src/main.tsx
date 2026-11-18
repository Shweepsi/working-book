import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initSync } from './lib/sync';
import { ToastProvider } from './lib/toast';
import './styles/tokens.css';
import './styles/app.css';
import './styles/style-2027.css';

initSync();

// The style is on <html> before React renders, so a tablet that opens in 2027
// doesn't flash the classic look first. App keeps it in step afterwards.
try {
  if (JSON.parse(window.localStorage.getItem('wb.style') ?? 'null') === '2027') {
    document.documentElement.setAttribute('data-style', '2027');
  }
} catch {
  /* storage blocked or unreadable — the classic look is the default anyway */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
