FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .
COPY templates ./templates
COPY static ./static

# defaults for your compose
ENV MONGO_HOST=dbstorage \
    MONGO_PORT=27017 \
    MONGO_DB=cljdetector \
    SAMPLE_SEC=30 \
    KEEP_POINTS=720     
EXPOSE 8080
CMD ["python", "/app/app.py"]
