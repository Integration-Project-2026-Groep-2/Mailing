# Shiftfestival Mailing Service

Node.js mailing service with MariaDB and RabbitMQ, containerized with Docker Compose.

## What is included

- `app` service: Node.js API server (`Express` + `mysql2`)
- `db` service: MariaDB 11.8 with startup SQL schema
- `rabbitmq` service: RabbitMQ 4.0 with management UI
- `.env` for environment configuration

## Project structure

- `compose.yml`: Local multi-container stack
- `Dockerfile`: App container image
- `docker/db/init/001_init.sql`: Initial MariaDB schema (`users`, `mail_logs`)
- `src/server.js`: API server and DB connectivity
- `contracts/user_data_contract.xsd`: XML contract for inbound messages from CRM

## Environment variables

Use `.env` for local runtime values.

Required variables:

- `APP_PORT`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_ROOT_PASSWORD`
- `DB_EXPOSE_PORT`
- `RABBITMQ_DEFAULT_USER`
- `RABBITMQ_DEFAULT_PASS`
- `RABBITMQ_AMQP_PORT`
- `RABBITMQ_MANAGEMENT_PORT`
- `SENDGRID_API_KEY`

## Run with Docker Compose

```bash
docker compose -f compose.yml up -d --build
```

Check logs:

```bash
docker compose -f compose.yml logs -f app
```

Stop stack:

```bash
docker compose -f compose.yml down
```

Remove stack and DB volume:

```bash
docker compose -f compose.yml down -v
```

## API endpoints

- `GET /health`: service + database health check
- `GET /users`: list up to 100 users

When Compose is running with default values:

- App API: `http://localhost:3000/health`
- RabbitMQ Management UI: `http://localhost:15672`
- MariaDB host port: `localhost:3308`
