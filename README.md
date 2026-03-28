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
- `contracts/hearbeat_contract.xsd`: XML contract for outbound heartbeat to Controlroom
- `src/publishers/heartbeatPublisher.js`: RabbitMQ heartbeat publisher

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

Optional heartbeat variables:

- `HEARTBEAT_ENABLED` (default: `true`)
- `HEARTBEAT_SERVICE_ID` (default: `mailing`)
- `HEARTBEAT_INTERVAL_MS` (default: `30000`)
- `HEARTBEAT_EXCHANGE` (default: `control_room_topic_exchange`)
- `HEARTBEAT_EXCHANGE_TYPE` (default: `topic`)
- `HEARTBEAT_ROUTING_KEY` (default: `heartbeat.mailing`)
- `RABBITMQ_URL` (full AMQP URL override)
- `RABBITMQ_HOST` (default: `rabbitmq`)
- `RABBITMQ_PORT` (default: `5672`)
- `RABBITMQ_VHOST` (default: `/`)

Optional CRM user sync variables:

- `CRM_USER_SYNC_ENABLED` (default: `true`)
- `CRM_USER_EXCHANGE` (default: `contact.topic`)
- `CRM_USER_EXCHANGE_TYPE` (default: `topic`)
- `CRM_USER_QUEUE` (default: `mailing.user.confirmed`)
- `CRM_USER_ROUTING_KEY` (default: `crm.user.confirmed`)
- `CRM_USER_PREFETCH` (default: `10`)
- `SENDGRID_ENABLED` (default: `true`)
- `SENDGRID_FROM_EMAIL` (required when `SENDGRID_ENABLED=true`)
- `SENDGRID_USER_CONFIRMED_TEMPLATE_ID` (required for `crm.user.confirmed` flow)

Optional outbound Mailing user publish variables:

- `MAILING_USER_PUBLISH_ENABLED` (default: `true`)
- `MAILING_USER_EXCHANGE` (default: `user.topic`)
- `MAILING_USER_EXCHANGE_TYPE` (default: `topic`)
- `MAILING_USER_CREATED_ROUTING_KEY` (default: `mailing.user.created`)
- `MAILING_USER_UPDATED_ROUTING_KEY` (default: `mailing.user.updated`)

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
- `POST /users`: persist user locally, then publish `mailing.user.created`
- `PUT /users/:id`: persist update locally, then publish `mailing.user.updated` (email immutable)

## Heartbeat publishing

On startup, the service opens an AMQP channel and publishes heartbeat XML messages that conform to `contracts/hearbeat_contract.xsd`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Heartbeat>
	<serviceId>mailing</serviceId>
	<timestamp>2026-03-25T12:00:00.000Z</timestamp>
</Heartbeat>
```

The service is publisher-only for heartbeats. It does not consume heartbeat messages; Controlroom is the consumer.
The mailing service does not declare or manage queues; it only publishes heartbeat events to the topic exchange with routing key `heartbeat.mailing`.

## CRM user sync consumption

The service consumes `crm.user.confirmed` events from RabbitMQ and validates `UserConfirmed` XML payloads against the user contract rules defined in `contracts/user_data_contract.xsd`.

For every valid message:

- Upserts `users` with only `id`, `email`, `firstName`, `lastName`, `gdprConsent`, and `companyId`
- Sends a SendGrid dynamic template email using `SENDGRID_USER_CONFIRMED_TEMPLATE_ID`
- Writes status entries into `mail_logs` with `SENT` or `FAILED`

Payloads that fail XML/XSD validation are rejected without requeue. Transient infrastructure failures are nacked with requeue.

## Outbound create/update sync

Create and update execute in this order:

1. Persist in MariaDB
2. Publish XML to RabbitMQ

For create, the service first stores a locally generated UUID. If CRM later confirms the same email with a different official UUID on `crm.user.confirmed`, the consumer reconciles the local user id to the CRM id.

If persistence succeeds but publish fails, the API returns `502` with `persisted=true`.

When Compose is running with default values:

- App API: `http://localhost:3000/health`
- RabbitMQ Management UI: `http://localhost:15672`
- MariaDB host port: `localhost:3308`
