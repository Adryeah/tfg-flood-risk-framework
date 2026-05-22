"""Configura sys.path para que los tests puedan importar 'backend.*'."""
import sys
from pathlib import Path

# framework_web/ root para que 'backend' sea importable
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
