import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { SystemVoiceOverlay } from './components/voice/SystemVoiceOverlay';
import './index.css';

const isVoiceOverlay =
  window.location.hash.includes('voice-overlay') ||
  window.location.search.includes('voice-overlay') ||
  window.location.href.includes('voice-overlay');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isVoiceOverlay ? <SystemVoiceOverlay /> : <App />}
  </React.StrictMode>
);
