const amqp = require("amqplib");
const path = require("path");
const { spawn } = require("child_process");
const { XMLParser } = require("fast-xml-parser");
const { buildRabbitUrlFromEnv } = require("../publishers/heartbeatPublisher");

const userContractPath = path.resolve(
    __dirname,
    "../../contracts/user_data_contract.xsd",
);

const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ISO_DATETIME_REGEX =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/;
const ALLOWED_ROLES = new Set([
    "VISITOR",
    "COMPANY_CONTACT",
    "SPEAKER",
    "EVENT_MANAGER",
    "CASHIER",
    "BAR_STAFF",
    "ADMIN",
]);

const ALLOWED_FIELDS = new Set([
    "id",
    "email",
    "firstName",
    "lastName",
    "phone",
    "role",
    "companyId",
    "badgeCode",
    "street",
    "houseNumber",
    "postalCode",
    "city",
    "country",
    "isActive",
    "gdprConsent",
    "updatedAt",
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

function validateWithXmllint(xml) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "xmllint",
            ["--noout", "--schema", userContractPath, "-"],
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
                        "xmllint is required for crm.user.updated XSD validation but was not found",
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
                    `crm.user.updated XML failed XSD validation: ${stderr.trim() || "unknown xmllint error"}`,
                ),
            );
        });

        child.stdin.write(xml);
        child.stdin.end();
    });
}

