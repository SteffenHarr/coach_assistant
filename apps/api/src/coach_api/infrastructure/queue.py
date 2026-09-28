"""Shared RQ queue connection — used to enqueue background jobs (e.g. plan
generation) that the ``worker`` container picks up."""

from __future__ import annotations

from redis import Redis
from rq import Queue

from coach_api.config import get_settings

_settings = get_settings()
_redis = Redis.from_url(_settings.redis_url)
job_queue = Queue("default", connection=_redis)
