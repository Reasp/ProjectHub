#!/usr/bin/env python3
"""Спайк TASK-114: Qwen3-TTS на Apple Silicon через qwentts.cpp (GGML, Metal).

Отвечает на один вопрос: проходит ли движок на этом Mac порог применимости decision-64 —
первый звук около секунды и генерация не медленнее воспроизведения. Фразы те же, что в замерах
на Windows (decision-50, decision-64), чтобы цифры можно было сравнивать.

PyTorch не нужен: рантайм — библиотека на C++, зависимости — numpy и huggingface-hub.

Запуск на Mac (Apple Silicon, macOS 14+, Python 3.10+):

    python3 -m venv ~/qwen-spike && source ~/qwen-spike/bin/activate
    pip install "qwentts-cpp-python>=0.4.1" numpy
    python mac_spike.py                 # быстрый прогон: ~4.7 ГБ весов, 5–10 минут
    python mac_spike.py --full          # плюс BF16, голос по описанию и клон: ещё ~8 ГБ

Если huggingface.co недоступен, перед запуском: export HF_ENDPOINT=https://hf-mirror.com

Результат — каталог qwen-spike-out: report.json, summary.txt и записи WAV. Для разбора нужны
report.json и summary.txt; записи стоит прослушать самому — акцент и естественность речи
скрипт не оценивает.
"""
import argparse
import gc
import json
import os
import platform
import subprocess
import sys
import time
import wave

import numpy as np

REPO = "Qwen/Qwen3-TTS-12Hz-{size}-{kind}"
FRAME_SEC = 0.08  # 12.5 кадра кодека в секунду

PHRASES = [
    "Готово.",
    "Сборка прошла.",
    "Линтер чист, тесты зелёные.",
    "Задача переведена в ревью, осталось закоммитить изменения.",
    "Задача сто четыре: второй движок синтеза речи на моделях Qwen.",
    "Сборка прошла: линтер чист, тесты зелёные, пакет собран.",
    "В интеграционную ветку влито три подзадачи, конфликтов нет.",
    "Агент закончил работу и ждёт подтверждения: нужно проверить изменения в трёх файлах и запустить "
    "сборку приложения.",
]
REFERENCE_TEXT = (
    "Это проба голоса для озвучки ответов в приложении: так он звучит на обычной фразе средней длины."
)
DESIGN_INSTRUCT = "A calm middle-aged female voice with a warm timbre and a measured pace."
CUSTOM_INSTRUCT = "Говори спокойно и дружелюбно, в умеренном темпе."


