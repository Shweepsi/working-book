import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initSync } from './lib/sync';
import { ToastProvider } from './lib/toast';
import './styles/tokens.css';
import './styles/app.css';
// Screen-only restyle of the Schedule view; never reaches the aperçu or paper.
import './styles/schedule.css';

initSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
