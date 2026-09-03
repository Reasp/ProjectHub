import { useState, useEffect } from 'react';
import { voiceService, type VoiceState } from '../services/voiceService';

export function useVoiceState() {
  const [voiceState, setVoiceState] = useState<VoiceState>(voiceService.currentState);
  const [isListening, setIsListening] = useState<boolean>(voiceService.isListening);

  useEffect(() => {
    // Immediate sync
    setVoiceState(voiceService.currentState);
    setIsListening(voiceService.isListening);

    const unsub = voiceService.onStateChange((state) => {
      setVoiceState(state);
      setIsListening(voiceService.isListening);
    });

    return unsub;
  }, []);

  return {
    voiceState,
    isListening,
    language: voiceService.getConfig().language
  };
}
