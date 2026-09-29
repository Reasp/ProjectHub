"""Сайдкар синтеза речи Qwen3-TTS для ProjectHub (TASK-104, decision-64).

Отдельный процесс Python со своим venv: PyTorch и веса модели в процесс приложения не попадают
(decision-34 п. 5). Инференс — пакет `faster-qwen3-tts` (CUDA graphs + потоковая генерация):
официальный `qwen-tts` отдаёт звук только целиком и работает в 2.8 раза медленнее реального
времени (decision-50).

Процесс намеренно «глупый», как `ttsWorker.mjs`: разбиение текста на фрагменты, реестр голосов
и очередь заданий живут в `qwenTtsService`, сюда приходит готовый фрагмент и параметры голоса.

Протокол — строки JSON. Запросы читаются из stdin, ответы пишутся в исходный stdout; сам fd 1
сразу после старта перенаправляется в stderr, чтобы предупреждения torch/transformers и полосы
прогресса не ломали протокол.

Три вида моделей:
    custom — пресет-голоса с инструкцией подачи (speaker + instruct);
    design — голос по текстовому описанию (instruct). Каждый вызов создаёт НОВЫЙ голос под
             описание, на разных фразах он не совпадает (замеры decision-64), поэтому модель
             используется только для эталонной записи при создании голоса;
    base   — озвучка голосом эталонной записи (refAudio). Клонируется только эмбеддинг диктора
             (xvec_only): так голос устойчивее и не тянет за собой фонемы эталона.

Запросы:
    {"type": "load", "id", "kind": "custom" | "design" | "base", "modelDir"}
    {"type": "synthesize", "id", "text", "language", "speaker"?, "instruct"?, "refAudio"?,
     "refText"?, "seed"?, "chunkSize"?}
    {"type": "cancel", "id"}
    {"type": "unload", "id"}
    {"type": "shutdown"}

Ответы:
    {"type": "ready", "python", "torch", "cuda", "gpu"}
    {"type": "loaded", "id", "kind", "loadMs", "warmupMs", "sampleRate", "vramMb", "speakers"}
    {"type": "chunk", "id", "index", "sampleRate", "pcm"}   # pcm — base64 от int16 little-endian
    {"type": "done", "id", "audioSec", "genMs", "firstChunkMs", "chunks"}
    {"type": "cancelled", "id"}
    {"type": "unloaded", "id"}
    {"type": "error", "id", "code", "error"}

Сеть сайдкар не использует: веса читаются только с диска (decision-7).
"""
import base64
import json
import os
import queue
import sys
import threading
import time
import traceback

# Исходный stdout — только для протокола; всё, что пишут библиотеки в fd 1, уходит в stderr
_proto = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
os.dup2(2, 1)
sys.stdout = sys.stderr

# То же со входом. На Windows блокирующее чтение канала в одном потоке подвешивает любое обращение
# к нему из другого, а библиотеки при загрузке модели запускают подпроцессы, наследующие stdin:
# загрузка зависала навсегда (проверено 2026-09-28). Протокол читается из копии дескриптора,
# сам fd 0 указывает в пустое устройство.
_requests = os.fdopen(os.dup(0), "r", encoding="utf-8", newline="\n")
_null_in = os.open(os.devnull, os.O_RDONLY)
os.dup2(_null_in, 0)
os.close(_null_in)
sys.stdin = open(os.devnull, "r", encoding="utf-8")  # noqa: SIM115 — живёт всё время процесса

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

_write_lock = threading.Lock()
_cancelled = set()
_cancel_lock = threading.Lock()
_commands: "queue.Queue[dict]" = queue.Queue()

DEFAULT_CHUNK_SIZE = 8
WARMUP_PREFILL = 100
# Прогрев исправной модели занимает 1–2 с; десятки секунд означают, что видеопамять переполнена
SLOW_WARMUP_MS = 10_000
# Модель работала в реальном времени, когда свободной видеопамяти было чуть меньше её размера
# (часть занятого другими программами вытесняется без потерь), поэтому порог — не 100%
MIN_FREE_VRAM_SHARE = 0.75


class GpuMemoryError(RuntimeError):
    """Видеопамяти не хватает: модель не поместится или будет работать через системную память."""