function createCrmUserUpdatedConsumer({ userRepository }) {
    const enabled = parseBoolean(
        process.env.CRM_USER_UPDATED_SYNC_ENABLED,
        true,
    );
    const exchange = process.env.CRM_USER_UPDATED_EXCHANGE || "contact.topic";
    const exchangeType = process.env.CRM_USER_UPDATED_EXCHANGE_TYPE || "topic";
    const queue = process.env.CRM_USER_UPDATED_QUEUE || "mailing.user.updated";
    const routingKey =
        process.env.CRM_USER_UPDATED_ROUTING_KEY || "crm.user.updated";
    const prefetch = Number(process.env.CRM_USER_UPDATED_PREFETCH || 10);
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
                        "CRM_USER_UPDATED_PREFETCH must be a positive number",
                    );
                }

                await channel.prefetch(prefetch);

                connection.on("close", () => {
                    channel = undefined;
                    connection = undefined;
                });

                connection.on("error", (error) => {
                    console.error(
                        `RabbitMQ crm.user.updated connection error: ${error.message}`,
                    );
                });

                console.log(
                    `CRM user updated consumer connected. queue='${queue}', exchange='${exchange}', routingKey='${routingKey}'`,
                );
                return;
            } catch (error) {
                console.error(
                    `CRM user updated consumer connection attempt ${attempt}/${maxRetries} failed: ${error.message}`,
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

        const payload = parsed?.UserUpdated;
        if (!payload || typeof payload !== "object") {
            throw createValidationError(
                "Expected root <UserUpdated> element in payload",
            );
        }

        const unexpectedFields = Object.keys(payload).filter(
            (fieldName) => !ALLOWED_FIELDS.has(fieldName),
        );

        if (unexpectedFields.length > 0) {
            throw createValidationError(
                `Unexpected fields in UserUpdated payload: ${unexpectedFields.join(", ")}`,
            );
        }

        return {
            id: payload.id,
            email: payload.email,
            firstName: payload.firstName,
            lastName: payload.lastName,
            phone: payload.phone,
            role: payload.role,
            companyId: payload.companyId,
            badgeCode: payload.badgeCode,
            street: payload.street,
            houseNumber: payload.houseNumber,
            postalCode: payload.postalCode,
            city: payload.city,
            country: payload.country,
            isActive: payload.isActive,
            gdprConsent: payload.gdprConsent,
            updatedAt: payload.updatedAt,
        };
    }

    function validateRequiredString(value, fieldName, maxLength = 255) {
        const normalized = String(value || "").trim();
        if (normalized.length === 0 || normalized.length > maxLength) {
            throw createValidationError(
                `Invalid or missing ${fieldName} (max length ${maxLength})`,
            );
        }

        return normalized;
    }

    function validateOptionalString(value, fieldName, maxLength = 255) {
        if (
            value === undefined ||
            value === null ||
            String(value).trim() === ""
        ) {
            return null;
        }

        return validateRequiredString(value, fieldName, maxLength);
    }

    function validatePayload(payload) {
        if (!UUID_V4_REGEX.test(String(payload.id || ""))) {
            throw createValidationError(
                "Invalid or missing id (UUID v4 required)",
            );
        }

        const email = String(payload.email || "");
        if (!EMAIL_REGEX.test(email) || email.length > 254) {
            throw createValidationError("Invalid or missing email");
        }

        validateRequiredString(payload.firstName, "firstName", 80);
        validateRequiredString(payload.lastName, "lastName", 80);

        if (!ALLOWED_ROLES.has(String(payload.role || ""))) {
            throw createValidationError("Invalid or missing role");
        }

        if (
            !["true", "false", true, false, "1", "0", 1, 0].includes(
                payload.isActive,
            )
        ) {
            throw createValidationError(
                "Invalid or missing isActive boolean value",
            );
        }

        if (
            !["true", "false", true, false, "1", "0", 1, 0].includes(
                payload.gdprConsent,
            )
        ) {
            throw createValidationError(
                "Invalid or missing gdprConsent boolean value",
            );
        }

        if (!ISO_DATETIME_REGEX.test(String(payload.updatedAt || ""))) {
            throw createValidationError(
                "Invalid or missing updatedAt ISO datetime",
            );
        }

        if (
            payload.companyId &&
            !UUID_V4_REGEX.test(String(payload.companyId))
        ) {
            throw createValidationError("Invalid companyId (UUID v4 required)");
        }

        if (String(payload.role) === "COMPANY_CONTACT" && !payload.companyId) {
            throw createValidationError(
                "companyId is required when role is COMPANY_CONTACT",
            );
        }

        validateOptionalString(payload.phone, "phone", 50);
        validateOptionalString(payload.badgeCode, "badgeCode", 100);
        validateOptionalString(payload.street, "street", 255);
        validateOptionalString(payload.houseNumber, "houseNumber", 50);
        validateOptionalString(payload.postalCode, "postalCode", 50);
        validateOptionalString(payload.city, "city", 100);

        const country = validateOptionalString(payload.country, "country", 2);
        if (country && !COUNTRY_CODE_REGEX.test(country)) {
            throw createValidationError(
                "Invalid country code (expected 2 uppercase letters)",
            );
        }
    }

    async function processMessage(msg) {
        const xmlContent = msg.content.toString("utf8");

        await validateWithXmllint(xmlContent);

        const payload = extractPayload(xmlContent);
        validatePayload(payload);

        const existingByEmail = await userRepository.findUserByEmail(
            payload.email,
        );
        if (existingByEmail && existingByEmail.id !== payload.id) {
            const existingByCrmId = await userRepository.findUserById(
                payload.id,
            );
            if (!existingByCrmId) {
                await userRepository.replaceUserId(
                    existingByEmail.id,
                    payload.id,
                );
            }
        }

        await userRepository.upsertUser({
            id: payload.id,
            email: payload.email,
            firstName: payload.firstName,
            lastName: payload.lastName,
            gdprConsent: payload.gdprConsent,
            companyId: payload.companyId,
        });
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
                    `Rejecting invalid crm.user.updated payload: ${error.message}`,
                );
                channel.nack(msg, false, false);
                return;
            }

            const shouldRequeue = isTransientError(error);
            console.error(
                `Failed processing crm.user.updated payload (requeue=${shouldRequeue}): ${error.message}`,
            );
            channel.nack(msg, false, shouldRequeue);
        }
    }

    async function start() {
        if (!enabled) {
            console.log("CRM user updated consumer is disabled");
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
    createCrmUserUpdatedConsumer,
};
