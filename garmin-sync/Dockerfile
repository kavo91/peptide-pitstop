# Thin Garmin fetch-and-forward sidecar. python:3.12-slim (not alpine) avoids
# musl wheel pain with garth's transitive deps.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TOKENS_DIR=/tokens

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY sync.py test_normalise.py ./

# Persisted OAuth token dir (mounted volume in compose); seeded once via the
# interactive MFA bootstrap documented in README.md.
VOLUME ["/tokens"]

# On-demand sync trigger (compose-internal only).
EXPOSE 8080

CMD ["python", "sync.py"]
