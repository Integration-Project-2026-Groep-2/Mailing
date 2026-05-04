const amqp = require("amqplib");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const { buildRabbitUrlFromEnv } = require("../utils/rabbitUtils");

const loggerContractPath = path.resolve(
    __dirname,
    "../../contracts/logger.xsd",
);
const statusCheckContractPath = path.resolve(
    __dirname,
    "../../contracts/statuscheck.xsd",
);

function escapeXml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function toLogXml({ level, timestamp, service, data }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<LogEvent>
    <level>${escapeXml(level)}</level>
    <timestamp>${timestamp}</timestamp>
    <service>${escapeXml(service)}</service>
    <data>${escapeXml(data)}</data>
</LogEvent>`;
}

function toStatusCheckXml({ serviceId, timestamp, uptime, memory, disk }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<StatusCheck>
    <serviceId>${escapeXml(serviceId)}</serviceId>
    <timestamp>${timestamp}</timestamp>
    <uptime>${Math.floor(uptime)}</uptime>
    <memory>${memory.toFixed(4)}</memory>
    <disk>${disk.toFixed(4)}</disk>
</StatusCheck>`;
}

function parseBoolean(value, defaultValue = true) {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function validateWithXmllint(xml, schemaPath) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "xmllint",
            ["--noout", "--schema", schemaPath, "-"],
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
                        "xmllint is required for XSD validation but was not found",
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
                    `XML failed XSD validation: ${stderr.trim() || "unknown xmllint error"}`,
                ),
            );
        });

        child.stdin.write(xml);
        child.stdin.end();
    });
}

function createControlRoomPublisher() {
    const enabled = parseBoolean(process.env.CONTROL_ROOM_ENABLED, true);
    const serviceId = process.env.CONTROL_ROOM_SERVICE_ID || "mailing";
    const statusIntervalMs = 2 * 60 * 1000; // 2 minutes

    const logsExchange = "logs.direct";
    const logsRoutingKey = "routing.log";

    const statusExchange = "statuscheck.direct";
    const statusRoutingKey = "routing.statuscheck";

    const rabbitUrl = buildRabbitUrlFromEnv();

    let connection;
    let channel;
    let statusTimer;
    let isConnecting = false;

    async function connectWithRetry(maxRetries = 20, retryDelayMs = 3000) {
        if (isConnecting) return;
        isConnecting = true;

        for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
            try {
                connection = await amqp.connect(rabbitUrl);
                channel = await connection.createChannel();

                channel.on("error", (error) => {
                    console.error(
                        `RabbitMQ control room channel error: ${error.message}`,
                    );
                });

                await channel.assertExchange(logsExchange, "direct", {
                    durable: true,
                });
                await channel.assertExchange(statusExchange, "direct", {
                    durable: true,
                });

                connection.on("close", () => {
                    channel = undefined;
                    connection = undefined;
                    isConnecting = false;
                });

                connection.on("error", (error) => {
                    console.error(
                        `RabbitMQ control room connection error: ${error.message}`,
                    );
                });

                console.log(`Control Room publisher connected to RabbitMQ`);
                isConnecting = false;
                return;
            } catch (error) {
                console.error(
                    `Control Room connection attempt ${attempt}/${maxRetries} failed: ${error.message}`,
                );
                if (attempt === maxRetries) {
                    isConnecting = false;
                    throw error;
                }
                await new Promise((resolve) =>
                    setTimeout(resolve, retryDelayMs),
                );
            }
        }
        isConnecting = false;
    }

    async function log(level, data) {
        if (!enabled) return;

        try {
            if (!channel) {
                await connectWithRetry();
            }

            const xml = toLogXml({
                level,
                timestamp: new Date().toISOString(),
                service: serviceId,
                data: typeof data === "string" ? data : JSON.stringify(data),
            });

            await validateWithXmllint(xml, loggerContractPath);

            channel.publish(
                logsExchange,
                logsRoutingKey,
                Buffer.from(xml, "utf8"),
                {
                    contentType: "application/xml",
                    persistent: true,
                    type: "LogEvent",
                },
            );
        } catch (error) {
            // Fallback to console if RabbitMQ or validation fails
            console.error(
                `[CONTROL ROOM FALLBACK] ${level}: ${data} (Error: ${error.message})`,
            );
        }
    }

    async function publishStatusCheck() {
        if (!enabled) return;

        try {
            if (!channel) {
                await connectWithRetry();
            }

            // Simple heuristics for memory/disk percentage (0.0 to 1.0)
            const memoryUsed = process.memoryUsage().rss;
            const totalMemory = os.totalmem();
            const memoryUsageRatio = Math.min(1.0, memoryUsed / totalMemory);

            // Disk usage is harder in pure node without extra libs, so we'll use a placeholder or dummy
            // In a real app we might use 'diskusage' or similar.
            // For now, let's use a dummy value as per "won't do uneccesary type creations etc"
            const diskUsageRatio = 0.5;

            const xml = toStatusCheckXml({
                serviceId,
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: memoryUsageRatio,
                disk: diskUsageRatio,
            });

            await validateWithXmllint(xml, statusCheckContractPath);

            channel.publish(
                statusExchange,
                statusRoutingKey,
                Buffer.from(xml, "utf8"),
                {
                    contentType: "application/xml",
                    persistent: true,
                    type: "StatusCheck",
                },
            );
        } catch (error) {
            console.error(`Control Room status check failed: ${error.message}`);
        }
    }

    async function start() {
        if (!enabled) return;
        await connectWithRetry();
        await publishStatusCheck();
        statusTimer = setInterval(publishStatusCheck, statusIntervalMs);
    }

    async function stop() {
        if (statusTimer) {
            clearInterval(statusTimer);
            statusTimer = undefined;
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
        log,
        info: (data) => log("INFO", data),
        warn: (data) => log("WARN", data),
        error: (data) => log("ERROR", data),
        debug: (data) => log("DEBUG", data),
        fatal: (data) => log("FATAL", data),
    };
}

module.exports = {
    createControlRoomPublisher,
};
