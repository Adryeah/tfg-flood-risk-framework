# Debugging `esa_snappy` — bugs resueltos al portar el pipeline SAR a Python

**Contexto.** El pipeline SAR de 5 pasos funcionaba en SNAP Desktop (Semana 1,
2 escenas manuales). Al automatizarlo en Python con `esa_snappy 1.1.2` +
SNAP 13.0.0 aparecieron 4 bugs que impedían generar el GeoTIFF o que
producían un raster vacío. Esta nota documenta cada uno con síntoma,
causa y fix. Sirve de referencia si se sube de versión SNAP / `esa_snappy`,
si el pipeline deja de funcionar, o para el tribunal.

Versiones de referencia cuando se resolvieron:

- SNAP 13.0.0 (C:\esa-snap)
- `esa_snappy` 1.1.2 (PyPI) sobre Python 3.12.0 en `.venv/`
- Windows 11 Pro 10.0.26200

---

## Bug 1 — `HashMap.put()` con tipos nativos de Python

**Síntoma.** El primer operador del pipeline (`Apply-Orbit-File`) falla con:

```
org.esa.snap.core.gpf.OperatorException:
Operator 'ApplyOrbitFileOp': Value for 'Polynomial Degree' must be of type 'int'.
```

**Causa.** En `esa_snappy 1.1.2` los enteros Python se traducen a
`java.lang.Long` en lugar de `Integer`. Algunos operadores SNAP comprueban
el tipo exacto y rechazan la conversión implícita. Lo mismo ocurre con
`bool → Boolean` y `float → Double` en ciertas rutas.

**Fix.** Pasar **todos** los valores escalares al `HashMap` como **strings**.
SNAP los parsea internamente al tipo que declara el operador.

```python
# mal:
params.put("polyDegree", 3)
params.put("removeThermalNoise", True)
params.put("pixelSpacingInMeter", 10.0)

# bien:
params.put("polyDegree", "3")
params.put("removeThermalNoise", "true")
params.put("pixelSpacingInMeter", "10.0")
```

Excepción: los strings que ya son strings (`orbitType`, `demName`,
`mapProjection`, `selectedPolarisations`, nombre del filtro speckle)
se pasan tal cual.

---

## Bug 2 — `pixelSpacingInMeter` sobre `mapProjection = WGS84(DD)`

**Síntoma.** La corrección de terreno corre sin error y produce un
GeoTIFF del tamaño esperado, pero todos los píxeles son cero. SNAP
registra:

```
WARNING: ... RangeDopplerGeocodingOp: Terrain-Correction$... error:
no valid output was produced. Please verify the DEM
```

Incluso con el DEM descargado y presente en `%USERPROFILE%\.snap\auxdata\dem\`.

**Causa.** `WGS84(DD)` es una proyección geográfica en grados; pedir
pixel spacing en metros es ambiguo. El operador termina generando un
raster que no se rellena.

**Fix.** Usar una proyección métrica coherente con `pixelSpacingInMeter`.
Valencia está en UTM 30N (EPSG:32630), que además es la regla explícita
de `CLAUDE.md` (regla 3: "GeoTIFF, CRS EPSG:32630").

```python
p5_params.put("mapProjection", "EPSG:32630")   # UTM 30N
p5_params.put("pixelSpacingInMeter", "10.0")
```

El CRS se lee de `params.yaml` (`study_area.epsg`) y se formatea como
`EPSG:{codigo}`.

---

## Bug 3 — `Subset` antes de `Terrain-Correction` deja la TC sin salida

**Síntoma.** Idéntico al bug 2 (TC con 0 píxeles válidos) aun con DEM
presente y proyección UTM correcta. Reproducible quitando sólo el
`Subset` y dejando el resto igual.

**Causa.** Un `Subset` con `geoRegion` WKT aplicado antes de la TC sobre
un producto S1 en slant-range deja las coordenadas del producto en un
estado en el que `RangeDopplerGeocodingOp` no puede mapear píxeles de
radar a celdas de salida.

**Fix.** Aplicar `Subset` **después** del TC (sobre un producto ya
geocodificado). Para no chocar con el límite de 4 GB del TIFF clásico
durante la TC, la TC corre sobre la escena completa y el Subset final
recorta al `study_area.bbox` de `params.yaml`.

Orden correcto del pipeline:

```
Read -> Apply-Orbit-File -> ThermalNoiseRemoval -> Calibration
     -> Speckle-Filter -> Terrain-Correction -> Subset -> Write
