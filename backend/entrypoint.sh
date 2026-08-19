#!/bin/bash
set -e

echo "Waiting for PostgreSQL..."
until pg_isready -h db -p 5432 -U postgres; do
  echo "PostgreSQL not ready yet — sleeping 1s"
  sleep 1
done
echo "PostgreSQL is ready!"

echo "Running database migrations..."
flask db upgrade

echo "Starting Flask server..."
exec flask run --host=0.0.0.0 --port=5000
