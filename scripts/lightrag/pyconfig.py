import json
from pathlib import Path

# Тот же infra.config.json, что читает scripts/config.mjs — единый источник правды
# для Node- и Python-части инфраструктуры.
INFRA_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = INFRA_ROOT / "infra.config.json"

DEFAULT_CONFIG = {
    "projectRoot": ".",
    "features": {"docsRag": True, "envTools": True, "bootstrap": True, "lightrag": False},
}


def _load_config():
    if not CONFIG_PATH.exists():
        return json.loads(json.dumps(DEFAULT_CONFIG))
    on_disk = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    merged = {**DEFAULT_CONFIG, **on_disk}
    merged["features"] = {**DEFAULT_CONFIG["features"], **on_disk.get("features", {})}
    return merged


CONFIG = _load_config()
PROJECT_ROOT = (INFRA_ROOT / CONFIG["projectRoot"]).resolve()
FEATURES = CONFIG["features"]


def require_feature(name: str):
    if not FEATURES.get(name):
        raise RuntimeError(
            f'Функция "{name}" выключена в infra.config.json (features.{name} = false). '
            f"Включи её через node scripts/setup.mjs, если она нужна."
        )
