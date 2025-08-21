FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir fastapi uvicorn[standard] onnxruntime numpy pillow
COPY . .
EXPOSE 8001
CMD ["uvicorn","server:app","--host","0.0.0.0","--port","8001"]
