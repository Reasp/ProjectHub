import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import build_rag, WORKING_DIR  # noqa: E402

from lightrag import QueryParam


async def main():
    if len(sys.argv) < 2:
        print('Использование: python query.py "запрос" [mode]', file=sys.stderr)
        print("mode: local | global | hybrid | naive | mix (по умолчанию mix)", file=sys.stderr)
        sys.exit(1)

    query = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "mix"

    if not WORKING_DIR.exists():
        print("Граф не найден. Сначала выполните: python index_docs.py", file=sys.stderr)
        sys.exit(1)

    rag = await build_rag()
    try:
        answer = await rag.aquery(query, param=QueryParam(mode=mode))
        print(answer)
    finally:
        await rag.finalize_storages()


if __name__ == "__main__":
    asyncio.run(main())
