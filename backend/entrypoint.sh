#!/bin/bash
set -e

echo "Running database migrations..."
flask db upgrade

echo "Starting Flask server..."
exec flask run --host=0.0.0.0 --port=5000