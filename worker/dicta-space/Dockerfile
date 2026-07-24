FROM python:3.11-slim

# HF Spaces run as a non-root user with a writable home; keep the model cache there.
ENV HF_HOME=/tmp/hf \
    TRANSFORMERS_CACHE=/tmp/hf \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

# HF Spaces expect the app on port 7860.
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