def model_weights_mb(model_dir: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(model_dir):
        total += sum(os.path.getsize(os.path.join(root, f)) for f in files if f.endswith(".safetensors"))
    return int(total / 1e6)


def send(message: dict) -> None:
    line = json.dumps(message, ensure_ascii=False)
    with _write_lock:
        try:
            _proto.write(line + "\n")
            _proto.flush()
        except (OSError, ValueError):
            # Родитель закрыл канал — продолжать незачем
            os._exit(0)


def log(text: str) -> None:
    print(f"[qwen-sidecar] {text}", file=sys.stderr, flush=True)


def is_cancelled(job_id: str) -> bool:
    with _cancel_lock:
        return job_id in _cancelled


def classify_error(err: BaseException) -> str:
    """Код ошибки для main: текст переводит рендерер (ttsErrorCodes)."""
    name = type(err).__name__
    text = str(err)
    if name == "OutOfMemoryError" or "out of memory" in text.lower():
        return "qwen_out_of_memory"
    if isinstance(err, (FileNotFoundError, NotADirectoryError)):
        return "qwen_voice_not_found" if "reference audio" in text else "qwen_model_missing"
    return "qwen_synthesis_failed"


class Engine:
    def __init__(self) -> None:
        self.torch = None
        self.model = None
        self.kind = None
        self.model_dir = None
        self.sample_rate = 24000

    def import_torch(self):
        if self.torch is None:
            import torch  # noqa: WPS433 — тяжёлый импорт откладывается до первого запроса

            self.torch = torch
        return self.torch

    def unload_cache(self) -> None:
        import gc

        gc.collect()
        if self.torch is not None and self.torch.cuda.is_available():
            self.torch.cuda.empty_cache()

    def unload(self) -> None:
        if self.model is None:
            return
        self.model = None
        self.kind = None
        self.model_dir = None
        self.unload_cache()

    def free_vram_mb(self) -> int:
        free, _total = self.torch.cuda.mem_get_info()
        return int(free / 1e6)

    def load(self, kind: str, model_dir: str) -> dict:
        torch = self.import_torch()
        if self.model is not None and self.kind == kind and self.model_dir == model_dir:
            return {"loadMs": 0, "warmupMs": 0}
        if not os.path.isfile(os.path.join(model_dir, "config.json")):
            raise FileNotFoundError(f"model config not found in {model_dir}")
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available")

        # На 8 ГБ видеопамяти две модели по 4.5 ГБ одновременно не помещаются
        self.unload()

        # Windows при нехватке видеопамяти не отказывает, а уводит её часть в системную память:
        # модель «загружается», но работает в десятки раз медленнее (прогрев 38 с вместо 1.3 с,
        # синтез не укладывается в тайм-аут — проверено 2026-09-28 с игрой на той же видеокарте).
        # Поэтому явная нехватка отсекается до загрузки, а скрытая — по времени прогрева.
        need_mb = model_weights_mb(model_dir)
        free_mb = self.free_vram_mb()
        if free_mb < need_mb * MIN_FREE_VRAM_SHARE:
            raise GpuMemoryError(f"GPU out of memory: {free_mb} MB free, the model needs about {need_mb} MB")

        from faster_qwen3_tts import FasterQwen3TTS  # noqa: WPS433

        started = time.time()
        model = FasterQwen3TTS.from_pretrained(
            model_dir, device="cuda", dtype=torch.bfloat16, local_files_only=True
        )
        load_ms = int((time.time() - started) * 1000)

        started = time.time()
        model.warmup(prefill_len=WARMUP_PREFILL)
        warmup_ms = int((time.time() - started) * 1000)

        if warmup_ms > SLOW_WARMUP_MS:
            del model
            self.unload_cache()
            raise GpuMemoryError(
                f"GPU out of memory: warmup took {warmup_ms} ms, {free_mb} MB were free for a {need_mb} MB model"
            )

        self.model = model
        self.kind = kind
        self.model_dir = model_dir
        return {"loadMs": load_ms, "warmupMs": warmup_ms}

    def speakers(self) -> list:
        if self.model is None or self.kind != "custom":
            return []
        try:
            found = self.model.model.get_supported_speakers()
            return sorted(str(s) for s in found) if found else []
        except Exception:  # noqa: BLE001 — список голосов справочный
            return []

    def vram_mb(self) -> int:
        if self.torch is None or not self.torch.cuda.is_available():
            return 0
        return int(self.torch.cuda.memory_allocated() / 1e6)

    def stream(self, cmd: dict):
        torch = self.torch
        seed = cmd.get("seed")
        if isinstance(seed, int):
            torch.manual_seed(seed)
            torch.cuda.manual_seed_all(seed)
        chunk_size = int(cmd.get("chunkSize") or DEFAULT_CHUNK_SIZE)
        instruct = cmd.get("instruct") or None
        if self.kind == "custom":
            return self.model.generate_custom_voice_streaming(
                text=cmd["text"],
                speaker=cmd["speaker"],
                language=cmd["language"],
                instruct=instruct,
                chunk_size=chunk_size,
            )
        if self.kind == "base":
            ref_audio = cmd.get("refAudio") or ""
            if not os.path.isfile(ref_audio):
                raise FileNotFoundError(f"reference audio not found: {ref_audio}")
            return self.model.generate_voice_clone_streaming(
                text=cmd["text"],
                language=cmd["language"],
                ref_audio=ref_audio,
                ref_text=cmd.get("refText") or "",
                xvec_only=True,
                chunk_size=chunk_size,
            )
        return self.model.generate_voice_design_streaming(
            text=cmd["text"],
            instruct=instruct or "",
            language=cmd["language"],
            chunk_size=chunk_size,
        )


engine = Engine()


def encode_pcm(audio) -> tuple:
    import numpy as np  # noqa: WPS433

    samples = np.asarray(audio, dtype=np.float32).flatten()
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    return base64.b64encode(pcm.tobytes()).decode("ascii"), int(samples.shape[0])


def handle_load(cmd: dict) -> None:
    job_id = cmd.get("id")
    info = engine.load(cmd["kind"], cmd["modelDir"])
    send({
        "type": "loaded",
        "id": job_id,
        "kind": engine.kind,
        "sampleRate": engine.sample_rate,
        "vramMb": engine.vram_mb(),
        "speakers": engine.speakers(),
        **info,
    })
    log(f"model {engine.kind} loaded in {info['loadMs']} ms, warmup {info['warmupMs']} ms")


def handle_synthesize(cmd: dict) -> None:
    job_id = cmd["id"]
    if engine.model is None:
        send({"type": "error", "id": job_id, "code": "qwen_model_not_loaded", "error": "model is not loaded"})
        return
    if is_cancelled(job_id):
        send({"type": "cancelled", "id": job_id})
        return

    started = time.time()
    first_chunk_ms = None
    total_samples = 0
    index = 0
    sample_rate = engine.sample_rate
    generator = engine.stream(cmd)
    try:
        for audio, sample_rate, _timing in generator:
            if is_cancelled(job_id):
                send({"type": "cancelled", "id": job_id})
                return
            pcm, count = encode_pcm(audio)
            if count == 0:
                continue
            if first_chunk_ms is None:
                first_chunk_ms = int((time.time() - started) * 1000)
            total_samples += count
            send({"type": "chunk", "id": job_id, "index": index, "sampleRate": int(sample_rate), "pcm": pcm})
            index += 1
    finally:
        generator.close()

    engine.sample_rate = int(sample_rate)
    send({
        "type": "done",
        "id": job_id,
        "audioSec": round(total_samples / float(sample_rate), 3),
        "genMs": int((time.time() - started) * 1000),
        "firstChunkMs": first_chunk_ms,
        "chunks": index,
    })


def worker_loop() -> None:
    while True:
        cmd = _commands.get()
        kind = cmd.get("type")
        job_id = cmd.get("id")
        try:
            if kind == "load":
                handle_load(cmd)
            elif kind == "synthesize":
                handle_synthesize(cmd)
            elif kind == "unload":
                engine.unload()
                send({"type": "unloaded", "id": job_id})
            elif kind == "shutdown":
                os._exit(0)
            else:
                send({"type": "error", "id": job_id, "code": "qwen_bad_request", "error": f"unknown request: {kind}"})
        except BaseException as err:  # noqa: BLE001 — сайдкар не должен умирать от ошибки задания
            if isinstance(err, (KeyboardInterrupt, SystemExit)):
                raise
            code = classify_error(err)
            if kind == "load" and code == "qwen_synthesis_failed":
                code = "qwen_load_failed"
            log(f"{kind} failed: {err}\n{traceback.format_exc()}")
            if kind == "load":
                engine.unload()
            send({"type": "error", "id": job_id, "code": code, "error": str(err)[:500]})
        finally:
            if kind == "synthesize" and job_id:
                with _cancel_lock:
                    _cancelled.discard(job_id)


def main() -> None:
    try:
        torch = engine.import_torch()
        cuda = bool(torch.cuda.is_available())
        send({
            "type": "ready",
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "cuda": cuda,
            "gpu": torch.cuda.get_device_name(0) if cuda else None,
        })
    except BaseException as err:  # noqa: BLE001
        send({"type": "error", "id": None, "code": "qwen_runtime_broken", "error": str(err)[:500]})
        sys.exit(3)

    threading.Thread(target=worker_loop, name="qwen-worker", daemon=True).start()

    # Чтение stdin — в главном потоке: отмена должна приходить, пока рабочий поток занят генерацией
    for raw in _requests:
        raw = raw.strip()
        if not raw:
            continue
        try:
            cmd = json.loads(raw)
        except json.JSONDecodeError:
            send({"type": "error", "id": None, "code": "qwen_bad_request", "error": "invalid json"})
            continue
        if cmd.get("type") == "cancel":
            with _cancel_lock:
                # Отмена уже завершённого задания оставила бы id навсегда — множество не растёт без предела
                if len(_cancelled) > 256:
                    _cancelled.clear()
                _cancelled.add(cmd.get("id"))
            continue
        if cmd.get("type") == "shutdown":
            break
        _commands.put(cmd)

    # stdin закрыт — родитель завершился или остановил сайдкар
    os._exit(0)


if __name__ == "__main__":
    main()
