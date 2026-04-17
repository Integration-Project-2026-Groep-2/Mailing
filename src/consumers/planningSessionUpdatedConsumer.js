const amqp = require("amqplib");
const path = require("path");
const { spawn } = require("child_process");
const { XMLParser } = require("fast-xml-parser");
const { buildRabbitUrlFromEnv } = require("../publishers/heartbeatPublisher");
const { processSessionUpdated } = require("../flows/planningSessionFlows");

const planningContractPath = path.resolve(
    __dirname,
    "../../contracts/planning_contract.xsd",
);

function parseBoolean(value, defaultValue = true) {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function isValidationError(error) {
    return Boolean(error && error.isValidationError === true);
}

function isTransientError(error) {
    if (!error) {
        return false;
    }

    const transientCodes = new Set([
        "PROTOCOL_CONNECTION_LOST",
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "EPIPE",
        "EAI_AGAIN",
        "ER_LOCK_DEADLOCK",
        "ER_LOCK_WAIT_TIMEOUT",
    ]);

    if (transientCodes.has(error.code)) {
        return true;
    }

    const statusCode =
        error.code ||
        error.statusCode ||
        error.response?.statusCode ||
        error.response?.body?.errors?.[0]?.status;

    if (Number.isFinite(Number(statusCode))) {
        const numericStatus = Number(statusCode);
        return numericStatus === 429 || numericStatus >= 500;
    }

    return false;
}

function createValidationError(message) {
    const error = new Error(message);
    error.isValidationError = true;
    return error;
}

function buildMessageErrorContext(msg, queue, defaultRoutingKey) {
    return {
        queue,
        routingKey: msg.fields?.routingKey || defaultRoutingKey,
        exchange: msg.fields?.exchange,
        deliveryTag: msg.fields?.deliveryTag,
        redelivered: Boolean(msg.fields?.redelivered),
        messageId: msg.properties?.messageId,
        correlationId: msg.properties?.correlationId,
    };
}

function validateWithXmllint(xml) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "xmllint",
            ["--noout", "--schema", planningContractPath, "-"],
            { stdio: ["pipe", "pipe", "pipe"] },
        );

        let stderr = "";

        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        child.on("error", (error) => {
            if (error.code === "ENOENT") {
                reject(
                    createValidationError(
                        "xmllint is required for planning.session.updated XSD validation but was not found",
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
                createValidationError(
                    `planning.session.updated XML failed XSD validation: ${stderr.trim() || "unknown xmllint error"}`,
                ),
            );
        });

        child.stdin.write(xml);
        child.stdin.end();
    });
}

function extractParticipantIds(payload) {
    const value = payload?.participantIds?.participantId;

    if (!value) {
        return [];
    }

    return Array.isArray(value) ? value : [value];
}

function createPlanningSessionUpdatedConsumer({
    userRepository,
    mailLogRepository,
    sendgridService,
}) {
    const enabled = parseBoolean(
        process.env.PLANNING_SESSION_UPDATED_SYNC_ENABLED,
        true,
    );
    const exchange =
        process.env.PLANNING_SESSION_UPDATED_EXCHANGE || "planning.topic";
    const exchangeType =
        process.env.PLANNING_SESSION_UPDATED_EXCHANGE_TYPE || "topic";
    const queue =
        process.env.PLANNING_SESSION_UPDATED_QUEUE ||
        "mailing.planning.session.updated";
    const routingKey =
        process.env.PLANNING_SESSION_UPDATED_ROUTING_KEY ||
        "planning.session.updated";
    const prefetch = Number(
        process.env.PLANNING_SESSION_UPDATED_PREFETCH || 10,
    );
    const rabbitUrl = buildRabbitUrlFromEnv();

    const xmlParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        removeNSPrefix: true,
        parseTagValue: true,
        trimValues: true,
    });

    let connection;
    let channel;

    async function connectWithRetry(maxRetries = 20, retryDelayMs = 3000) {
        for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
            try {
                connection = await amqp.connect(rabbitUrl);
                channel = await connection.createChannel();
                await channel.assertExchange(exchange, exchangeType, {
                    durable: true,
                });
                await channel.assertQueue(queue, {
                    durable: true,
                });
                await channel.bindQueue(queue, exchange, routingKey);

                if (!Number.isFinite(prefetch) || prefetch <= 0) {
                    throw new Error(
                        "PLANNING_SESSION_UPDATED_PREFETCH must be a positive number",
                    );
                }

                await channel.prefetch(prefetch);

                connection.on("close", () => {
                    channel = undefined;
                    connection = undefined;
                });

                connection.on("error", (error) => {
                    console.error(
                        `RabbitMQ planning.session.updated connection error: ${error.message}`,
                    );
                });

                console.log(
                    `Planning session updated consumer connected. queue='${queue}', exchange='${exchange}', routingKey='${routingKey}'`,
                );
                return;
            } catch (error) {
                console.error(
                    `Planning session updated consumer connection attempt ${attempt}/${maxRetries} failed: ${error.message}`,
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

    function extractPayload(xmlContent) {
        let parsed;
        try {
            parsed = xmlParser.parse(xmlContent);
        } catch (error) {
            throw createValidationError(
                `Could not parse XML payload: ${error.message}`,
            );
        }

        const payload = parsed?.SessionUpdated;
        if (!payload || typeof payload !== "object") {
            throw createValidationError(
                "Expected root <SessionUpdated> element in payload",
            );
        }

        return {
            sessionId: payload.sessionId,
            sessionName: payload.sessionName,
            changeType: payload.changeType,
            newTime: payload.newTime,
            newLocation: payload.newLocation,
            participantIds: extractParticipantIds(payload),
            timestamp: payload.timestamp,
        };
    }

    async function processMessage(msg) {
        const xmlContent = msg.content.toString("utf8");

        await validateWithXmllint(xmlContent);

        const payload = extractPayload(xmlContent);

        await processSessionUpdated(payload, {
            userRepository,
            mailLogRepository,
            sendgridService,
        });
    }

    async function onMessage(msg) {
        if (!msg) {
            return;
        }

        const errorContext = buildMessageErrorContext(msg, queue, routingKey);

        try {
            await processMessage(msg);
            channel.ack(msg);
        } catch (error) {
            if (isValidationError(error)) {
                console.error(
                    "Rejecting invalid planning.session.updated payload",
                    {
                        ...errorContext,
                        validationType: "XSD",
                        schemaPath: planningContractPath,
                        errorMessage: error.message,
                    },
                );
                channel.nack(msg, false, false);
                return;
            }

            const shouldRequeue = isTransientError(error);
            console.error(
                "Failed processing planning.session.updated payload",
                {
                    ...errorContext,
                    shouldRequeue,
                    errorMessage: error.message,
                },
            );
            channel.nack(msg, false, shouldRequeue);
        }
    }

    async function start() {
        if (!enabled) {
            console.log("Planning session updated consumer is disabled");
            return;
        }

        await connectWithRetry();
        await channel.consume(queue, onMessage, {
            noAck: false,
        });
    }

    async function stop() {
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
    createPlanningSessionUpdatedConsumer,
};
