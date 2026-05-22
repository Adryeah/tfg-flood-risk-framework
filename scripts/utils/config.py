"""Carga y expone los parámetros de configuración del proyecto."""

from pathlib import Path
import yaml

# Raíz del repositorio (dos niveles arriba de scripts/utils/)
_REPO_ROOT = Path(__file__).resolve().parents[2]

_PARAMS_PATH = _REPO_ROOT / "config" / "params.yaml"
_PATHS_PATH  = _REPO_ROOT / "config" / "paths.yaml"


def _load_yaml(path: Path) -> dict:
    """Carga un fichero YAML y devuelve su contenido como dict."""
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _resolve_paths(paths_dict: dict, root: Path) -> dict:
    """Convierte todos los valores de cadena en un dict anidado a Path absolutos."""
    resolved = {}
    for key, value in paths_dict.items():
        if isinstance(value, dict):
            resolved[key] = _resolve_paths(value, root)
        elif isinstance(value, str):
            resolved[key] = root / value
        else:
            resolved[key] = value
    return resolved


# ---------------------------------------------------------------------------
# Variables globales exportadas
# ---------------------------------------------------------------------------

PARAMS: dict = _load_yaml(_PARAMS_PATH)

_raw_paths: dict = _load_yaml(_PATHS_PATH)
PATHS: dict = _resolve_paths(_raw_paths, _REPO_ROOT)

STUDY_AREA: dict      = PARAMS["study_area"]
EXTRAP_AREA: dict     = PARAMS["extrapolation_area"]
DATES: dict           = PARAMS["dates"]
MODEL_PARAMS: dict    = PARAMS["model"]
SENTINEL1_PARAMS: dict = PARAMS["sentinel1"]
SENTINEL2_PARAMS: dict = PARAMS["sentinel2"]
PREPROC_PARAMS: dict  = PARAMS["preprocessing"]


if __name__ == "__main__":
    print("=== PARAMS ===")
    import pprint
    pprint.pprint(PARAMS)
    print("\n=== PATHS ===")
    pprint.pprint(PATHS)
