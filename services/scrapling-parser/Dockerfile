FROM python:3.12.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src

RUN addgroup --system app && adduser --system --ingroup app app
WORKDIR /app
COPY requirements.lock ./requirements.lock
RUN pip install --no-cache-dir --requirement requirements.lock
COPY src ./src

USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"]
CMD ["python", "-m", "lotsocial_scrapling.server"]
