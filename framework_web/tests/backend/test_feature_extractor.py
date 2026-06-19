"""Tests del FeatureExtractor — distancia metrica con correccion cos(lat).

Blinda el bug del sesgo E-W: multiplicar grados de longitud por 111 km como
si fueran de latitud sobreestimaba ~30% la distancia cerca del threshold de
200 m a la latitud de Valencia.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.feature_extractor import planar_distance_m

LAT_VLC = 39.4  # latitud de la zona de estudio


def test_pure_latitude_offset_is_111m_per_milligrade():
    # 0.001 grados de latitud ~ 111 m, sin depender de cos(lat).
    d = planar_distance_m(LAT_VLC, -0.4, LAT_VLC + 0.001, -0.4)
    assert math.isclose(d, 111.0, rel_tol=0.01)


def test_pure_longitude_offset_is_corrected_by_coslat():
    # 0.001 grados de longitud a 39.4 -> ~111 km * cos(39.4) ~ 85.8 m,
    # NO 111 m. Este es el valor que el calculo viejo (x111000) inflaba.
    d = planar_distance_m(LAT_VLC, -0.4, LAT_VLC, -0.4 + 0.001)
    expected = 111.0 * math.cos(math.radians(LAT_VLC))  # ~85.8 m
    assert math.isclose(d, expected, rel_tol=0.01)
    # Guard explicito del bug: debe ser claramente menor que el viejo 111 m.
    assert d < 90.0


def test_symmetric_and_zero():
    assert planar_distance_m(LAT_VLC, -0.4, LAT_VLC, -0.4) == 0.0
    a = planar_distance_m(39.40, -0.40, 39.41, -0.41)
    b = planar_distance_m(39.41, -0.41, 39.40, -0.40)
    assert math.isclose(a, b, rel_tol=1e-9)
