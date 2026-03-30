const amqp = require("amqplib");
const path = require("path");
const { spawn } = require("child_process");
const { XMLParser, XMLValidator } = require("fast-xml-parser");

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

function validateIsoDateTime(value) {
    if (typeof value !== "string") {
        return false;
    }

    const xsDateTimeRegex =
        /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
    if (!xsDateTimeRegex.test(value)) {
        return false;
    }

    return !Number.isNaN(Date.parse(value));
}

function validateHeartbeatWithParser(xml) {
    const xmlValidationResult = XMLValidator.validate(xml);
    if (xmlValidationResult !== true) {
        throw new Error(
            `Heartbeat XML is malformed: ${xmlValidationResult.err.msg}`,
        );
    }

    const parser = new XMLParser({
        ignoreAttributes: false,
        trimValues: true,
        parseTagValue: false,
    });
    const payload = parser.parse(xml);

    if (!payload || typeof payload !== "object" || !payload.Heartbeat) {
        throw new Error("Heartbeat XML must contain a root Heartbeat element");
    }

    const heartbeat = payload.Heartbeat;
    if (typeof heartbeat.serviceId !== "string") {
        throw new Error("Heartbeat.serviceId must be an xs:string value");
    }

    if (!validateIsoDateTime(heartbeat.timestamp)) {
        throw new Error(
            "Heartbeat.timestamp must be a valid xs:dateTime value",
        );
    }
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
                resolve({ validated: false, reason: "xmllint-not-found" });
                return;
            }

            reject(error);
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve({ validated: true });
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
    const intervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
    const exchange =
        process.env.HEARTBEAT_EXCHANGE || "heartbeat.direct";
    const exchangeType = process.env.HEARTBEAT_EXCHANGE_TYPE || "topic";
    const routingKey = process.env.HEARTBEAT_ROUTING_KEY || "heartbeat.mailing";
    const rabbitUrl = buildRabbitUrlFromEnv();

    let connection;
    let channel;
    let timer;
    let isPublishing = false;
    let warnedAboutXmllint = false;

    async function validateHeartbeatXml(xml) {
        const xmllintResult = await validateHeartbeatWithXmllint(xml);
        if (!xmllintResult.validated && !warnedAboutXmllint) {
            warnedAboutXmllint = true;
            console.warn(
                "xmllint not found; using parser-based heartbeat validation fallback",
            );
        }

        validateHeartbeatWithParser(xml);
    }

    async function connectWithRetry(maxRetries = 20, retryDelayMs = 3000) {
        for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
            try {
                connection = await amqp.connect(rabbitUrl);
                channel = await connection.createChannel();
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

            console.log(`Heartbeat published for service '${serviceId}'`);
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
