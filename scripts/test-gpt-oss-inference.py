#!/usr/bin/env python3
"""Run tests/test-gpt-oss-inference.py from the scripts/ path."""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

_TARGET = Path(__file__).resolve().parent.parent / "tests" / "test-gpt-oss-inference.py"
sys.argv[0] = str(_TARGET)
runpy.run_path(str(_TARGET), run_name="__main__")
