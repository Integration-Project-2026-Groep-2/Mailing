const amqp = require("amqplib");
const path = require("path");
const { spawn } = require("child_process");
const { buildRabbitUrlFromEnv } = require("./heartbeatPublisher");

const mailingUserContractPath = path.resolve(
    __dirname,
    "../../contracts/mailing_user_contract.xsd",
);

function escapeXml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function parseBoolean(value, defaultValue = true) {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeOptionalXmlString(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const normalized = String(value).trim();
    return normalized === "" ? null : normalized;
}

function normalizeXmlString(value) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value).trim();
}

function toMailingUserXml(rootElement, rawUser) {
    const user = {
        id: normalizeXmlString(rawUser.id),
        email: normalizeXmlString(rawUser.email),
        firstName: normalizeOptionalXmlString(rawUser.firstName),
        lastName: normalizeOptionalXmlString(rawUser.lastName),
        isActive: normalizeXmlString(rawUser.isActive),
        companyId: normalizeOptionalXmlString(rawUser.companyId),
    };

    const preIsActiveOptionalTags = [
        user.firstName !== null
            ? `<firstName>${escapeXml(user.firstName)}</firstName>`
            : "",
        user.lastName !== null
            ? `<lastName>${escapeXml(user.lastName)}</lastName>`
            : "",
    ]
        .filter(Boolean)
        .join("");

    const postIsActiveOptionalTags =
        user.companyId !== null
            ? `<companyId>${escapeXml(user.companyId)}</companyId>`
            : "";

    return `<?xml version="1.0" encoding="UTF-8"?>\n<${rootElement}><id>${escapeXml(user.id)}</id><email>${escapeXml(user.email)}</email>${preIsActiveOptionalTags}<isActive>${user.isActive}</isActive>${postIsActiveOptionalTags}</${rootElement}>`;
}

function toMailingUserDeactivatedXml(rawUser) {
    const payload = {
        id: normalizeXmlString(rawUser.id),
        email: normalizeXmlString(rawUser.email),
        deactivatedAt: normalizeXmlString(rawUser.deactivatedAt),
    };

    return `<?xml version="1.0" encoding="UTF-8"?>\n<MailingUserDeactivated><id>${escapeXml(payload.id)}</id><email>${escapeXml(payload.email)}</email><deactivatedAt>${escapeXml(payload.deactivatedAt)}</deactivatedAt></MailingUserDeactivated>`;
}

function validateMailingUserWithXmllint(xml) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "xmllint",
            ["--noout", "--schema", mailingUserContractPath, "-"],
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
                        "xmllint is required for Mailing user XSD validation but was not found",
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
                    `Mailing user XML failed XSD validation: ${stderr.trim() || "unknown xmllint error"}`,
                ),
            );
        });

        child.stdin.write(xml);
        child.stdin.end();
    });
}

function createMailingUserPublisher() {
    const enabled = parseBoolean(
        process.env.MAILING_USER_PUBLISH_ENABLED,
        true,
    );
    const exchange = process.env.MAILING_USER_EXCHANGE || "user.topic";
    const exchangeType = process.env.MAILING_USER_EXCHANGE_TYPE || "topic";
    const createdRoutingKey =
        process.env.MAILING_USER_CREATED_ROUTING_KEY || "mailing.user.created";
    const updatedRoutingKey =
        process.env.MAILING_USER_UPDATED_ROUTING_KEY || "mailing.user.updated";
    const deactivatedRoutingKey =
        process.env.MAILING_USER_DEACTIVATED_ROUTING_KEY ||
        "mailing.user.deactivated";
    const rabbitUrl = buildRabbitUrlFromEnv();

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

                connection.on("close", () => {
                    channel = undefined;
                    connection = undefined;
                });

                connection.on("error", (error) => {
                    console.error(
                        `RabbitMQ mailing user publisher connection error: ${error.message}`,
                    );
                });

                console.log(
                    `Mailing user publisher connected to exchange '${exchange}'`,
                );
                return;
            } catch (error) {
                console.error(
                    `Mailing user publisher connection attempt ${attempt}/${maxRetries} failed: ${error.message}`,
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

    async function ensureChannel() {
        if (!enabled) {
            return false;
        }

        if (!channel) {
            await connectWithRetry();
        }

        return true;
    }

    async function publish(rootElement, routingKey, xml) {
        if (!(await ensureChannel())) {
            return;
        }

        await validateMailingUserWithXmllint(xml);

        const published = channel.publish(
            exchange,
            routingKey,
            Buffer.from(xml, "utf8"),
            {
                contentType: "application/xml",
                persistent: true,
                type: rootElement,
            },
        );

        if (!published) {
            console.warn(
                `Mailing user publish backpressure on routing key '${routingKey}'`,
            );
        }
    }

    async function publishUserCreated(user) {
        await publish(
            "MailingUserCreated",
            createdRoutingKey,
            toMailingUserXml("MailingUserCreated", user),
        );
    }

    async function publishUserUpdated(user) {
        await publish(
            "MailingUserUpdated",
            updatedRoutingKey,
            toMailingUserXml("MailingUserUpdated", user),
        );
    }

    async function publishUserDeactivated(user) {
        await publish(
            "MailingUserDeactivated",
            deactivatedRoutingKey,
            toMailingUserDeactivatedXml(user),
        );
    }

    async function start() {
        if (!enabled) {
            console.log("Mailing user publisher is disabled");
            return;
        }

        await connectWithRetry();
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
        publishUserCreated,
        publishUserUpdated,
        publishUserDeactivated,
    };
}

module.exports = {
    createMailingUserPublisher,
};
