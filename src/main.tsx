import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { SystemVoiceOverlay } from './components/voice/SystemVoiceOverlay';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './index.css';

const isVoiceOverlay =
  window.location.hash.includes('voice-overlay') ||
  window.location.search.includes('voice-overlay') ||
  window.location.href.includes('voice-overlay');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isVoiceOverlay ? <SystemVoiceOverlay /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
