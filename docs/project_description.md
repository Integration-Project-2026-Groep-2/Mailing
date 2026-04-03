# Project: Shiftfestival Mailing Service

**Centralized Communication Motor | Node.js & MariaDB 11.4 LTS**

## Overview

The **Mailing Service** is a mission-critical component of the Shiftfestival platform. It acts as a bridge between internal event-driven systems (CRM, Kassa, Planning, Facturatie) and external attendees. The service consumes XML messages from RabbitMQ, validates them against a strict XSD schema, and triggers automated email flows via the SendGrid API.

---

## Tech Stack

- **Runtime:** Node.js (Latest LTS)
- **Database:** MariaDB 11.8 (Utilizing native `UUID` and `Thread Pool`)
- **Messaging:** RabbitMQ (AMQP 0-9-1)
- **Email Provider:** SendGrid (v3 API)
- **Validation:** libxmljs or fast-xml-parser (for XSD 1.1 validation)
- **Logging:** Elastic Stack (via Controlroom)

---

## Core Logic & Architecture

### 1. Inbound Event Processing

The service listens to specific routing keys on the RabbitMQ exchange (e.g., `crm.user.updated`, `kassa.order.completed`).

- **Validation:** Every incoming XML payload **must** validate against the `contracts/user_data_contract.xsd`.
- **Parsing:** Convert validated XML into internal JavaScript objects.

### 2. Database Schema (MariaDB)

Store user contact information and consent status to ensure GDPR compliance.

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(254) UNIQUE NOT NULL,
    firstName VARCHAR(80),
    lastName VARCHAR(80),
    isActive BOOLEAN NOT NULL DEFAULT TRUE,
    companyId UUID NULL,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE mail_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId UUID,
    templateId VARCHAR(100),
    status ENUM('SENT', 'BOUNCED', 'FAILED'),
    sentAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
```

### 3. SendGrid Integration

- **Template Matching:** Maps `mailType` from the message to specific **SendGrid Dynamic Template IDs**.
- **Individual & Bulk:** Supports single transactional receipts and batch session updates.
- **Bounce Handling:** Webhooks from SendGrid are processed and re-published to RabbitMQ as `mailing.bounce.reported` to notify CRM.

---

## Business Rules & Compliance

- **Soft Delete Gate:** Before calling SendGrid, the service checks the `isActive` flag. If `false`, mail delivery is suppressed.
- **Universal Delivery:** Every visitor receives a digital proof of entry/payment, regardless of company affiliation.
- **Soft Delete:** Respects the `isActive` flag from the CRM schema; inactive users should not receive marketing materials.