```

En `process_single_scene.py` el polígono de recorte se construye así:

```python
bbox = params["study_area"]["bbox"]   # [lon_min, lat_min, lon_max, lat_max]
subset_wkt = (
    f"POLYGON(({lon_min} {lat_min}, {lon_max} {lat_min}, "
    f"{lon_max} {lat_max}, {lon_min} {lat_max}, {lon_min} {lat_min}))"
)
```

---

## Bug 4 — `SRTM 3Sec` no se resuelve de forma fiable en SNAP 13

**Síntoma.** Mismo warning que el bug 2, pero la causa es distinta:
el autodownload del DEM no deja ningún fichero en
`%USERPROFILE%\.snap\auxdata\dem\SRTM 3Sec\` y/o la TC no encuentra cobertura.

**Causa.** SNAP 13 está transicionando a Copernicus DEM como default.
SRTM 3Sec (~90 m, ESA/CGIAR) ya no es el más fiable para autodownload en
esta versión.

**Fix.** Usar `SRTM 1Sec HGT` (NASA SRTM 30 m). Además concuerda con
`CLAUDE.md` ("Datos: … NASA SRTM 30m"). `params.yaml` queda:

```yaml
preprocessing:
  dem: SRTM 1Sec HGT
```

Alternativa si SRTM 1Sec también falla: `Copernicus 30m Global DEM`
(TanDEM-X revisitado, 2021+). Ambos valores quedan reconocidos en la
lista de DEMs válidos del script.

---

## Notas colaterales (no son bugs pero conviene tenerlas)

### Orden de bandas en el GeoTIFF

SNAP escribe las bandas **en orden alfabético** y **no** conserva sus
nombres en el GeoTIFF de salida. Con polarizaciones `"VV,VH"` el
fichero tiene:

- Banda 1: `Sigma0_VH`
- Banda 2: `Sigma0_VV`

(porque `H < V` alfabéticamente).

Mitigación aplicada en `process_single_scene.py`: después de
`ProductIO.writeProduct`, se reinyectan las descripciones con rasterio
para que el consumidor pueda identificar VV y VH por nombre:

```python
with rasterio.open(out_path, "r+") as ds:
    ds.descriptions = tuple(p6.getBandNames())
```

### El `.SAFE` no se puede borrar desde el mismo proceso Python

El JVM de SNAP retiene handles de los `measurement/*.tiff` del `.SAFE`
durante toda la vida del proceso, incluso tras `product.dispose()`.
Cualquier `rmtree` / `robocopy /MIR` desde el mismo proceso falla con
`[WinError 145] El directorio no está vacío`.

Por eso `process_single_scene.py` se llama siempre con `--keep-safe`
desde `batch_process.py`, y es `batch_process.py` quien borra el
`.SAFE` con `cmd /c rmdir /s /q <path>` **después** de que el
subprocess termine (JVM muerta → handles liberados).

### Warnings benignos al arrancar `esa_snappy`

Aparecen siempre, no afectan al pipeline:

- `OpenJDK 64-Bit Server VM warning: Options -Xverify:none and -noverify were deprecated`
- `Error while parsing JAI registry file ... A descriptor is already registered against`
- `SLF4J: Failed to load class "org.slf4j.impl.StaticLoggerBinder"`
- `INFO: org.esa.snap.core.util.EngineVersionCheckActivator: Please check regularly for new updates`

Al leer el GeoTIFF con rasterio, puede aparecer:

- `CPLE_AppDefined in TIFFReadDirectory: Sum of Photometric type-related color channels and ExtraSamples doesn't match SamplesPerPixel`

Viene de GDAL al abrir TIFFs multi-banda que SNAP escribe sin
`PhotometricInterpretation=MinIsBlack`. No afecta a la lectura.
