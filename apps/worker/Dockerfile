FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10002 worker

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# Install the API package (worker re-uses it)
COPY --chown=worker:worker apps/api/pyproject.toml apps/api/README.md ./api/
COPY --chown=worker:worker apps/api/src ./api/src
RUN pip install --upgrade pip && pip install -e ./api

COPY --chown=worker:worker apps/worker/worker.py ./worker.py

USER worker
CMD ["python", "worker.py"]
