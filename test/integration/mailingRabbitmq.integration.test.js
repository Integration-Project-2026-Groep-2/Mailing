const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const {
    appUrl,
    connectDatabase,
    connectRabbit,
    consumeOnce,
    createTemporaryQueue,
    deleteUserByEmail,
    getUserByEmail,
    seedUser,
    waitForHealth,
    assertXmlRoot,
} = require("./integrationHelpers");

function jsonRequest(pathname, method, body) {
    return fetch(`${appUrl}${pathname}`, {
        method,
        headers: {
            "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe("RabbitMQ Mailing -> CRM integration", () => {
    let pool;
    let rabbit;

    beforeAll(async () => {
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

    test("publishes mailing.user.created with local id when crmMasterId is missing", async () => {
        const email = `integration-${Date.now()}-created@example.com`;
        await deleteUserByEmail(pool, email);

        const queue = await createTemporaryQueue(
            rabbit.channel,
            "user.topic",
            "mailing.user.created",
        );

        const response = await jsonRequest("/users", "POST", {
            email,
            firstName: "Created",
            lastName: "User",
            isActive: true,
        });

        assert.equal(response.status, 201);
        const payload = await response.json();
        assert.equal(payload.user.email, email);

        const message = await consumeOnce(rabbit.channel, queue);
        const root = assertXmlRoot(message.content, "MailingUserCreated");
        assert.equal(root.email, email);
        assert.equal(root.id, payload.user.id);
        assert.equal(root.isActive, true);

        message.ack();

        const user = await getUserByEmail(pool, email);
        assert.ok(user);
        assert.equal(user.crmMasterId, null);

        await deleteUserByEmail(pool, email);
    });

    test("publishes mailing.user.updated when a user is updated", async () => {
        const createEmail = `integration-${Date.now()}-update@example.com`;
        const localId = randomUUID();
        const crmMasterId = randomUUID();
        await deleteUserByEmail(pool, createEmail);
        await seedUser(pool, {
            id: localId,
            crmMasterId,
            email: createEmail,
            firstName: "Original",
            lastName: "User",
            isActive: true,
            companyId: null,
        });

        const queue = await createTemporaryQueue(
            rabbit.channel,
            "user.topic",
            "mailing.user.updated",
        );

        const updateResponse = await jsonRequest(`/users/${localId}`, "PUT", {
            firstName: "Updated",
            lastName: "User",
            isActive: false,
        });

        assert.equal(updateResponse.status, 200);
        const message = await consumeOnce(rabbit.channel, queue);
        const root = assertXmlRoot(message.content, "MailingUserUpdated");
        assert.equal(root.email, createEmail);
        assert.equal(root.id, crmMasterId);
        assert.equal(root.isActive, false);

        message.ack();

        await deleteUserByEmail(pool, createEmail);
    });

    test("publishes mailing.user.deactivated when a user is deactivated", async () => {
        const email = `integration-${Date.now()}-deactivated@example.com`;
        const localId = randomUUID();
        const crmMasterId = randomUUID();
        await deleteUserByEmail(pool, email);
        await seedUser(pool, {
            id: localId,
            crmMasterId,
            email,
            firstName: "Before",
            lastName: "Deactivate",
            isActive: true,
            companyId: null,
        });

        const queue = await createTemporaryQueue(
            rabbit.channel,
            "user.topic",
            "mailing.user.deactivated",
        );

        const deactivateResponse = await jsonRequest(
            `/users/${localId}/deactivate`,
            "POST",
        );

        assert.equal(deactivateResponse.status, 200);
        const message = await consumeOnce(rabbit.channel, queue);
        const root = assertXmlRoot(message.content, "MailingUserDeactivated");
        assert.equal(root.id, crmMasterId);
        assert.equal(root.email, email);
        assert.ok(root.deactivatedAt);

        const user = await getUserByEmail(pool, email);
        assert.equal(Number(user.isActive), 0);
        assert.equal(message.fields.routingKey, "mailing.user.deactivated");

        message.ack();

        await deleteUserByEmail(pool, email);
    });
});
