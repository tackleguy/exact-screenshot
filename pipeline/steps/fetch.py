"""
Resumable, parallel download of one large file with HTTP range requests.

    python3 pipeline/steps/fetch.py <url> <dest> [--connections 8]

The file is fetched in 64 MB pieces over several connections (mirrors often cap the speed of a single
connection). Finished pieces are kept in `<dest>.parts/`, so an interrupted download resumes where it stopped.
The pieces are joined into <dest> once all of them are complete. Used by extract-osm.py.
"""
from __future__ import annotations

import concurrent.futures
import os
import shutil
import subprocess
import sys

PIECE = 64 * 1024 * 1024
AGENT = "Hyked/1.0 trail catalog (https://github.com/tackleguy/health)"


def size_of(url: str) -> int:
    head = subprocess.run(["curl", "-sSfIL", "-A", AGENT, "--retry", "5", url], capture_output=True, text=True)
    if head.returncode != 0:
        raise RuntimeError(f"HEAD {url} failed: {head.stderr.strip()[:200]}")
    length = None
    for line in head.stdout.splitlines():
        if line.lower().startswith("content-length:"):
            length = int(line.split(":", 1)[1].strip())
    if not length:
        raise RuntimeError(f"no Content-Length for {url}")
    return length


def piece(url: str, parts: str, index: int, total: int) -> None:
    start = index * PIECE
    end = min(total, start + PIECE) - 1
    target = os.path.join(parts, f"{index:05d}")
    if os.path.exists(target) and os.path.getsize(target) == end - start + 1:
        return
    for attempt in range(8):
        result = subprocess.run(["curl", "-sSfL", "-A", AGENT, "--retry", "5", "--retry-all-errors", "--speed-limit", "20000",
                                 "--speed-time", "60", "-r", f"{start}-{end}", "-o", target + ".tmp", url], capture_output=True, text=True)
        if result.returncode == 0 and os.path.getsize(target + ".tmp") == end - start + 1:
            os.replace(target + ".tmp", target)
            return
    raise RuntimeError(f"piece {index} of {url} failed: {result.stderr.strip()[:200]}")


def fetch(url: str, dest: str, connections: int = 8) -> None:
    if os.path.exists(dest):
        return
    total = size_of(url)
    parts = dest + ".parts"
    os.makedirs(parts, exist_ok=True)
    count = (total + PIECE - 1) // PIECE
    with concurrent.futures.ThreadPoolExecutor(max_workers=connections) as pool:
        for future in [pool.submit(piece, url, parts, i, total) for i in range(count)]:
            future.result()
    with open(dest + ".tmp", "wb") as out:
        for i in range(count):
            with open(os.path.join(parts, f"{i:05d}"), "rb") as f:
                shutil.copyfileobj(f, out)
    if os.path.getsize(dest + ".tmp") != total:
        raise RuntimeError(f"{dest}: joined size differs from {total}")
    os.replace(dest + ".tmp", dest)
    shutil.rmtree(parts)


if __name__ == "__main__":
    connections = int(sys.argv[sys.argv.index("--connections") + 1]) if "--connections" in sys.argv else 8
    fetch(sys.argv[1], sys.argv[2], connections)
