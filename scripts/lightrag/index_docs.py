import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, build_rag, collect_markdown_files  # noqa: E402

from lightrag.base import DocStatus


async def main():
    files = collect_markdown_files()
    if not files:
        print("Нет .md файлов для индексации. Индекс не создан.")
        return

    print(f"Найдено файлов: {len(files)}. Строю граф через LightRAG (LLM-экстракция сущностей)...")

    rag = await build_rag()
    try:
        texts = [f.read_text(encoding="utf-8") for f in files]
        rel_paths = [str(f.relative_to(ROOT)).replace("\\", "/") for f in files]
        await rag.ainsert(texts, ids=rel_paths, file_paths=rel_paths)

        # ainsert() не бросает исключение на частичный сбой — неудачные документы просто
        # логируются и остаются в статусе FAILED. Не делать вид, что всё прошло, если это не так
        # (см. .claude/memory/feedback_ollama_client_pitfalls.md — тут же таймаут воркера при
        # нескольких документах в очереди на одну локальную GPU).
        failed = await rag.get_docs_by_status(DocStatus.FAILED)
    finally:
        await rag.finalize_storages()

    if failed:
        print(f"Готово частично: {len(files) - len(failed)}/{len(files)} файлов. Не удалось:")
        for doc_id, status in failed.items():
            print(f"  - {status.file_path or doc_id}: {status.error_msg}")
        print("Повторить: npm run lightrag-index (кэш LLM-ответов переиспользуется, обработает только упавшее).")
        sys.exit(1)

    print(f"Готово. Граф в .lightrag-index/ построен из {len(files)} файлов.")


if __name__ == "__main__":
    asyncio.run(main())
