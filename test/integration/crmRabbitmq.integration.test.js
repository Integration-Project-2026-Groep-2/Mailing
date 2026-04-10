const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const {
    connectDatabase,
    connectRabbit,
    deleteUserByEmail,
    getLatestMailLog,
    getUserByEmail,
    seedUser,
    waitForCondition,
    waitForHealth,
} = require("./integrationHelpers");

const userConfirmedSample = path.resolve(
    __dirname,
    "../crm_user_confirmed_sample.xml",
);
const userDeactivatedSample = path.resolve(
    __dirname,
    "../crm_user_deactivated_sample.xml",
);
const userUpdatedSample = path.resolve(
    __dirname,
    "../crm_user_updated_sample.xml",
);

function replaceTagValue(xml, tagName, value) {
    return xml.replace(
        new RegExp(`(<${tagName}>)([\\s\\S]*?)(</${tagName}>)`),
        `$1${value}$3`,
    );
}

function applyPayload(xml, payload) {
    let result = xml;
    for (const [tagName, value] of Object.entries(payload)) {
        result = replaceTagValue(result, tagName, value);
    }

    return result;
}

describe("RabbitMQ CRM -> Mailing integration", () => {
    let pool;
    let rabbit;

    beforeAll(async () => {
        if ((process.env.SENDGRID_ENABLED || "").toLowerCase() !== "false") {
            throw new Error(
                "Integration tests require SENDGRID_ENABLED=false to avoid sending live email",
            );
        }

        await waitForHealth();
        pool = await connectDatabase();
        rabbit = await connectRabbit();
    });

    afterAll(async () => {
        if (rabbit?.channel) {
            await rabbit.channel.close();
        }

        if (rabbit?.connection) {
            await rabbit.connection.close();
        }

        if (pool) {
            await pool.end();
        }
    });

    test("accepts crm.user.confirmed XML and persists the user", async () => {
        const xmlTemplate = await fs.readFile(userConfirmedSample, "utf8");
        const userId = randomUUID();
        const email = `integration-${Date.now()}-confirmed@example.com`;
        const companyId = randomUUID();
        const crmUserId = randomUUID();
        const xml = applyPayload(xmlTemplate, {
            id: crmUserId,
            email,
            firstName: "Integration",
            lastName: "Confirmed",
            companyId,
            confirmedAt: new Date().toISOString(),
        });

        await deleteUserByEmail(pool, email);
        await seedUser(pool, {
            id: userId,
            email,
            firstName: "Local",
            lastName: "User",
            isActive: true,
            companyId,
        });

        await rabbit.channel.publish(
            "contact.topic",
            "crm.user.confirmed",
            Buffer.from(xml, "utf8"),
            { contentType: "application/xml", persistent: true },
        );

        await waitForCondition(
            async () => {
                const user = await getUserByEmail(pool, email);
                return user && user.id === crmUserId;
            },
            { timeoutMs: 45000, intervalMs: 1500 },
        );

        const user = await getUserByEmail(pool, email);
        assert.equal(user.id, crmUserId);
        assert.equal(user.isActive, 1);

        const mailLog = await getLatestMailLog(pool, crmUserId);
        assert.ok(mailLog, "Expected a mail log row for confirmed user");
        assert.equal(mailLog.status, "SENT");
    });

    test("rejects invalid crm.user.updated XML without changing the user", async () => {
        const email = `integration-${Date.now()}-updated@example.com`;
        const userId = randomUUID();
        const companyId = randomUUID();
        await deleteUserByEmail(pool, email);
        await seedUser(pool, {
            id: userId,
            email,
            firstName: "Before",
            lastName: "Update",
            isActive: true,
            companyId,
        });

        const xmlTemplate = await fs.readFile(userUpdatedSample, "utf8");
        const invalidXml = applyPayload(xmlTemplate, {
            id: randomUUID(),
            email,
            role: "INVALID_ROLE",
            updatedAt: new Date().toISOString(),
        });

        await rabbit.channel.publish(
            "contact.topic",
            "crm.user.updated",
            Buffer.from(invalidXml, "utf8"),
            { contentType: "application/xml", persistent: true },
        );

        await new Promise((resolve) => setTimeout(resolve, 3000));

        const user = await getUserByEmail(pool, email);
        assert.equal(user.firstName, "Before");
        assert.equal(user.lastName, "Update");
    });

    test("applies crm.user.deactivated XML and turns off active status", async () => {
        const email = `integration-${Date.now()}-deactivated@example.com`;
        const localId = randomUUID();
        const crmId = randomUUID();
        const companyId = randomUUID();
        await deleteUserByEmail(pool, email);
        await seedUser(pool, {
            id: localId,
            email,
            firstName: "Before",
            lastName: "Deactivate",
            isActive: true,
            companyId,
        });

        const xmlTemplate = await fs.readFile(userDeactivatedSample, "utf8");
        const xml = applyPayload(xmlTemplate, {
            id: crmId,
            email,
            deactivatedAt: new Date().toISOString(),
        });

        await rabbit.channel.publish(
            "contact.topic",
            "crm.user.deactivated",
            Buffer.from(xml, "utf8"),
            { contentType: "application/xml", persistent: true },
        );

        await waitForCondition(
            async () => {
                const user = await getUserByEmail(pool, email);
                return user && user.id === crmId && Number(user.isActive) === 0;
            },
            { timeoutMs: 45000, intervalMs: 1500 },
        );

        const user = await getUserByEmail(pool, email);
        assert.equal(user.id, crmId);
        assert.equal(Number(user.isActive), 0);
    });
});
