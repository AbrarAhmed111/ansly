import { gradients, linearGradient } from '@ansly/design';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { themeCss } from '@/lib/theme-css';
import App from './App.tsx';
import './style.css';

// Colour tokens from @ansly/design, shared with the web app.
const tokens = document.createElement('style');
tokens.textContent = `${themeCss({
  selector: ':root',
  forcedDark: ':root[data-theme="dark"]',
  systemDark: ':root[data-theme="system"]',
})}\n:root { --brand-gradient: ${linearGradient(gradients.brand)}; }`;
document.head.append(tokens);
// Follows the OS until settings load; App then applies the saved theme.
document.documentElement.dataset.theme = 'system';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
