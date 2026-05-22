"""
Procesa en batch todas las escenas del catalogo filtrado invocando
process_single_scene.py en un subprocess por escena (aislamiento JVM,
ver CLAUDE.md - esa_snappy tiene fugas de memoria conocidas).

Para cada escena:
  1. Si el GeoTIFF destino ya existe en processed/, SKIP.
  2. Si el .SAFE no esta en raw/, SKIP con warning.
  3. Lanza process_single_scene.py con --keep-safe (timeout 1800 s).
  4. Tras el subprocess (JVM ya muerta), borra el .SAFE con
     'cmd /c rmdir /s /q'. Hacerlo dentro del subprocess no funciona:
     SNAP retiene handles del measurement/*.tiff.
  5. Verifica que el GeoTIFF existe y pesa > 1 MB.

Uso:
    python scripts/preprocessing/sar/batch_process.py
    python scripts/preprocessing/sar/batch_process.py --limit 2
    python scripts/preprocessing/sar/batch_process.py --catalog path/otro.csv
"""
from __future__ import annotations

import argparse
import csv
import logging
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


REPO_ROOT = Path(__file__).resolve().parents[3]
VENV_PY = REPO_ROOT / ".venv" / "Scripts" / "python.exe"
SINGLE_SCENE = REPO_ROOT / "scripts" / "preprocessing" / "sar" / "process_single_scene.py"

PER_SCENE_TIMEOUT_S = 1800   # 30 min por escena
MIN_OUTPUT_MB = 1.0          # umbral de sanidad para el GeoTIFF final


# ---------------------------------------------------------------------------
# Modelo de resultado
# ---------------------------------------------------------------------------

@dataclass
class SceneResult:
    """Resultado del procesamiento de una unica escena."""
    title: str
    status: str          # ok | skip_exists | skip_missing_safe |
                         # fail_subprocess | fail_timeout |
                         # fail_output_missing | fail_output_small |
                         # interrupted
    duration_s: float
    freed_mb: float
    output_path: Optional[Path]
    message: str


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def _load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _scene_date(safe_name: str) -> Optional[str]:
    """Extrae YYYYMMDD del nombre del producto SAFE."""
    m = re.search(r"(\d{8})T\d{6}", safe_name)
    return m.group(1) if m else None


def _folder_size_mb(path: Path) -> float:
    """Tamano total de un arbol de ficheros en MB (tolera errores de acceso)."""
    total = 0
    for p in path.rglob("*"):
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:
            pass
    return total / (1024 * 1024)


def _find_output(processed_dir: Path, date_yyyymmdd: str) -> Optional[Path]:
    """Busca el GeoTIFF destino para una fecha dada (cualquier orbita)."""
    matches = sorted(processed_dir.glob(f"S1_sigma0_{date_yyyymmdd}_orb*.tif"))
    return matches[0] if matches else None


def _delete_safe(safe_path: Path) -> None:
    """Borra un .SAFE con 'cmd /c rmdir /s /q' (maneja rutas largas Windows)."""
    subprocess.run(
        ["cmd", "/c", "rmdir", "/s", "/q", str(safe_path)],
        check=True,
    )


# ---------------------------------------------------------------------------
# Procesamiento unitario
# ---------------------------------------------------------------------------

def process_one(
    safe_path: Path,
    raw_dir: Path,
    processed_dir: Path,
) -> SceneResult:
    """Procesa una escena: comprueba idempotencia, lanza subprocess, limpia."""
    title = safe_path.name
    t0 = time.time()

    date_str = _scene_date(title)
    if date_str is None:
        msg = "no se pudo parsear la fecha del nombre SAFE"
        logger.error("FAIL  %s -- %s", title, msg)
        return SceneResult(title, "fail_subprocess", 0.0, 0.0, None, msg)

    existing = _find_output(processed_dir, date_str)
    if existing is not None:
        size_mb = existing.stat().st_size / (1024 * 1024)
        logger.info("SKIP  %s -- ya existe %s (%.1f MB)",
                    title, existing.name, size_mb)
        return SceneResult(title, "skip_exists", 0.0, 0.0, existing,
                           "GeoTIFF ya existente")

    if not safe_path.exists():
        logger.warning("SKIP  %s -- no existe en %s", title, raw_dir)
        return SceneResult(title, "skip_missing_safe", 0.0, 0.0, None,
                           ".SAFE no encontrado en raw/")

    safe_size_mb = _folder_size_mb(safe_path)
    logger.info("PROC  %s (.SAFE %.0f MB)", title, safe_size_mb)

    # --------------------------- subprocess ----------------------------
    try:
        subprocess.run(
            [str(VENV_PY), str(SINGLE_SCENE), str(safe_path), "--keep-safe"],
            check=True,
            timeout=PER_SCENE_TIMEOUT_S,
            cwd=str(REPO_ROOT),
        )
    except subprocess.TimeoutExpired:
        duration = time.time() - t0
        msg = f"timeout tras {PER_SCENE_TIMEOUT_S} s"
        logger.error("FAIL  %s -- %s", title, msg)
        return SceneResult(title, "fail_timeout", duration, 0.0, None, msg)
    except subprocess.CalledProcessError as exc:
        duration = time.time() - t0
        msg = f"subprocess exit {exc.returncode}"
        logger.error("FAIL  %s -- %s", title, msg)
        return SceneResult(title, "fail_subprocess", duration, 0.0, None, msg)

    # --------------------------- limpieza .SAFE ------------------------
    freed_mb = 0.0
    if safe_path.exists():
        try:
            _delete_safe(safe_path)
            freed_mb = safe_size_mb
            logger.info("      .SAFE borrado (%.0f MB liberados)", safe_size_mb)
        except subprocess.CalledProcessError as exc:
            logger.warning("      no se pudo borrar %s: exit %d",
                           safe_path.name, exc.returncode)

    # --------------------------- verificacion GeoTIFF ------------------
    out = _find_output(processed_dir, date_str)
    if out is None:
        duration = time.time() - t0
        msg = "GeoTIFF destino no encontrado tras subprocess OK"
        logger.error("FAIL  %s -- %s", title, msg)
        return SceneResult(title, "fail_output_missing",
                           duration, freed_mb, None, msg)

    size_mb = out.stat().st_size / (1024 * 1024)
    if size_mb < MIN_OUTPUT_MB:
        duration = time.time() - t0
        msg = f"GeoTIFF {size_mb:.2f} MB < minimo {MIN_OUTPUT_MB} MB"
        logger.error("FAIL  %s -- %s", title, msg)
        return SceneResult(title, "fail_output_small",
                           duration, freed_mb, out, msg)

    duration = time.time() - t0
    logger.info("OK    %s (%.1f min, %s, %.1f MB)",
                title, duration / 60, out.name, size_mb)
    return SceneResult(title, "ok", duration, freed_mb, out,
                       "procesado correctamente")


