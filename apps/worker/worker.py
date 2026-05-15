"""RQ worker entry point.

Long-running solver runs and exports execute here so the API stays responsive.
The worker re-uses the same code base as the API by depending on the
``coach_api`` package (mounted as source in dev, built into the image in prod).
"""

from __future__ import annotations

from redis import Redis
from rq import Queue, Worker

from coach_api.config import get_settings
from coach_api.logging_config import configure_logging


def main() -> None:
    configure_logging()
    settings = get_settings()
    conn = Redis.from_url(settings.redis_url)
    queues = [Queue("default", connection=conn)]
    Worker(queues, connection=conn).work(with_scheduler=True)


if __name__ == "__main__":
    main()
