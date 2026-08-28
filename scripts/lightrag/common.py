import os

from ollama import AsyncClient
from lightrag import LightRAG
from lightrag.llm.ollama import ollama_model_complete, ollama_embed
from lightrag.utils import EmbeddingFunc
from lightrag.kg.shared_storage import initialize_pipeline_status

from pyconfig import PROJECT_ROOT, require_feature

ROOT = PROJECT_ROOT
WORKING_DIR = ROOT / ".lightrag-index"

# Намеренно НЕ читаем стандартный OLLAMA_HOST: эта переменная на машине уже может быть
# задана для конфигурации самого Ollama-сервера (например "0.0.0.0" — "слушать все
# интерфейсы", или LAN IP) и как адрес для клиента она не годится. Используем отдельное
# имя, чтобы не наткнуться на такое значение. 127.0.0.1, а не localhost — чтобы не зависеть
# от того, резолвится ли localhost в ::1 или 127.0.0.1 на конкретной машине.
OLLAMA_HOST = os.environ.get("LIGHTRAG_OLLAMA_HOST", "http://127.0.0.1:11434")
LLM_MODEL = os.environ.get("LIGHTRAG_LLM_MODEL", "qwen2.5:7b-instruct")
EMBED_MODEL = os.environ.get("LIGHTRAG_EMBED_MODEL", "bge-m3:latest")
EMBED_DIM = 1024  # bge-m3

# Документация, которую индексируем — те же корни, что у scripts/rag/index-docs.mjs.
# Без верхнеуровневой docs/ — документация живёт внутри backlog/.
DOC_ROOTS = ["backlog/docs", "backlog/decisions"]


def collect_markdown_files():
    files = []
    for root in DOC_ROOTS:
        base = ROOT / root
        if not base.exists():
            continue
        for path in base.rglob("*.md"):
            files.append(path)
    return files


async def warmup_ollama():
    """Прогревает обе модели в Ollama ДО начала реальной индексации.

    На практике поймали: первая одновременная загрузка LLM (qwen, ~5GB) и эмбеддинг-модели
    (bge-m3, ~0.7GB) в видеопамять — по одной, по мере надобности внутри пайплайна LightRAG —
    приводила к жутким зависаниям (LLM-экстракция не укладывалась и в 1800с, хотя те же
    запросы после прогрева отвечают меньше секунды). Похоже на конкуренцию/перестроение
    видеопамяти при первой загрузке второй модели поверх уже резидентной первой. Прогрев
    вне пайплайна, с понятным сообщением, — вместо того чтобы ловить это посреди чужого
    480-секундного таймаута воркера.
    """
    client = AsyncClient(host=OLLAMA_HOST)
    print(f"Прогреваю {LLM_MODEL}...")
    await client.chat(model=LLM_MODEL, messages=[{"role": "user", "content": "hi"}], options={"num_ctx": 8192})
    print(f"Прогреваю {EMBED_MODEL}...")
    await client.embed(model=EMBED_MODEL, input="hi")


async def build_rag() -> LightRAG:
    require_feature("lightrag")
    WORKING_DIR.mkdir(parents=True, exist_ok=True)
    await warmup_ollama()

    rag = LightRAG(
        working_dir=str(WORKING_DIR),
        llm_model_func=ollama_model_complete,
        llm_model_name=LLM_MODEL,
        # num_ctx: НЕ ставить большим бездумно — на слабой/делённой видеопамяти
        # пересборка KV-cache под большой контекст может занимать минуты вместо секунд
        # (проверено: 32768 не укладывалось и в 180с, 8192 грузится один раз за ~20с).
        llm_model_kwargs={"host": OLLAMA_HOST, "options": {"num_ctx": 8192}},
        # Одна локальная модель на одной видеокарте не тянет параллельные LLM-запросы —
        # Ollama всё равно сериализует инференс, а лишняя конкурентность лишь выстраивает
        # очередь и топит отдельные чанки в фиксированном таймауте воркера (проверено:
        # с несколькими документами и дефолтной конкурентностью чанк без вины упёрся
        # в лимит 480с, просто ожидая своей очереди). max_parallel_insert=1 — документы
        # не мешаются в одну очередь; llm_model_max_async=2 — чуть выше 1, чтобы не терять
        # оверлап chunking/эмбеддингов, но без реального параллелизма LLM-вызовов.
        llm_model_max_async=2,
        max_parallel_insert=1,
        default_llm_timeout=900,
        embedding_func=EmbeddingFunc(
            embedding_dim=EMBED_DIM,
            max_token_size=8192,
            func=lambda texts: ollama_embed(texts, embed_model=EMBED_MODEL, host=OLLAMA_HOST),
        ),
    )
    await rag.initialize_storages()
    await initialize_pipeline_status()
    return rag
