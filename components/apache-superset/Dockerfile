#FROM apache/superset:6.0.0
FROM apache/superset:3.1.3

USER root
RUN pip install pg8000
#RUN pip install psycopg2-binary
COPY superset_config.py /app/pythonpath/superset_config.py

USER superset