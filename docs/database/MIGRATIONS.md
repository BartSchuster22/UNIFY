# Gateway Database Migrations

The Gateway database contains only Gateway-owned durable state and provenance-labelled caches. It never becomes a competing provider/model, Kanban, Chat-message, or Memory record store.

## Commands

```bash
DATABASE_URL_FILE=/run/secrets/gateway_database_url pnpm --filter @aquiero/gateway db:migrate
DATABASE_URL_FILE=/run/secrets/gateway_database_url pnpm --filter @aquiero/gateway db:status
DATABASE_URL_FILE=/run/secrets/gateway_database_url pnpm --filter @aquiero/gateway db:rollback
```

Migrations take a PostgreSQL advisory lock, run transactionally, and record a SHA-256 checksum. A changed applied migration fails rather than drifting silently. Rollback removes the latest migration only. Production rollback requires a backup and an approved runbook; it is never automatic.
