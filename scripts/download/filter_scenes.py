"""
Filtra data/catalogo_escenas.csv y genera data/catalogo_escenas_filtrado.csv
con 24 escenas estratégicamente seleccionadas:

- Una única órbita relativa (la más frecuente) → geometría idéntica entre fechas.
- Una escena por mes entre octubre 2022 y septiembre 2024 (24 meses).
- Dentro de cada mes, se elige la escena cuya fecha está más cerca del día 15.

Uso:
    python scripts/download/filter_scenes.py
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd
import yaml

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Rango de muestreo mensual (24 meses: oct 2022 → sep 2024)
SAMPLE_START = pd.Timestamp("2022-10-01")
SAMPLE_END = pd.Timestamp("2024-09-30")


def _load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def select_monthly_scenes(df_orbit: pd.DataFrame) -> pd.DataFrame:
    """
    Para cada mes dentro del rango (oct 2022 – sep 2024), elige la escena
    cuya fecha está más cerca del día 15 del mes. Si un mes no tiene
    escenas, se omite.
    """
    df = df_orbit.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df[(df["date"] >= SAMPLE_START) & (df["date"] <= SAMPLE_END)]

    # Elimina duplicados exactos de fecha (mismo día, mismo producto reprocesado)
    df = df.sort_values("date").drop_duplicates(subset=["date"], keep="first")

    # Genera la lista de los 24 meses objetivo
    target_months = pd.date_range(SAMPLE_START, SAMPLE_END, freq="MS")

    selected_rows: list[pd.Series] = []
    for month_start in target_months:
        year, month = month_start.year, month_start.month
        df_month = df[(df["date"].dt.year == year) & (df["date"].dt.month == month)]
        if df_month.empty:
            logger.warning("Sin escenas en %04d-%02d", year, month)
            continue
        target_day = pd.Timestamp(year=year, month=month, day=15)
        idx_closest = (df_month["date"] - target_day).abs().idxmin()
        selected_rows.append(df.loc[idx_closest])

    result = pd.DataFrame(selected_rows).reset_index(drop=True)
    result["date"] = result["date"].dt.strftime("%Y-%m-%d")
    return result


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    paths = _load_yaml(repo_root / "config" / "paths.yaml")

    catalog_path = repo_root / paths["data"]["catalog"]
    filtered_path = catalog_path.with_name("catalogo_escenas_filtrado.csv")

    if not catalog_path.exists():
        raise FileNotFoundError(f"No se encontró el catálogo en {catalog_path}")

    df = pd.read_csv(catalog_path)
    logger.info("Catálogo cargado: %d escenas totales.", len(df))

    # 1. Órbita relativa más frecuente
    orbit_counts = df["orbit_number"].value_counts()
    top_orbit = orbit_counts.idxmax()
    logger.info(
        "Órbita relativa más frecuente: %s (%d escenas). Distribución: %s",
        top_orbit,
        int(orbit_counts.loc[top_orbit]),
        orbit_counts.to_dict(),
    )
    df_orbit = df[df["orbit_number"] == top_orbit].copy()

    # 2–3. Selección mensual (más cercana al día 15)
    filtered = select_monthly_scenes(df_orbit)

    if len(filtered) != 24:
        logger.warning(
            "Se esperaban 24 escenas, se obtuvieron %d. Revisa meses faltantes.",
            len(filtered),
        )

    # Guardado
    filtered.to_csv(filtered_path, index=False, encoding="utf-8")
    logger.info("Catálogo filtrado guardado en %s", filtered_path)

    # 4. Resumen
    total_gb = filtered["size_mb"].sum() / 1024
    print("\n" + "=" * 72)
    print(f" RESUMEN — Catálogo filtrado")
    print("=" * 72)
    print(f" Órbita relativa seleccionada : {top_orbit}")
    print(f" Escenas seleccionadas         : {len(filtered)}")
    print(f" Tamaño total estimado         : {total_gb:.2f} GB")
    print(f" Rango temporal                : {filtered['date'].min()} -> {filtered['date'].max()}")
    print("-" * 72)
    print(f" {'Mes':<10} {'Fecha escena':<14} {'Tamaño (MB)':>12}")
    print("-" * 72)
    for _, row in filtered.iterrows():
        month_label = row["date"][:7]
        print(f" {month_label:<10} {row['date']:<14} {row['size_mb']:>12.1f}")
    print("-" * 72)

    # Verificación distribución 1/mes
    months_series = pd.to_datetime(filtered["date"]).dt.to_period("M")
    counts_per_month = months_series.value_counts().sort_index()
    duplicates = counts_per_month[counts_per_month > 1]
    if duplicates.empty and len(counts_per_month) == 24:
        print(" Distribucion mensual          : [OK] exactamente 1 escena/mes x 24 meses")
    else:
        print(f" Distribucion mensual          : [!] {len(counts_per_month)} meses, duplicados: {duplicates.to_dict()}")
    print("=" * 72 + "\n")


if __name__ == "__main__":
    main()
