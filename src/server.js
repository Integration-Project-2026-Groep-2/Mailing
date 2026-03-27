const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");
const { createHeartbeatPublisher } = require("./publishers/heartbeatPublisher");
const {
    createCrmUserConfirmedConsumer,
} = require("./consumers/crmUserConfirmedConsumer");
const { createUserRepository } = require("./repositories/userRepository");
const { createMailLogRepository } = require("./repositories/mailLogRepository");
const { createSendgridService } = require("./services/sendgridService");

require("dotenv").config({
    path: path.resolve(process.cwd(), ".env"),
});

const app = express();
const port = Number(process.env.APP_PORT || 3000);
const publicDir = path.resolve(__dirname, "public");

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

const heartbeatPublisher = createHeartbeatPublisher();

app.use(express.static(publicDir));

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
            "SELECT id, email, firstName, lastName, gdprConsent, companyId, updatedAt FROM users ORDER BY updatedAt DESC LIMIT 100",
        );
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
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

    const userRepository = createUserRepository(pool);
    const mailLogRepository = createMailLogRepository(pool);
    const sendgridService = createSendgridService();
    crmUserConfirmedConsumer = createCrmUserConfirmedConsumer({
        userRepository,
        mailLogRepository,
        sendgridService,
    });

    await heartbeatPublisher.start();
    await crmUserConfirmedConsumer.start();

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

    if (crmUserConfirmedConsumer) {
        await crmUserConfirmedConsumer.stop();
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
