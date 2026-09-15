import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { SystemVoiceOverlay } from './components/voice/SystemVoiceOverlay';
import { ComputerOverlay } from './components/computer/ComputerOverlay';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './index.css';

const isVoiceOverlay =
  window.location.hash.includes('voice-overlay') ||
  window.location.search.includes('voice-overlay') ||
  window.location.href.includes('voice-overlay');

// Окно-оверлей «Агент управляет компьютером» поверх всех окон (TASK-82)
const isComputerOverlay = window.location.hash.includes('computer-overlay');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isComputerOverlay ? <ComputerOverlay /> : isVoiceOverlay ? <SystemVoiceOverlay /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
