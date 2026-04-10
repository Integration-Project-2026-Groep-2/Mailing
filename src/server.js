const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");
const { randomUUID } = require("crypto");
const { createHeartbeatPublisher } = require("./publishers/heartbeatPublisher");
const {
    createMailingUserPublisher,
} = require("./publishers/mailingUserPublisher");
const {
    createCrmUserConfirmedConsumer,
} = require("./consumers/crmUserConfirmedConsumer");
const {
    createCrmUserDeactivatedConsumer,
} = require("./consumers/crmUserDeactivatedConsumer");
const {
    createCrmUserUpdatedConsumer,
} = require("./consumers/crmUserUpdatedConsumer");
const { createUserRepository } = require("./repositories/userRepository");
const { createMailLogRepository } = require("./repositories/mailLogRepository");
const { createSendgridService } = require("./services/sendgridService");
const { createMigrationService } = require("./services/migrationService");

require("dotenv").config({
    path: path.resolve(process.cwd(), ".env"),
});

const app = express();
const port = Number(process.env.APP_PORT || 3000);
const publicDir = path.resolve(__dirname, "public");
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const dbConfig = {
    host: process.env.DB_HOST || "db",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "mailing_user",
    password: process.env.DB_PASSWORD || "mailing_password",
    database: process.env.DB_NAME || "mailing",
};

let pool;
let server;
let crmUserConfirmedConsumer;
let crmUserDeactivatedConsumer;
let crmUserUpdatedConsumer;
let userRepository;
let migrationService;

const heartbeatPublisher = createHeartbeatPublisher();
const mailingUserPublisher = createMailingUserPublisher();

app.use(express.static(publicDir));
app.use(express.json());

function createValidationError(message) {
    const error = new Error(message);
    error.isValidationError = true;
    return error;
}

function normalizeOptionalString(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const normalized = String(value).trim();
    return normalized === "" ? null : normalized;
}

function normalizeRequiredString(value, fieldName) {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        throw createValidationError(`Missing required field: ${fieldName}`);
    }

    return normalized;
}

function normalizeBoolean(value, fieldName) {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        if (value === 1) {
            return true;
        }

        if (value === 0) {
            return false;
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") {
            return true;
        }

        if (normalized === "false" || normalized === "0") {
            return false;
        }
    }

    throw createValidationError(`Invalid boolean field: ${fieldName}`);
}

function normalizeEmail(value, fieldName = "email") {
    const normalized = normalizeRequiredString(value, fieldName).toLowerCase();
    if (!EMAIL_REGEX.test(normalized) || normalized.length > 254) {
        throw createValidationError(`Invalid email field: ${fieldName}`);
    }

    return normalized;
}

function normalizeOptionalUuid(value, fieldName) {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        return null;
    }

    if (!UUID_V4_REGEX.test(normalized)) {
        throw createValidationError(`Invalid UUID field: ${fieldName}`);
    }

    return normalized;
}

function normalizeRequiredUuid(value, fieldName) {
    const normalized = normalizeRequiredString(value, fieldName);
    if (!UUID_V4_REGEX.test(normalized)) {
        throw createValidationError(`Invalid UUID field: ${fieldName}`);
    }

    return normalized;
}

function parseCreateUserPayload(body) {
    const payload = body || {};
    return {
        id: randomUUID(),
        email: normalizeEmail(payload.email),
        firstName: normalizeOptionalString(payload.firstName),
        lastName: normalizeOptionalString(payload.lastName),
        isActive: normalizeBoolean(payload.isActive, "isActive"),
        companyId: normalizeOptionalUuid(payload.companyId, "companyId"),
    };
}

function parseUpdateUserPayload(existingUser, body) {
    const payload = body || {};
    const incomingEmail = normalizeOptionalString(payload.email);

    if (
        incomingEmail &&
        incomingEmail.toLowerCase() !== existingUser.email.toLowerCase()
    ) {
        throw createValidationError("Email is immutable and cannot be changed");
    }

    const hasIsActive = payload.isActive !== undefined;

    return {
        id: existingUser.id,
        email: existingUser.email,
        firstName:
            payload.firstName === undefined
                ? existingUser.firstName
                : normalizeOptionalString(payload.firstName),
        lastName:
            payload.lastName === undefined
                ? existingUser.lastName
                : normalizeOptionalString(payload.lastName),
        isActive: hasIsActive
            ? normalizeBoolean(payload.isActive, "isActive")
            : existingUser.isActive,
        companyId:
            payload.companyId === undefined
                ? existingUser.companyId
                : normalizeOptionalUuid(payload.companyId, "companyId"),
    };
}

function logFlowError(flow, operation, error, context = {}) {
    const errorMessage = error?.message || String(error);
    console.error(`[${flow}] ${operation} failed`, {
        ...context,
        errorMessage,
    });
}

