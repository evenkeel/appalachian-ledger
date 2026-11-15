FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app/backend
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt \
    && groupadd --gid 10001 ledger \
    && useradd --uid 10001 --gid ledger --no-create-home ledger \
    && mkdir -p /data && chown ledger:ledger /data
COPY backend/app /app/backend/app
COPY database /app/database
COPY deployment/start.sh /app/deployment/start.sh
RUN chmod 755 /app/deployment/start.sh
USER ledger
EXPOSE 8000
ENTRYPOINT ["/app/deployment/start.sh"]
