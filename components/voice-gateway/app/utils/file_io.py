from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class TempFile:
    """
    Represents a temporary file on disk. Useful when:
    - ffmpeg needs file paths (common)
    - you want to inspect saved inputs during debugging
    """
    path: Path

    def read_bytes(self) -> bytes:
        return self.path.read_bytes()

    def write_bytes(self, data: bytes) -> None:
        self.path.write_bytes(data)

    def delete(self) -> None:
        try:
            self.path.unlink(missing_ok=True)
        except Exception:
            # best-effort cleanup
            pass


def ensure_dir(path: str | Path) -> Path:
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def write_bytes(path: str | Path, data: bytes) -> Path:
    p = Path(path)
    ensure_dir(p.parent)
    p.write_bytes(data)
    return p


def read_bytes(path: str | Path) -> bytes:
    return Path(path).read_bytes()


def make_temp_file(suffix: str = ".bin", prefix: str = "tmp_", dir: Optional[str | Path] = None) -> TempFile:
    """
    Create a temp file and return a wrapper.
    We use delete=False so caller controls lifecycle.
    """
    if dir is not None:
        ensure_dir(dir)

    fd, name = tempfile.mkstemp(suffix=suffix, prefix=prefix, dir=str(dir) if dir else None)
    os.close(fd)  # close handle; we'll open later by path
    return TempFile(path=Path(name))
