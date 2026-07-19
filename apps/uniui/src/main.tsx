import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.querySelector('#root');
if (!root) throw new Error('UNIUI root element is missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
