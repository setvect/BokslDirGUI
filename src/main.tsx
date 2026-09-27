import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { APP_NAME } from './foundation';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error(`${APP_NAME} root element was not found.`);
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
