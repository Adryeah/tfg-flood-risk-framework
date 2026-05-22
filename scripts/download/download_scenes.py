"""
Descarga las 24 escenas listadas en data/catalogo_escenas_filtrado.csv
desde Copernicus Data Space Ecosystem, las extrae a .SAFE y limpia los .zip.

Características:
- Autenticación OAuth2 con refresco automático de token (10 min de vida).
- Descarga secuencial (una a una) con reintentos (hasta 3 intentos).
- Skip inteligente si el .SAFE ya existe extraído.
- Barra de progreso tqdm por archivo.
- Logging detallado y resumen final.

Uso:
    python scripts/download/download_scenes.py
"""

from __future__ import annotations

import argparse
import logging
import shutil
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd
import requests
import yaml
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
CHUNK_SIZE = 8 * 1024 * 1024      # 8 MB por chunk
MAX_ATTEMPTS = 3
RETRY_BACKOFF = 5.0               # segundos, escalado linealmente
TOKEN_SAFETY_MARGIN = 30          # segundos antes de expiración para refrescar
HTTP_TIMEOUT_CONNECT = 30
HTTP_TIMEOUT_READ = 600

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Gestión de token OAuth2
# ---------------------------------------------------------------------------
@dataclass
class TokenManager:
    username: str
    password: str
    access_token: str = ""
    refresh_token: str = ""
    expires_at: float = 0.0

    def _request_new_token(self) -> None:
        logger.info("Solicitando nuevo token de acceso…")
        resp = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "password",
                "client_id": "cdse-public",
                "username": self.username,
                "password": self.password,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        self.access_token = data["access_token"]
        self.refresh_token = data.get("refresh_token", "")
        self.expires_at = time.time() + float(data.get("expires_in", 600))
        logger.info("Token obtenido. Expira en %.0f s.", data.get("expires_in", 600))

    def _try_refresh(self) -> bool:
        if not self.refresh_token:
            return False
        try:
            resp = requests.post(
                TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "client_id": "cdse-public",
                    "refresh_token": self.refresh_token,
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            self.access_token = data["access_token"]
            self.refresh_token = data.get("refresh_token", self.refresh_token)
            self.expires_at = time.time() + float(data.get("expires_in", 600))
            logger.info("Token refrescado. Nueva expiración en %.0f s.", data.get("expires_in", 600))
            return True
        except requests.RequestException as exc:
            logger.warning("Refresh falló (%s). Se pedirá uno nuevo.", exc)
            return False

    def get_valid_token(self) -> str:
        """Devuelve un access_token vigente, refrescando/renovando si hace falta."""
        if not self.access_token or time.time() >= self.expires_at - TOKEN_SAFETY_MARGIN:
            if self.refresh_token and self._try_refresh():
                return self.access_token
            self._request_new_token()
        return self.access_token


# ---------------------------------------------------------------------------
# Descarga de una escena
# ---------------------------------------------------------------------------
@dataclass
class DownloadResult:
    title: str
    date: str
    status: str            # "ok", "skip", "fail"
    size_mb: float = 0.0
    duration_s: float = 0.0
    error: str = ""
    notes: list[str] = field(default_factory=list)


def _download_stream(
    url: str,
    token: str,
    target_zip: Path,
    expected_mb: float,
    title: str,
) -> None:
    """Descarga el .zip al disco con barra de progreso. Lanza excepción si falla."""
    headers = {"Authorization": f"Bearer {token}"}
    with requests.get(
        url,
        headers=headers,
        stream=True,
        allow_redirects=True,
        timeout=(HTTP_TIMEOUT_CONNECT, HTTP_TIMEOUT_READ),
    ) as resp:
        resp.raise_for_status()
        total_bytes = int(resp.headers.get("Content-Length", 0)) or int(expected_mb * 1024 * 1024)
        target_zip.parent.mkdir(parents=True, exist_ok=True)
        with open(target_zip, "wb") as fh, tqdm(
            total=total_bytes,
            unit="B",
            unit_scale=True,
            unit_divisor=1024,
            desc=title[:40],
            leave=False,
        ) as pbar:
            for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                if chunk:
                    fh.write(chunk)
                    pbar.update(len(chunk))


def _long_path(p: Path) -> str:
    """
    Devuelve la ruta en formato \\\\?\\ para sortear el limite de 260 chars en Windows.
    En otros SO devuelve la ruta normal.
    """
    if __import__("os").name != "nt":
        return str(p)
    abs_path = str(p.resolve())
    if abs_path.startswith("\\\\?\\"):
        return abs_path
    if abs_path.startswith("\\\\"):
        return "\\\\?\\UNC\\" + abs_path[2:]
    return "\\\\?\\" + abs_path


def _extract_zip_to_safe(zip_path: Path, raw_dir: Path, safe_name: str) -> Path:
    """
    Extrae el zip directamente en raw_dir. El zip contiene una carpeta raiz
    <safe_name> asi que el resultado final es raw_dir/<safe_name>/...
    Devuelve la ruta del .SAFE resultante. Usa prefijo \\\\?\\ en Windows para
    rutas largas.
    """
    target_safe = raw_dir / safe_name
    if target_safe.exists():
        shutil.rmtree(_long_path(target_safe), ignore_errors=True)

    with zipfile.ZipFile(zip_path, "r") as zf:
        # Detecta la carpeta raiz real dentro del zip
        names = zf.namelist()
        top_dirs = {n.split("/")[0] for n in names if "/" in n}
        zf.extractall(_long_path(raw_dir))

        # Si el zip no se extrajo con el nombre esperado, renombra
        if safe_name not in top_dirs and len(top_dirs) == 1:
            actual_root = raw_dir / next(iter(top_dirs))
            if actual_root.exists():
                shutil.move(_long_path(actual_root), _long_path(target_safe))

    return target_safe


def download_one(
    row: pd.Series,
    raw_dir: Path,
    token_mgr: TokenManager,
) -> DownloadResult:
    """Descarga + extrae una escena. Devuelve DownloadResult."""
    title = row["title"]
    safe_name = title if title.endswith(".SAFE") else title + ".SAFE"
    date = str(row["date"])
    expected_mb = float(row["size_mb"])
    url = row["download_url"]

    result = DownloadResult(title=title, date=date, status="fail", size_mb=expected_mb)

    safe_path = raw_dir / safe_name
    zip_path = raw_dir / (safe_name + ".zip")

    # Skip si ya existe el .SAFE extraído
    if safe_path.exists() and any(safe_path.iterdir()):
        logger.info("[SKIP] %s ya existe extraído.", safe_name)
        result.status = "skip"
        result.notes.append("ya existe extraido")
        return result

    t0 = time.time()
    last_error = ""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            token = token_mgr.get_valid_token()
            logger.info("[%d/%d] Descargando %s (%.1f MB)…", attempt, MAX_ATTEMPTS, safe_name, expected_mb)
            _download_stream(url, token, zip_path, expected_mb, title)
            break
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else 0
            last_error = f"HTTP {status}: {exc}"
            logger.warning("Fallo HTTP en intento %d/%d: %s", attempt, MAX_ATTEMPTS, last_error)
            if status == 401:
                # Forzar renovación de token
                token_mgr.access_token = ""
                token_mgr.expires_at = 0
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_BACKOFF * attempt)
        except requests.RequestException as exc:
            last_error = str(exc)
            logger.warning("Error de red en intento %d/%d: %s", attempt, MAX_ATTEMPTS, last_error)
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_BACKOFF * attempt)
        except Exception as exc:   # noqa: BLE001
            last_error = f"{type(exc).__name__}: {exc}"
            logger.exception("Error inesperado en intento %d/%d.", attempt, MAX_ATTEMPTS)
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_BACKOFF * attempt)
    else:
        # Bucle agotado sin éxito
        result.error = last_error or "descarga fallida"
        if zip_path.exists():
            zip_path.unlink(missing_ok=True)
        result.duration_s = time.time() - t0
        logger.error("[FAIL] %s — %s", safe_name, result.error)
        return result

    # Verificación de tamaño (tolerancia 5%)
    actual_mb = zip_path.stat().st_size / (1024 * 1024)
    tolerance = max(expected_mb * 0.05, 5.0)
    if abs(actual_mb - expected_mb) > tolerance:
        result.error = f"tamano inesperado: {actual_mb:.1f} MB vs esperado {expected_mb:.1f} MB"
        logger.error("[FAIL] %s — %s", safe_name, result.error)
        zip_path.unlink(missing_ok=True)
        result.duration_s = time.time() - t0
        return result

    # Extracción
    try:
        logger.info("Extrayendo %s…", zip_path.name)
        _extract_zip_to_safe(zip_path, raw_dir, safe_name)
    except (zipfile.BadZipFile, OSError) as exc:
        result.error = f"extraccion fallida: {exc}"
        logger.error("[FAIL] %s — %s", safe_name, result.error)
        zip_path.unlink(missing_ok=True)
        result.duration_s = time.time() - t0
        return result

    # Borrar el zip
    zip_path.unlink(missing_ok=True)

    result.duration_s = time.time() - t0
    result.status = "ok"
    logger.info("[OK]   %s (%.1f MB) en %.1fs", safe_name, actual_mb, result.duration_s)
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def _load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _inspect_safe(safe_path: Path) -> None:
    """Imprime la estructura interna del .SAFE descargado (para verificacion)."""
    if not safe_path.exists():
        logger.warning("No se encontro %s para inspeccionar.", safe_path)
        return
    subdirs = sorted([p.name for p in safe_path.iterdir() if p.is_dir()])
    files = sorted([p.name for p in safe_path.iterdir() if p.is_file()])
    measurement_dir = safe_path / "measurement"
    annotation_dir = safe_path / "annotation"
    print("-" * 72)
    print(f" Estructura de {safe_path.name}")
    print("-" * 72)
    print(f"   Subcarpetas  : {subdirs}")
    print(f"   Ficheros raiz: {files}")
    if measurement_dir.is_dir():
        m_files = sorted([p.name for p in measurement_dir.iterdir()])
        print(f"   measurement/ : {len(m_files)} archivos -> {m_files}")
    if annotation_dir.is_dir():
        a_files = sorted([p.name for p in annotation_dir.iterdir() if p.is_file()])
        print(f"   annotation/  : {len(a_files)} archivos -> {a_files[:4]}{' ...' if len(a_files) > 4 else ''}")
    print("-" * 72)


