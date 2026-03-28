const amqp = require("amqplib");
const { XMLParser } = require("fast-xml-parser");
const { buildRabbitUrlFromEnv } = require("../publishers/heartbeatPublisher");

const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ISO_DATETIME_REGEX =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const ALLOWED_ROLES = new Set([
    "VISITOR",
    "COMPANY_CONTACT",
    "SPEAKER",
    "EVENT_MANAGER",
    "CASHIER",
    "BAR_STAFF",
    "ADMIN",
]);
const ALLOWED_USER_FIELDS = new Set([
    "id",
    "firstName",
    "lastName",
    "email",
    "phone",
    "companyId",
    "role",
    "badgeCode",
    "isActive",
    "gdprConsent",
    "confirmedAt",
]);

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

function createCrmUserConfirmedConsumer({
    userRepository,
    mailLogRepository,
    sendgridService,
}) {
    const enabled = parseBoolean(process.env.CRM_USER_SYNC_ENABLED, true);
    const exchange = process.env.CRM_USER_EXCHANGE || "contact.topic";
    const exchangeType = process.env.CRM_USER_EXCHANGE_TYPE || "topic";
    const queue = process.env.CRM_USER_QUEUE || "mailing.user.confirmed";
    const routingKey = process.env.CRM_USER_ROUTING_KEY || "crm.user.confirmed";
    const prefetch = Number(process.env.CRM_USER_PREFETCH || 10);
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
                        "CRM_USER_PREFETCH must be a positive number",
                    );
                }

                await channel.prefetch(prefetch);

                connection.on("close", () => {
                    channel = undefined;
                    connection = undefined;
                });

                connection.on("error", (error) => {
                    console.error(
                        `RabbitMQ crm.user.confirmed connection error: ${error.message}`,
                    );
                });

                console.log(
                    `CRM user consumer connected. queue='${queue}', exchange='${exchange}', routingKey='${routingKey}'`,
                );
                return;
            } catch (error) {
                console.error(
                    `CRM user consumer connection attempt ${attempt}/${maxRetries} failed: ${error.message}`,
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

    function extractUserFromXml(xmlContent) {
        let parsed;
        try {
            parsed = xmlParser.parse(xmlContent);
        } catch (error) {
            throw createValidationError(
                `Could not parse XML payload: ${error.message}`,
            );
        }

        const user = parsed?.UserConfirmed || parsed?.user;
        if (!user || typeof user !== "object") {
            throw createValidationError(
                "Expected root <UserConfirmed> element in payload",
            );
        }

        const unexpectedFields = Object.keys(user).filter(
            (fieldName) => !ALLOWED_USER_FIELDS.has(fieldName),
        );
        if (unexpectedFields.length > 0) {
            throw createValidationError(
                `Unexpected fields in UserConfirmed payload: ${unexpectedFields.join(
                    ", ",
                )}`,
            );
        }

        return {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            gdprConsent: user.gdprConsent,
            companyId: user.companyId,
            confirmedAt: user.confirmedAt,
            role: user.role,
            isActive: user.isActive,
        };
    }

    function isValidOptionalIsoDate(value) {
        if (value === undefined || value === null || value === "") {
            return true;
        }

        return ISO_DATETIME_REGEX.test(String(value));
    }

    function validateUserContract(user) {
        if (!UUID_V4_REGEX.test(String(user.id || ""))) {
            throw createValidationError(
                "Invalid or missing id (UUID v4 required)",
            );
        }

        const email = String(user.email || "");
        if (!EMAIL_REGEX.test(email) || email.length > 254) {
            throw createValidationError("Invalid or missing email");
        }

        const firstName = String(user.firstName || "");
        if (firstName.length === 0 || firstName.length > 80) {
            throw createValidationError(
                "Invalid or missing firstName (max length 80)",
            );
        }

        const lastName = String(user.lastName || "");
        if (lastName.length === 0 || lastName.length > 80) {
            throw createValidationError(
                "Invalid or missing lastName (max length 80)",
            );
        }

        if (!ALLOWED_ROLES.has(String(user.role || ""))) {
            throw createValidationError("Invalid or missing role");
        }

        if (!["true", "false", true, false, "1", "0"].includes(user.isActive)) {
            throw createValidationError(
                "Invalid or missing isActive boolean value",
            );
        }

        if (
            !["true", "false", true, false, "1", "0"].includes(user.gdprConsent)
        ) {
            throw createValidationError(
                "Invalid or missing gdprConsent boolean value",
            );
        }

        if (!isValidOptionalIsoDate(user.confirmedAt)) {
            throw createValidationError(
                "Invalid or missing confirmedAt ISO datetime",
            );
        }

        if (user.companyId && !UUID_V4_REGEX.test(String(user.companyId))) {
            throw createValidationError("Invalid companyId (UUID v4 required)");
        }

        if (String(user.role) === "COMPANY_CONTACT" && !user.companyId) {
            throw createValidationError(
                "companyId is required when role is COMPANY_CONTACT",
            );
        }
    }

    async function processMessage(msg) {
        const xmlContent = msg.content.toString("utf8");

        const rawUser = extractUserFromXml(xmlContent);
        validateUserContract(rawUser);

        const existingByEmail = await userRepository.findUserByEmail(
            rawUser.email,
        );
        if (existingByEmail && existingByEmail.id !== rawUser.id) {
            const existingByCrmId = await userRepository.findUserById(
                rawUser.id,
            );
            if (!existingByCrmId) {
                await userRepository.replaceUserId(
                    existingByEmail.id,
                    rawUser.id,
                );
            }
        }

        const persistedUser = await userRepository.upsertUser(rawUser);

        try {
            await sendgridService.sendUserConfirmedEmail({
                ...persistedUser,
                confirmedAt: rawUser.confirmedAt,
            });
            await mailLogRepository.insertMailLog({
                userId: persistedUser.id,
                templateId: sendgridService.confirmationTemplateId,
                status: "SENT",
            });
        } catch (error) {
            await mailLogRepository.insertMailLog({
                userId: persistedUser.id,
                templateId: sendgridService.confirmationTemplateId,
                status: "FAILED",
            });
            throw error;
        }
    }

    async function onMessage(msg) {
        if (!msg) {
            return;
        }

        try {
            await processMessage(msg);
            channel.ack(msg);
        } catch (error) {
            if (isValidationError(error)) {
                console.error(
                    `Rejecting invalid crm.user.confirmed payload: ${error.message}`,
                );
                channel.nack(msg, false, false);
                return;
            }

            if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) {
                console.error(
                    `Rejecting crm.user.confirmed payload due to duplicate key conflict: ${error.message}`,
                );
                channel.nack(msg, false, false);
                return;
            }

            const shouldRequeue = isTransientError(error);
            console.error(
                `Failed processing crm.user.confirmed payload (requeue=${shouldRequeue}): ${error.message}`,
            );
            channel.nack(msg, false, shouldRequeue);
        }
    }

    async function start() {
        if (!enabled) {
            console.log("CRM user sync consumer is disabled");
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
    createCrmUserConfirmedConsumer,
};
