#!/usr/bin/env python3
import urllib.request
import urllib.error
import os
import sys

MODEL_ID = "Xenova/all-MiniLM-L6-v2"
HF_BASE  = f"https://huggingface.co/{MODEL_ID}/resolve/main"
CDN      = "https://cdn.jsdelivr.net/npm"
ORT_VER  = "1.14.0"

DOWNLOADS = [
    # Transformers.js (~1.4 МБ)
    ("vendor/transformers.min.js",
     f"{CDN}/@xenova/transformers@2.17.2/dist/transformers.min.js"),

    # ONNX Runtime WASM (~30 МБ суммарно)
    ("vendor/ort-wasm/ort-wasm.wasm",
     f"{CDN}/onnxruntime-web@{ORT_VER}/dist/ort-wasm.wasm"),
    ("vendor/ort-wasm/ort-wasm-simd.wasm",
     f"{CDN}/onnxruntime-web@{ORT_VER}/dist/ort-wasm-simd.wasm"),
    ("vendor/ort-wasm/ort-wasm-threaded.wasm",
     f"{CDN}/onnxruntime-web@{ORT_VER}/dist/ort-wasm-threaded.wasm"),
    ("vendor/ort-wasm/ort-wasm-simd-threaded.wasm",
     f"{CDN}/onnxruntime-web@{ORT_VER}/dist/ort-wasm-simd-threaded.wasm"),

    # Модель all-MiniLM-L6-v2 (~23 МБ суммарно)
    (f"models/{MODEL_ID}/config.json",            f"{HF_BASE}/config.json"),
    (f"models/{MODEL_ID}/tokenizer.json",         f"{HF_BASE}/tokenizer.json"),
    (f"models/{MODEL_ID}/tokenizer_config.json",  f"{HF_BASE}/tokenizer_config.json"),
    (f"models/{MODEL_ID}/special_tokens_map.json",f"{HF_BASE}/special_tokens_map.json"),
    (f"models/{MODEL_ID}/vocab.txt",              f"{HF_BASE}/vocab.txt"),
    (f"models/{MODEL_ID}/onnx/model_quantized.onnx",
     f"{HF_BASE}/onnx/model_quantized.onnx"),
]


def fmt_mb(n):
    return f"{n / 1_048_576:.1f} МБ"


def download_file(dest, url):
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)

    if os.path.exists(dest):
        size = os.path.getsize(dest)
        print(f"  уже есть ({fmt_mb(size)}): {dest}")
        return True

    tmp = dest + ".tmp"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "python-urllib/3"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            total = int(resp.headers.get("Content-Length", 0))
            done  = 0
            with open(tmp, "wb") as f:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        bar = "#" * (done * 30 // total)
                        pct = done * 100 // total
                        print(f"\r  [{bar:<30}] {pct:3d}%  {fmt_mb(done)}/{fmt_mb(total)}",
                              end="", flush=True)
        os.replace(tmp, dest)
        print(f"\r  готово ({fmt_mb(os.path.getsize(dest))}): {dest}              ")
        return True
    except (urllib.error.URLError, OSError) as e:
        print(f"\n  ОШИБКА: {e}")
        if os.path.exists(tmp):
            os.remove(tmp)
        return False


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    print("=" * 60)
    print("  Загрузка компонентов нейросети (однократно)")
    print("=" * 60)
    print(f"  Модель : {MODEL_ID}")
    print(f"  Объём  : ~55 МБ суммарно")
    print()

    failed = []
    for i, (dest, url) in enumerate(DOWNLOADS, 1):
        print(f"[{i}/{len(DOWNLOADS)}] {os.path.basename(dest)}")
        if not download_file(dest, url):
            failed.append(dest)

    print()
    print("=" * 60)
    if failed:
        print(f"  Не удалось: {len(failed)} файл(ов)")
        for f in failed:
            print(f"    - {f}")
        print("  Проверьте соединение и запустите повторно.")
        sys.exit(1)
    else:
        print("  Готово!")
        print()
        print("  Запуск: start.bat")
        print("=" * 60)


if __name__ == "__main__":
    main()