# ---------------------------------------------------------------------------
# Orquestador
# ---------------------------------------------------------------------------

def _print_summary(results: list[SceneResult], total_s: float) -> None:
    """Imprime el resumen final del batch."""
    ok = [r for r in results if r.status == "ok"]
    skipped = [r for r in results if r.status.startswith("skip")]
    failed = [r for r in results
              if r.status.startswith("fail") or r.status == "interrupted"]

    logger.info("=" * 72)
    logger.info("RESUMEN BATCH")
    logger.info("  Escenas OK:        %d", len(ok))
    logger.info("  Escenas SKIP:      %d", len(skipped))
    logger.info("  Escenas FAIL:      %d", len(failed))
    logger.info("  Tiempo total:      %.1f min", total_s / 60)
    if ok:
        avg = sum(r.duration_s for r in ok) / len(ok) / 60
        logger.info("  Tiempo medio OK:   %.1f min/escena", avg)
    total_freed_gb = sum(r.freed_mb for r in results) / 1024
    logger.info("  Espacio liberado:  %.2f GB", total_freed_gb)
    if failed:
        logger.info("  Fallos:")
        for r in failed:
            logger.info("    - %s [%s]: %s", r.title, r.status, r.message)
    logger.info("=" * 72)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Procesa en batch las escenas del catalogo filtrado."
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Procesar solo las N primeras escenas (para validacion).",
    )
    parser.add_argument(
        "--catalog", type=Path, default=None,
        help="Ruta al CSV de catalogo filtrado "
             "(default: data/catalogo_escenas_filtrado.csv).",
    )
    args = parser.parse_args()

    # --------------------------- checks previos ------------------------
    if not VENV_PY.exists():
        logger.error("No existe el Python del venv: %s", VENV_PY)
        logger.error("Crea el venv y configura esa_snappy antes de lanzar batch.")
        return 1
    if not SINGLE_SCENE.exists():
        logger.error("No existe process_single_scene.py: %s", SINGLE_SCENE)
        return 1

    paths = _load_yaml(REPO_ROOT / "config" / "paths.yaml")
    raw_dir = REPO_ROOT / paths["data"]["sentinel1"]["raw"]
    processed_dir = REPO_ROOT / paths["data"]["sentinel1"]["processed"]
    processed_dir.mkdir(parents=True, exist_ok=True)

    catalog = args.catalog or (REPO_ROOT / "data" / "catalogo_escenas_filtrado.csv")
    if not catalog.exists():
        logger.error("No existe el catalogo: %s", catalog)
        return 1

    # --------------------------- catalogo ------------------------------
    scenes: list[dict] = []
    with catalog.open("r", encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            scenes.append(row)
    if args.limit is not None:
        scenes = scenes[: args.limit]

    logger.info("=" * 72)
    logger.info("BATCH SAR -- %d escena(s) a procesar", len(scenes))
    logger.info("Catalogo:  %s", catalog)
    logger.info("Raw:       %s", raw_dir)
    logger.info("Processed: %s", processed_dir)
    logger.info("Timeout:   %d s por escena", PER_SCENE_TIMEOUT_S)
    logger.info("=" * 72)

    # --------------------------- bucle principal -----------------------
    t_global = time.time()
    results: list[SceneResult] = []
    current_title: Optional[str] = None
    try:
        for i, row in enumerate(scenes, start=1):
            current_title = row["title"]
            safe_path = raw_dir / current_title
            logger.info("[%d/%d] %s", i, len(scenes), current_title)
            results.append(process_one(safe_path, raw_dir, processed_dir))
    except KeyboardInterrupt:
        # El Ctrl+C ya mato al subprocess actual (SIGINT se propaga).
        # Registramos la interrupcion y salimos al resumen.
        logger.warning("Ctrl+C recibido. Terminando limpiamente tras '%s'.",
                       current_title or "?")
        results.append(SceneResult(
            current_title or "?", "interrupted", 0.0, 0.0, None,
            "interrumpido por el usuario (Ctrl+C)",
        ))

    _print_summary(results, time.time() - t_global)

    failed = [r for r in results
              if r.status.startswith("fail") or r.status == "interrupted"]
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
