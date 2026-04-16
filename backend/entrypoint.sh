#!/bin/sh
set -e

# Nakama expects "user:pass@host:port/db" — strip postgres:// or postgresql:// prefix
DB_ADDR="${DATABASE_URL#postgres://}"
DB_ADDR="${DB_ADDR#postgresql://}"

# Append sslmode=disable for Fly.io internal Postgres (private networking)
case "$DB_ADDR" in
  *sslmode*) ;;
  *) DB_ADDR="${DB_ADDR}?sslmode=disable" ;;
esac

echo "Running Nakama migrations..."
/nakama/nakama migrate up --database.address "$DB_ADDR"

echo "Starting Nakama server..."
exec /nakama/nakama \
  --config /nakama/data/production.yml \
  --database.address "$DB_ADDR"
