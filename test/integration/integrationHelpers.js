const assert = require("node:assert/strict");
const path = require("path");
const amqp = require("amqplib");
const mysql = require("mysql2/promise");
const { XMLParser } = require("fast-xml-parser");

require("dotenv").config({
    path: path.resolve(process.cwd(), ".env"),
});

const appUrl = process.env.INTEGRATION_APP_URL || "http://127.0.0.1:3000";
const rabbitUrl =
    process.env.INTEGRATION_RABBITMQ_URL || process.env.RABBITMQ_URL;
const dbConfig = {
    host: process.env.INTEGRATION_DB_HOST || process.env.DB_HOST,
    port: Number(process.env.INTEGRATION_DB_PORT || process.env.DB_PORT),
    user: process.env.INTEGRATION_DB_USER || process.env.DB_USER,
    password: process.env.INTEGRATION_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.INTEGRATION_DB_NAME || process.env.DB_NAME,
};

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    parseTagValue: true,
    trimValues: true,
});

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(
    checkFn,
    { timeoutMs = 60000, intervalMs = 1000 } = {},
) {
    const deadline = Date.now() + timeoutMs;
    let lastError;

    while (Date.now() < deadline) {
        try {
            const result = await checkFn();
            if (result) {
                return result;
            }
        } catch (error) {
            lastError = error;
        }

        await wait(intervalMs);
    }

    if (lastError) {
        throw lastError;
    }

    throw new Error("Timed out waiting for condition");
}

async function waitForHealth() {
    await waitForCondition(
        async () => {
            const response = await fetch(`${appUrl}/health`);
            if (response.ok) {
                const payload = await response.json();
                return payload?.status === "ok";
            }

            return false;
        },
        { timeoutMs: 90000, intervalMs: 2000 },
    );
}

async function connectRabbit() {
    const connection = await amqp.connect(rabbitUrl);
    const channel = await connection.createChannel();
    return { connection, channel };
}

async function connectDatabase() {
    const pool = mysql.createPool({
        ...dbConfig,
        waitForConnections: true,
        connectionLimit: 5,
    });

    return pool;
}

async function seedUser(pool, user) {
    await pool.query(
        `
        INSERT INTO users (id, crmMasterId, email, firstName, lastName, isActive, companyId)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            crmMasterId = COALESCE(VALUES(crmMasterId), crmMasterId),
            email = VALUES(email),
            firstName = VALUES(firstName),
            lastName = VALUES(lastName),
            isActive = VALUES(isActive),
            companyId = VALUES(companyId),
            updatedAt = CURRENT_TIMESTAMP
        `,
        [
            user.id,
            user.crmMasterId || null,
            user.email,
            user.firstName || null,
            user.lastName || null,
            user.isActive,
            user.companyId || null,
        ],
    );
}

async function deleteUserByEmail(pool, email) {
    await pool.query("DELETE FROM users WHERE email = ?", [email]);
}

async function getUserByEmail(pool, email) {
    const [rows] = await pool.query(
        `
        SELECT id, crmMasterId, email, firstName, lastName, isActive, companyId
        FROM users
        WHERE email = ?
        LIMIT 1
        `,
        [email],
    );

    return rows[0] || null;
}

async function getLatestMailLog(pool, userId) {
    const [rows] = await pool.query(
        `
        SELECT id, userId, templateId, status, sentAt
        FROM mail_logs
        WHERE userId = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [userId],
    );

    return rows[0] || null;
}

async function getLatestMailLogByTemplate(pool, templateId) {
    const [rows] = await pool.query(
        `
        SELECT id, userId, templateId, status, sentAt
        FROM mail_logs
        WHERE templateId = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [templateId],
    );

    return rows[0] || null;
}

async function createTemporaryQueue(channel, exchange, routingKey) {
    const { queue } = await channel.assertQueue("", {
        exclusive: true,
        autoDelete: true,
    });

    await channel.bindQueue(queue, exchange, routingKey);

    return queue;
}

async function consumeOnce(channel, queue, { timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for message on ${queue}`));
        }, timeoutMs);

        let consumerTag;

        function cleanup() {
            clearTimeout(timer);
            if (consumerTag) {
                channel.cancel(consumerTag).catch(() => {});
            }
        }

        channel
            .consume(
                queue,
                (message) => {
                    if (!message) {
                        return;
                    }

                    cleanup();
                    resolve({
                        content: message.content.toString("utf8"),
                        fields: message.fields,
                        properties: message.properties,
                        ack: () => channel.ack(message),
                    });
                },
                { noAck: false },
            )
            .then((consumer) => {
                consumerTag = consumer.consumerTag;
            })
            .catch((error) => {
                cleanup();
                reject(error);
            });
    });
}

function parseXml(xml) {
    return xmlParser.parse(xml);
}

function assertXmlRoot(xml, rootName) {
    const parsed = parseXml(xml);
    assert.ok(parsed[rootName], `Expected <${rootName}> root element`);
    return parsed[rootName];
}

module.exports = {
    appUrl,
    connectDatabase,
    connectRabbit,
    consumeOnce,
    createTemporaryQueue,
    deleteUserByEmail,
    getLatestMailLog,
    getLatestMailLogByTemplate,
    getUserByEmail,
    parseXml,
    seedUser,
    assertXmlRoot,
    waitForCondition,
    waitForHealth,
};
