import { gradients, linearGradient } from '@ansly/design';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { themeCss } from '@/lib/theme-css';
import App from './App.tsx';
import './style.css';

// Colour tokens from @ansly/design, shared with the web app.
const tokens = document.createElement('style');
tokens.textContent = `${themeCss({ selector: ':root', systemDark: ':root' })}\n:root { --brand-gradient: ${linearGradient(gradients.brand)}; }`;
document.head.append(tokens);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
