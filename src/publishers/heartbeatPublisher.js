const amqp = require("amqplib");
const path = require("path");
const { spawn } = require("child_process");

const heartbeatContractPath = path.resolve(
    __dirname,
    "../../contracts/hearbeat_contract.xsd",
);

function escapeXml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function toHeartbeatXml({ serviceId, timestamp }) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Heartbeat><serviceId>${escapeXml(serviceId)}</serviceId><timestamp>${timestamp}</timestamp></Heartbeat>`;
}

function parseBoolean(value, defaultValue = true) {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function buildRabbitUrlFromEnv() {
    if (process.env.RABBITMQ_URL) {
        return process.env.RABBITMQ_URL;
    }

    const host = process.env.RABBITMQ_HOST || "rabbitmq";
    const port = Number(
        process.env.RABBITMQ_PORT || process.env.RABBITMQ_AMQP_PORT || 5672,
    );
    const user = encodeURIComponent(
        process.env.RABBITMQ_DEFAULT_USER || "guest",
    );
    const password = encodeURIComponent(
        process.env.RABBITMQ_DEFAULT_PASS || "guest",
    );
    const vhost = process.env.RABBITMQ_VHOST || "/";
    const normalizedVHost = vhost === "/" ? "%2F" : encodeURIComponent(vhost);

    return `amqp://${user}:${password}@${host}:${port}/${normalizedVHost}`;
}

function buildRabbitManagementBaseUrl() {
    const host =
        process.env.RABBITMQ_MANAGEMENT_HOST ||
        process.env.RABBITMQ_HOST ||
        "rabbitmq";
    const port = Number(process.env.RABBITMQ_MANAGEMENT_PORT || 15672);

    return `http://${host}:${port}`;
}

function buildRabbitManagementAuthHeader() {
    const user = process.env.RABBITMQ_DEFAULT_USER || "guest";
    const password = process.env.RABBITMQ_DEFAULT_PASS || "guest";
    return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

async function getRabbitExchangeMetadata(exchange, vhost = "/") {
    const response = await fetch(
        `${buildRabbitManagementBaseUrl()}/api/exchanges/${encodeURIComponent(vhost)}/${encodeURIComponent(exchange)}`,
        {
            headers: {
                Authorization: buildRabbitManagementAuthHeader(),
            },
        },
    );

    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {
        throw new Error(
            `RabbitMQ management API exchange lookup failed (${response.status})`,
        );
    }

    return response.json();
}

async function deleteRabbitExchange(exchange, vhost = "/") {
    const response = await fetch(
        `${buildRabbitManagementBaseUrl()}/api/exchanges/${encodeURIComponent(vhost)}/${encodeURIComponent(exchange)}`,
        {
            method: "DELETE",
            headers: {
                Authorization: buildRabbitManagementAuthHeader(),
            },
        },
    );

    if (response.status === 204 || response.status === 404) {
        return;
    }

    if (!response.ok) {
        throw new Error(
            `RabbitMQ management API exchange delete failed (${response.status})`,
        );
    }
}

async function ensureRabbitExchangeType(exchange, exchangeType) {
    const metadata = await getRabbitExchangeMetadata(exchange);

    if (!metadata) {
        return;
    }

    if (metadata.type === exchangeType) {
        return;
    }

    console.warn(
        `Heartbeat exchange '${exchange}' exists as '${metadata.type}', recreating as '${exchangeType}'.`,
    );
    await deleteRabbitExchange(exchange);
}

function validateHeartbeatWithXmllint(xml) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "xmllint",
            ["--noout", "--schema", heartbeatContractPath, "-"],
            { stdio: ["pipe", "pipe", "pipe"] },
        );

        let stderr = "";

        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        child.on("error", (error) => {
            if (error.code === "ENOENT") {
                reject(
                    new Error(
                        "xmllint is required for Heartbeat XSD validation but was not found",
                    ),
                );
                return;
            }

            reject(error);
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(
                new Error(
                    `Heartbeat XML failed XSD validation: ${stderr.trim() || "unknown xmllint error"}`,
                ),
            );
        });

        child.stdin.write(xml);
        child.stdin.end();
    });
}

function createHeartbeatPublisher() {
    const enabled = parseBoolean(process.env.HEARTBEAT_ENABLED, true);
    const serviceId = process.env.HEARTBEAT_SERVICE_ID || "mailing";
    const intervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 1000);
    const exchange = process.env.HEARTBEAT_EXCHANGE || "heartbeat.direct";
    const exchangeType = process.env.HEARTBEAT_EXCHANGE_TYPE || "direct";
    const routingKey = process.env.HEARTBEAT_ROUTING_KEY || "routing.heartbeat";
    const rabbitUrl = buildRabbitUrlFromEnv();

    let connection;
    let channel;
    let timer;
    let isPublishing = false;

    async function validateHeartbeatXml(xml) {
        await validateHeartbeatWithXmllint(xml);
    }

    async function connectWithRetry(maxRetries = 20, retryDelayMs = 3000) {
        for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
            try {
                await ensureRabbitExchangeType(exchange, exchangeType);

                connection = await amqp.connect(rabbitUrl);
                channel = await connection.createChannel();

                channel.on("error", (error) => {
                    console.error(
                        `RabbitMQ heartbeat channel error: ${error.message}`,
                    );
                });

                await channel.assertExchange(exchange, exchangeType, {
                    durable: true,
                });

                connection.on("close", () => {
                    channel = undefined;
                    connection = undefined;
                });

                connection.on("error", (error) => {
                    console.error(
                        `RabbitMQ heartbeat connection error: ${error.message}`,
                    );
                });

                console.log(
                    `Heartbeat publisher connected to exchange '${exchange}' using routing key '${routingKey}'`,
                );
                return;
            } catch (error) {
                console.error(
                    `Heartbeat connection attempt ${attempt}/${maxRetries} failed: ${error.message}`,
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

    async function publishHeartbeat() {
        if (!enabled || isPublishing) {
            return;
        }

        isPublishing = true;
        try {
            if (!channel) {
                await connectWithRetry();
            }

            const xml = toHeartbeatXml({
                serviceId,
                timestamp: new Date().toISOString(),
            });

            await validateHeartbeatXml(xml);

            const published = channel.publish(
                exchange,
                routingKey,
                Buffer.from(xml, "utf8"),
                {
                    contentType: "application/xml",
                    persistent: true,
                    type: "Heartbeat",
                },
            );

            if (!published) {
                console.warn(
                    "Heartbeat publish backpressure: broker buffer is full",
                );
            }
        } catch (error) {
            console.error(`Heartbeat publish failed: ${error.message}`);
        } finally {
            isPublishing = false;
        }
    }

    async function start() {
        if (!enabled) {
            console.log("Heartbeat publisher is disabled");
            return;
        }

        if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
            throw new Error("HEARTBEAT_INTERVAL_MS must be a positive number");
        }

        await connectWithRetry();
        await publishHeartbeat();
        timer = setInterval(publishHeartbeat, intervalMs);
    }

    async function stop() {
        if (timer) {
            clearInterval(timer);
            timer = undefined;
        }

        if (channel) {
            await channel.close();
            channel = undefined;
        }

        if (connection) {
            await connection.close();
            connection = undefined;
        }
    }

    return {
        start,
        stop,
    };
}

module.exports = {
    createHeartbeatPublisher,
    buildRabbitUrlFromEnv,
};
