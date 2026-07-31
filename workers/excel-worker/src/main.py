"""中俄贸易文件助手 Python Worker 入口。"""

from __future__ import annotations

import json
import logging
import sys

from protocol import handle_line


def _configure_standard_streams() -> None:
    """确保开发与冻结环境都使用稳定的 UTF-8 协议编码。"""

    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="strict")


_configure_standard_streams()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stderr,
)
LOGGER = logging.getLogger("rus-trade-worker")


def main() -> None:
    """从标准输入读取 JSON Lines，并将协议响应写入标准输出。"""

    LOGGER.info("Worker started")

    for line in sys.stdin:
        raw_line = line.strip()
        if not raw_line:
            continue

        response = handle_line(raw_line)
        sys.stdout.write(
            json.dumps(response, ensure_ascii=False, separators=(",", ":"))
            + "\n"
        )
        sys.stdout.flush()

    LOGGER.info("Worker stopped")


if __name__ == "__main__":
    main()