def main() -> None:
    parser = argparse.ArgumentParser(description="Descarga escenas S1 del catalogo filtrado.")
    parser.add_argument(
        "--limit", type=int, default=0,
        help="Descargar solo las primeras N escenas (0 = todas).",
    )
    parser.add_argument(
        "--catalog", type=Path, default=None,
        help="Ruta al CSV de catalogo (default: data/catalogo_escenas_filtrado.csv).",
    )
    parser.add_argument(
        "--raw-dir", type=Path, default=None,
        help="Directorio de salida para los .SAFE (default: data/sentinel1/raw/).",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    paths = _load_yaml(repo_root / "config" / "paths.yaml")

    creds_path = repo_root / "config" / "copernicus_credentials.yaml"
    if not creds_path.exists():
        raise FileNotFoundError(f"Faltan credenciales: {creds_path}")
    creds = _load_yaml(creds_path)

    if args.catalog is not None:
        filtered_path = args.catalog.resolve()
    else:
        catalog_path = repo_root / paths["data"]["catalog"]
        filtered_path = catalog_path.with_name("catalogo_escenas_filtrado.csv")
    if not filtered_path.exists():
        raise FileNotFoundError(
            f"No existe {filtered_path}. Ejecuta primero filter_scenes.py."
        )

    if args.raw_dir is not None:
        raw_dir = args.raw_dir.resolve()
    else:
        raw_dir = repo_root / paths["data"]["sentinel1"]["raw"]
    raw_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(filtered_path)
    if args.limit > 0:
        df = df.head(args.limit).copy()
        logger.info("Modo prueba: limitando a las primeras %d escenas.", args.limit)
    logger.info("Escenas a descargar: %d (destino: %s)", len(df), raw_dir)

    token_mgr = TokenManager(username=creds["username"], password=creds["password"])
    # Token inicial para fallar rápido si las credenciales son malas
    token_mgr.get_valid_token()

    results: list[DownloadResult] = []
    t_global = time.time()

    for idx, row in df.iterrows():
        logger.info("=" * 72)
        logger.info("Escena %d/%d - %s (%s)", idx + 1, len(df), row["title"], row["date"])
        logger.info("URL descarga: %s", row["download_url"])
        result = download_one(row, raw_dir, token_mgr)
        results.append(result)
        if result.status in ("ok", "skip"):
            safe_name = row["title"] if row["title"].endswith(".SAFE") else row["title"] + ".SAFE"
            _inspect_safe(raw_dir / safe_name)

    total_time = time.time() - t_global

    # -------------------------------------------------------------------
    # Resumen
    # -------------------------------------------------------------------
    ok = [r for r in results if r.status == "ok"]
    skip = [r for r in results if r.status == "skip"]
    fail = [r for r in results if r.status == "fail"]
    total_mb = sum(r.size_mb for r in ok) + sum(r.size_mb for r in skip)

    print("\n" + "=" * 72)
    print(" RESUMEN DE DESCARGA")
    print("=" * 72)
    print(f" Descargadas OK : {len(ok):>3d} / {len(results)}")
    print(f" Ya existian    : {len(skip):>3d}")
    print(f" Fallidas       : {len(fail):>3d}")
    print(f" Tiempo total   : {total_time / 60:.1f} min ({total_time:.0f} s)")
    print(f" Tamano total   : {total_mb / 1024:.2f} GB  ({total_mb:.0f} MB)")
    print("-" * 72)

    if fail:
        print(" ESCENAS FALLIDAS:")
        for r in fail:
            print(f"   - {r.date}  {r.title}")
            print(f"       motivo: {r.error}")
    print("=" * 72 + "\n")


if __name__ == "__main__":
    main()
