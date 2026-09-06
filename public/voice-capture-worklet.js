// AudioWorklet-процессор захвата микрофона для ProjectHub (TASK-36).
// Работает в отдельном аудиопотоке: накапливает 128-кадровые блоки в чанк
// CHUNK_SIZE кадров (на нативной частоте контекста) и отправляет его в главный
// поток одним сообщением с передачей буфера (transfer) — без копирования.
// Ресемплинг в 16 кГц и VAD выполняются в voiceService на главном потоке.

const CHUNK_SIZE = 4096;

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(CHUNK_SIZE);
    this.offset = 0;
    this.active = true;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') {
        this.active = false;
      }
    };
  }

  process(inputs) {
    if (!this.active) return false;

    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channel = input[0];
    if (!channel) return true;

    let read = 0;
    while (read < channel.length) {
      const toCopy = Math.min(channel.length - read, CHUNK_SIZE - this.offset);
      this.buffer.set(channel.subarray(read, read + toCopy), this.offset);
      this.offset += toCopy;
      read += toCopy;

      if (this.offset === CHUNK_SIZE) {
        const full = this.buffer;
        // Буфер уходит в главный поток по transferList; для следующего чанка выделяем новый
        this.port.postMessage({ type: 'chunk', samples: full }, [full.buffer]);
        this.buffer = new Float32Array(CHUNK_SIZE);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('voice-capture-processor', VoiceCaptureProcessor);