function handleApiError(res, error, options = {}) {
    const {
        publishFailedStatus = 502,
        publishFailedMessage = "User was persisted but message publication failed",
        publishFailedPersisted = true,
        flow = "api",
        operation = "unknown",
        context = {},
    } = options;

    logFlowError(flow, operation, error, context);

    if (error?.isValidationError) {
        res.status(422).json({ error: error.message });
        return;
    }

    if (error?.code === "PUBLISH_FAILED") {
        res.status(publishFailedStatus).json({
            error: publishFailedMessage,
            details: error.message,
            persisted: publishFailedPersisted,
        });
        return;
    }

    res.status(500).json({ error: error.message });
}

async function connectWithRetry(maxRetries = 20, retryDelayMs = 3000) {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
            pool = mysql.createPool({
                ...dbConfig,
                waitForConnections: true,
                connectionLimit: 10,
            });

            const connection = await pool.getConnection();
            connection.release();
            console.log("Connected to MariaDB");
            return;
        } catch (error) {
            console.error(
                `Database connection attempt ${attempt}/${maxRetries} failed: ${error.message}`,
            );

            if (attempt === maxRetries) {
                throw error;
            }

            await new Promise((resolve) => {
                setTimeout(resolve, retryDelayMs);
            });
        }
    }
}

app.get("/health", async (_req, res) => {
    try {
        const [rows] = await pool.query("SELECT 1 AS ok");
        res.status(200).json({
            service: "mailing-service",
            status: "ok",
            db: rows?.[0]?.ok === 1 ? "ok" : "unknown",
        });
    } catch (error) {
        logFlowError("api.health", "health-check", error);
        res.status(503).json({
            service: "mailing-service",
            status: "degraded",
            db: "down",
            error: error.message,
        });
    }
});

