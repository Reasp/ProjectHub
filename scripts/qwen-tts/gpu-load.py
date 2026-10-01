# Фоновая нагрузка на видеокарту для junction-bench.mjs (TASK-116): имитирует игру, занимающую GPU.
# Запуск из venv Qwen3-TTS: python gpu-load.py <duty 0..1> — доля времени, когда GPU занят
# матричными умножениями. 0.35 на RTX 2080 даёт скорость генерации 1.7B около 1.
import sys
import time

import torch

duty = float(sys.argv[1]) if len(sys.argv) > 1 else 0.5
period = 0.02
a = torch.randn(3072, 3072, device="cuda", dtype=torch.float16)
b = torch.randn(3072, 3072, device="cuda", dtype=torch.float16)
print(f"gpu load started, duty {duty}", flush=True)
while True:
    start = time.perf_counter()
    while time.perf_counter() - start < period * duty:
        torch.matmul(a, b)
        torch.cuda.synchronize()
    rest = period * (1 - duty)
    if rest > 0:
        time.sleep(rest)