def sysctl(name: str) -> str:
    try:
        return subprocess.run(["sysctl", "-n", name], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001 — сведения о машине справочные
        return ""


def machine_info() -> dict:
    memory = sysctl("hw.memsize")
    return {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "chip": sysctl("machdep.cpu.brand_string"),
        "memory_gb": round(int(memory) / 1e9, 1) if memory.isdigit() else None,
        "performance_cores": sysctl("hw.perflevel0.physicalcpu"),
        "python": sys.version.split()[0],
    }


def peak_rss_mb():
    try:
        import resource
    except ImportError:  # Windows: скрипт там не запускают, но проверяют
        return None
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS отдаёт байты, Linux — килобайты
    return round(peak / (1e6 if sys.platform == "darwin" else 1e3), 1)


def write_wav(path: str, samples: np.ndarray, sample_rate: int) -> None:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(pcm.tobytes())


def measure(tts, *, text: str, lang: str, chunk_frames: int, first_frames: int, **voice) -> tuple:
    """Одна фраза в потоке: времена прихода чанков и то, что услышит пользователь."""
    started = time.perf_counter()
    arrivals, chunks, sample_rate = [], [], 24000
    for chunk, sample_rate in tts.stream(
        text=text,
        lang=lang,
        codec_chunk_sec=chunk_frames * FRAME_SEC,
        first_chunk_frames=first_frames,
        **voice,
    ):
        arrivals.append(time.perf_counter() - started)
        chunks.append(np.asarray(chunk, dtype=np.float32).reshape(-1))
    total = time.perf_counter() - started
    if not chunks:
        raise RuntimeError("модель не выдала звука")

    audio = np.concatenate(chunks)
    audio_sec = len(audio) / sample_rate
    first_audio_sec = len(chunks[0]) / sample_rate

    # Воспроизведение начинается с приходом первого чанка; разрыв — чанк пришёл позже, чем доиграно
    # всё полученное до него
    position, underruns, gap_total = arrivals[0], 0, 0.0
    for at, chunk in zip(arrivals, chunks):
        if at > position + 1e-3:
            underruns += 1
            gap_total += at - position
            position = at
        position += len(chunk) / sample_rate

    tail_audio = audio_sec - first_audio_sec
    rate = (total - arrivals[0]) / tail_audio if tail_audio >= 1.0 else None
    row = {
        "chars": len(text),
        "first_sound_s": round(arrivals[0], 3),
        "total_s": round(total, 2),
        "audio_s": round(audio_sec, 2),
        "rtf": round(total / audio_sec, 3),
        # Скорость после первого чанка: меньше 1 — звук копится быстрее, чем играет
        "steady_rate": round(rate, 3) if rate is not None else None,
        "chunks": len(chunks),
        "underruns": underruns,
        "gap_total_s": round(gap_total, 3),
    }
    return row, audio, sample_rate


def pick_language(tts, **voice) -> str:
    """Имя языка рантайм принимает строкой; регистр в документации не оговорён."""
    for lang in ("russian", "Russian"):
        try:
            for _chunk, _sr in tts.stream(text="Привет.", lang=lang, **voice):
                pass
            return lang
        except Exception as err:  # noqa: BLE001
            last = err
    raise RuntimeError(f"рантайм не принял русский язык: {last}")


def summarize(rows: list) -> dict:
    rates = [r["steady_rate"] for r in rows if r["steady_rate"] is not None]
    first = [r["first_sound_s"] for r in rows]
    return {
        "first_sound_avg_s": round(sum(first) / len(first), 3),
        "first_sound_max_s": round(max(first), 3),
        "steady_rate_avg": round(sum(rates) / len(rates), 3) if rates else None,
        "steady_rate_max": round(max(rates), 3) if rates else None,
        "underruns": sum(r["underruns"] for r in rows),
        "gap_total_s": round(sum(r["gap_total_s"] for r in rows), 3),
        "audio_total_s": round(sum(r["audio_s"] for r in rows), 1),
    }


def verdict(summary: dict) -> str:
    rate = summary["steady_rate_max"]
    if rate is None:
        return "нет данных"
    if rate < 0.95 and summary["first_sound_max_s"] <= 1.1:
        return "проходит с запасом"
    if rate <= 1.02 and summary["first_sound_max_s"] <= 1.3:
        return "на границе реального времени"
    return "не проходит"


def load(QwenTTS, size: str, kind: str, quant: str, report: dict):
    started = time.perf_counter()
    tts = QwenTTS.from_pretrained(REPO.format(size=size, kind=kind), quant=quant)
    report["load_s"] = round(time.perf_counter() - started, 2)
    return tts


def run_custom(QwenTTS, size: str, quant: str, args, out_dir: str) -> dict:
    name = f"custom-{size}-{quant}"
    print(f"\n=== {name} ===", flush=True)
    report = {"model": name}
    tts = load(QwenTTS, size, "CustomVoice", quant, report)
    try:
        speakers = tts.speaker_names()
        speaker = next((s for s in speakers if s.lower() == "serena"), speakers[0])
        lang = pick_language(tts, speaker=speaker)
        report.update({"speakers": speakers, "speaker": speaker, "lang": lang})
        print(f"загрузка {report['load_s']} с, дикторы: {', '.join(speakers)}", flush=True)

        for chunk_frames in args.chunks:
            rows = []
            for index, text in enumerate(PHRASES):
                # Инструкция подачи поддерживается только моделью 1.7B
                instruct = CUSTOM_INSTRUCT if size == "1.7B" and index >= 4 else None
                row, audio, sample_rate = measure(
                    tts, text=text, lang=lang, chunk_frames=chunk_frames, first_frames=args.first,
                    speaker=speaker, instruct=instruct, seed=1234,
                )
                rows.append(row)
                if chunk_frames == args.chunks[0] and index in (3, 5, 7):
                    write_wav(os.path.join(out_dir, f"{name}-phrase{index}.wav"), audio, sample_rate)
                print(
                    f"чанк {chunk_frames:2d} | {row['chars']:3d} симв | первый звук {row['first_sound_s']:.2f} с | "
                    f"{row['total_s']:.2f} с на {row['audio_s']:.2f} с | скорость {row['steady_rate']} | "
                    f"разрывов {row['underruns']}",
                    flush=True,
                )
            summary = summarize(rows)
            summary["verdict"] = verdict(summary)
            report[f"chunk{chunk_frames}"] = {"summary": summary, "rows": rows}
        report["peak_rss_mb"] = peak_rss_mb()
    finally:
        tts.close()
        del tts
        gc.collect()
    return report


def run_design_clone(QwenTTS, quant: str, args, out_dir: str) -> dict:
    """Голос по описанию: VoiceDesign записывает эталон, Base озвучивает фразы его голосом."""
    print(f"\n=== design → clone, 1.7B {quant} ===", flush=True)
    report = {"model": f"design-clone-1.7B-{quant}"}

    design_report = {}
    design = load(QwenTTS, "1.7B", "VoiceDesign", quant, design_report)
    try:
        lang = pick_language(design, instruct=DESIGN_INSTRUCT)
        row, reference, sample_rate = measure(
            design, text=REFERENCE_TEXT, lang=lang, chunk_frames=args.chunks[0], first_frames=args.first,
            instruct=DESIGN_INSTRUCT, seed=1234,
        )
        _row, repeat, _sr = measure(
            design, text=REFERENCE_TEXT, lang=lang, chunk_frames=args.chunks[0], first_frames=args.first,
            instruct=DESIGN_INSTRUCT, seed=1234,
        )
        write_wav(os.path.join(out_dir, "design-reference.wav"), reference, sample_rate)
        report["design"] = {
            **design_report,
            **row,
            # На Windows тот же рецепт воспроизводится побитово — от этого зависит, можно ли
            # восстановить эталон по рецепту
            "same_seed_identical": bool(reference.shape == repeat.shape and np.array_equal(reference, repeat)),
        }
        print(f"эталон: {row['audio_s']} с звука за {row['total_s']} с, повтор побитово совпал: "
              f"{report['design']['same_seed_identical']}", flush=True)
    finally:
        design.close()
        del design
        gc.collect()

    base_report = {}
    base = load(QwenTTS, "1.7B", "Base", quant, base_report)
    try:
        started = time.perf_counter()
        voice_ref = base.extract_voice_ref(reference)
        base_report["extract_voice_ref_s"] = round(time.perf_counter() - started, 3)
        embedding = np.ascontiguousarray(voice_ref.ref_spk_emb, dtype=np.float32).reshape(-1)
        # Первая фраза после загрузки на Windows выходит с задержкой — отделяем её от остальных
        first_row, _audio, _sr = measure(
            base, text="Привет.", lang=lang, chunk_frames=args.chunks[0], first_frames=args.first,
            ref_spk_emb=embedding, seed=1234,
        )
        rows = []
        for index, text in enumerate(PHRASES):
            row, audio, sample_rate = measure(
                base, text=text, lang=lang, chunk_frames=args.chunks[0], first_frames=args.first,
                ref_spk_emb=embedding, seed=1234,
            )
            rows.append(row)
            write_wav(os.path.join(out_dir, f"clone-phrase{index}.wav"), audio, sample_rate)
            print(
                f"клон | {row['chars']:3d} симв | первый звук {row['first_sound_s']:.2f} с | "
                f"скорость {row['steady_rate']} | разрывов {row['underruns']}",
                flush=True,
            )
        summary = summarize(rows)
        summary["verdict"] = verdict(summary)
        report["clone"] = {**base_report, "first_after_load": first_row, "summary": summary, "rows": rows}
        report["peak_rss_mb"] = peak_rss_mb()
    finally:
        base.close()
        del base
        gc.collect()
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Замер Qwen3-TTS на Apple Silicon (TASK-114)")
    parser.add_argument("--full", action="store_true", help="добавить BF16, голос по описанию и клон эталона")
    parser.add_argument("--out", default="qwen-spike-out", help="каталог для отчёта и записей")
    parser.add_argument("--chunks", default="8,12", help="размеры чанка в кадрах кодека, через запятую")
    parser.add_argument("--first", type=int, default=4, choices=(1, 2, 4, 8), help="кадров в первом чанке")
    args = parser.parse_args()
    args.chunks = [int(value) for value in args.chunks.split(",") if value.strip()]

    try:
        from qwentts_cpp import QwenTTS, __version__ as runtime_version
    except ImportError:
        sys.exit('Не установлен рантайм: pip install "qwentts-cpp-python>=0.4.1" numpy')

    os.makedirs(args.out, exist_ok=True)
    report = {
        "task": "TASK-114",
        "started": time.strftime("%Y-%m-%d %H:%M:%S"),
        "machine": machine_info(),
        "runtime": runtime_version,
        "first_chunk_frames": args.first,
        "runs": [],
    }
    print(json.dumps(report["machine"], ensure_ascii=False), flush=True)

    # Порядок — от основного варианта к запасным: 1.7B Q8, затем более лёгкие
    matrix = [("1.7B", "Q8_0"), ("1.7B", "Q4_K_M"), ("0.6B", "Q8_0")]
    if args.full:
        matrix.insert(0, ("1.7B", "BF16"))

    def attempt(label: str, run) -> None:
        try:
            report["runs"].append(run())
        except Exception as err:  # noqa: BLE001 — один упавший вариант не должен терять остальные
            print(f"{label}: ОШИБКА {type(err).__name__}: {err}", flush=True)
            report["runs"].append({"model": label, "error": f"{type(err).__name__}: {err}"})
        with open(os.path.join(args.out, "report.json"), "w", encoding="utf-8") as out:
            json.dump(report, out, ensure_ascii=False, indent=2)

    for size, quant in matrix:
        attempt(f"custom-{size}-{quant}", lambda: run_custom(QwenTTS, size, quant, args, args.out))
    if args.full:
        attempt("design-clone-1.7B-Q8_0", lambda: run_design_clone(QwenTTS, "Q8_0", args, args.out))

    lines = [f"{report['machine']['chip']}, {report['machine']['memory_gb']} ГБ, {report['machine']['platform']}", ""]
    for run in report["runs"]:
        if "error" in run:
            lines.append(f"{run['model']}: {run['error']}")
            continue
        blocks = [(key, value) for key, value in run.items() if key.startswith("chunk")]
        if "clone" in run:
            blocks.append(("клон", run["clone"]))
        for key, block in blocks:
            s = block["summary"]
            lines.append(
                f"{run['model']} {key}: первый звук {s['first_sound_avg_s']} с (макс {s['first_sound_max_s']}), "
                f"скорость {s['steady_rate_avg']} (макс {s['steady_rate_max']}), разрывов {s['underruns']}, "
                f"память {run.get('peak_rss_mb')} МБ — {s['verdict']}"
            )
    summary_text = "\n".join(lines)
    with open(os.path.join(args.out, "summary.txt"), "w", encoding="utf-8") as out:
        out.write(summary_text + "\n")
    print("\n" + summary_text)
    print(f"\nОтчёт: {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