app.get("/users", async (_req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT id, email, firstName, lastName, isActive, companyId, updatedAt FROM users ORDER BY updatedAt DESC LIMIT 100",
        );
        res.status(200).json(rows);
    } catch (error) {
        logFlowError("api.users", "list", error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/admin/migrations", async (_req, res) => {
    if (!migrationService) {
        res.status(503).json({ error: "Migration service not initialized" });
        return;
    }

    try {
        const migrations = await migrationService.listMigrations();
        res.status(200).json({ migrations });
    } catch (error) {
        logFlowError("api.migrations", "list", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/admin/migrations/apply", async (_req, res) => {
    if (!migrationService) {
        res.status(503).json({ error: "Migration service not initialized" });
        return;
    }

    try {
        const result = await migrationService.applyPendingMigrations();
        res.status(200).json({
            status: "applied",
            ...result,
        });
    } catch (error) {
        logFlowError("api.migrations", "apply", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/users", async (req, res) => {
    if (!userRepository) {
        console.error("[api.users] create failed", {
            reason: "user repository not initialized",
        });
        res.status(503).json({ error: "User repository not initialized" });
        return;
    }

    try {
        const user = parseCreateUserPayload(req.body);
        const existing = await userRepository.findUserByEmail(user.email);
        if (existing) {
            console.error("[api.users] create failed", {
                reason: "email already exists",
                email: user.email,
            });
            res.status(409).json({
                error: "User with this email already exists",
                user: existing,
            });
            return;
        }

        const persistedUser = await userRepository.upsertUser(user);

        try {
            await mailingUserPublisher.publishUserCreated(persistedUser);
        } catch (error) {
            error.code = "PUBLISH_FAILED";
            throw error;
        }

        res.status(201).json({
            status: "persisted_and_published",
            user: persistedUser,
            syncStatus: "pending_crm_reconciliation",
        });
    } catch (error) {
        handleApiError(res, error, {
            flow: "api.users",
            operation: "create",
            context: {
                email: req.body?.email,
            },
        });
    }
});

app.put("/users/:id", async (req, res) => {
    if (!userRepository) {
        console.error("[api.users] update failed", {
            reason: "user repository not initialized",
            id: req.params?.id,
        });
        res.status(503).json({ error: "User repository not initialized" });
        return;
    }

    try {
        const userId = normalizeRequiredUuid(req.params.id, "id");
        const existingUser = await userRepository.findUserById(userId);
        if (!existingUser) {
            console.error("[api.users] update failed", {
                reason: "user not found",
                id: userId,
            });
            res.status(404).json({ error: "User not found" });
            return;
        }

        const userToPersist = parseUpdateUserPayload(existingUser, req.body);
        const persistedUser = await userRepository.upsertUser(userToPersist);

        try {
            await mailingUserPublisher.publishUserUpdated(persistedUser);
        } catch (error) {
            error.code = "PUBLISH_FAILED";
            throw error;
        }

        res.status(200).json({
            status: "persisted_and_published",
            user: persistedUser,
        });
    } catch (error) {
        if (error?.isValidationError && error.message.includes("immutable")) {
            logFlowError("api.users", "update", error, {
                id: req.params?.id,
                email: req.body?.email,
            });
            res.status(409).json({ error: error.message });
            return;
        }

        handleApiError(res, error, {
            flow: "api.users",
            operation: "update",
            context: {
                id: req.params?.id,
                email: req.body?.email,
            },
        });
    }
});

app.post("/users/:id/deactivate", async (req, res) => {
    if (!userRepository) {
        console.error("[api.users] deactivate failed", {
            reason: "user repository not initialized",
            id: req.params?.id,
        });
        res.status(503).json({ error: "User repository not initialized" });
        return;
    }

    try {
        const userId = normalizeRequiredUuid(req.params.id, "id");
        const existingUser = await userRepository.findUserById(userId);
        if (!existingUser) {
            console.error("[api.users] deactivate failed", {
                reason: "user not found",
                id: userId,
            });
            res.status(404).json({ error: "User not found" });
            return;
        }

        await userRepository.deactivateUserByIdentity({
            id: existingUser.id,
            email: existingUser.email,
        });

        const deactivatedAt = new Date().toISOString();
        try {
            await mailingUserPublisher.publishUserDeactivated({
                id: existingUser.id,
                email: existingUser.email,
                deactivatedAt,
            });
        } catch (error) {
            error.code = "PUBLISH_FAILED";
            throw error;
        }

        res.status(200).json({
            status: "persisted_and_published",
            user: {
                ...existingUser,
                isActive: false,
            },
            deactivatedAt,
        });
    } catch (error) {
        handleApiError(res, error, {
            flow: "api.users",
            operation: "deactivate",
            publishFailedMessage:
                "User was deactivated locally but deactivation message publication failed",
            context: {
                id: req.params?.id,
            },
        });
    }
});

app.post("/users/:id/permanent-delete", async (req, res) => {
    if (!userRepository) {
        console.error("[api.users] permanent-delete failed", {
            reason: "user repository not initialized",
            id: req.params?.id,
        });
        res.status(503).json({ error: "User repository not initialized" });
        return;
    }

    let connection;
    let transactionStarted = false;

    try {
        const userId = normalizeRequiredUuid(req.params.id, "id");
        const existingUser = await userRepository.findUserById(userId);
        if (!existingUser) {
            console.error("[api.users] permanent-delete failed", {
                reason: "user not found",
                id: userId,
            });
            res.status(404).json({ error: "User not found" });
            return;
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const deletedRows = await userRepository.deleteUserByIdentity(
            {
                id: existingUser.id,
                email: existingUser.email,
            },
            connection,
        );

        if (deletedRows === 0) {
            throw new Error(
                "User delete failed: user identity no longer matches",
            );
        }

        const deactivatedAt = new Date().toISOString();
        try {
            await mailingUserPublisher.publishUserDeactivated({
                id: existingUser.id,
                email: existingUser.email,
                deactivatedAt,
            });
        } catch (error) {
            error.code = "PUBLISH_FAILED";
            throw error;
        }

        await connection.commit();
        transactionStarted = false;

        res.status(200).json({
            status: "deleted_and_published",
            user: existingUser,
            deactivatedAt,
        });
    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                logFlowError(
                    "api.users",
                    "permanent-delete-rollback",
                    rollbackError,
                    { id: req.params?.id },
                );
            }
        }

        handleApiError(res, error, {
            flow: "api.users",
            operation: "permanent-delete",
            publishFailedMessage:
                "User deletion was rolled back because deactivation message publication failed",
            publishFailedPersisted: false,
            context: {
                id: req.params?.id,
            },
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/users/new", (_req, res) => {
    res.sendFile(path.join(publicDir, "new.html"));
});

app.get("/users/:id/edit", (_req, res) => {
    res.sendFile(path.join(publicDir, "edit.html"));
});

async function start() {
    await connectWithRetry();

    userRepository = createUserRepository(pool);
    migrationService = createMigrationService(pool);
    const mailLogRepository = createMailLogRepository(pool);
    const sendgridService = createSendgridService();
    crmUserConfirmedConsumer = createCrmUserConfirmedConsumer({
        userRepository,
        mailLogRepository,
        sendgridService,
    });
    crmUserDeactivatedConsumer = createCrmUserDeactivatedConsumer({
        userRepository,
    });
    crmUserUpdatedConsumer = createCrmUserUpdatedConsumer({
        userRepository,
    });

    await heartbeatPublisher.start();
    await mailingUserPublisher.start();
    await crmUserConfirmedConsumer.start();
    await crmUserDeactivatedConsumer.start();
    await crmUserUpdatedConsumer.start();

    server = app.listen(port, () => {
        console.log(`Mailing service listening on port ${port}`);
    });
}

async function shutdown(signal) {
    console.log(`Received ${signal}. Shutting down...`);

    if (server) {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }

    await heartbeatPublisher.stop();
    await mailingUserPublisher.stop();

    if (crmUserConfirmedConsumer) {
        await crmUserConfirmedConsumer.stop();
    }

    if (crmUserDeactivatedConsumer) {
        await crmUserDeactivatedConsumer.stop();
    }

    if (crmUserUpdatedConsumer) {
        await crmUserUpdatedConsumer.stop();
    }

    if (pool) {
        await pool.end();
    }

    process.exit(0);
}

process.on("SIGINT", () => {
    shutdown("SIGINT").catch((error) => {
        console.error("Failed graceful shutdown:", error);
        process.exit(1);
    });
});

process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch((error) => {
        console.error("Failed graceful shutdown:", error);
        process.exit(1);
    });
});

start().catch((error) => {
    console.error("Failed to start service:", error);
    process.exit(1);
});
