const assert = require("node:assert/strict");
jest.mock("@sendgrid/mail", () => ({
    setApiKey: jest.fn(),
    send: jest.fn().mockResolvedValue(undefined),
}));
const sgMail = require("@sendgrid/mail");
const { createSendgridService } = require("../src/services/sendgridService");

function restoreEnv(env) {
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}

test("disabled SendGrid mode returns a noop sender", async () => {
    const originalEnv = { SENDGRID_ENABLED: process.env.SENDGRID_ENABLED };
    try {
        process.env.SENDGRID_ENABLED = "false";

        const service = createSendgridService();
        await service.sendUserConfirmedEmail({ email: "alice@example.com" });

        assert.equal(service.enabled, false);
    } finally {
        restoreEnv(originalEnv);
    }
});

test("SendGrid service validates configuration and sends the expected payload", async () => {
    const originalEnv = {
        SENDGRID_ENABLED: process.env.SENDGRID_ENABLED,
        SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
        SENDGRID_FROM_EMAIL: process.env.SENDGRID_FROM_EMAIL,
        SENDGRID_USER_CONFIRMED_TEMPLATE_ID:
            process.env.SENDGRID_USER_CONFIRMED_TEMPLATE_ID,
    };

    process.env.SENDGRID_ENABLED = "true";
    process.env.SENDGRID_API_KEY = "SG.test-key";
    process.env.SENDGRID_FROM_EMAIL = "noreply@example.com";
    process.env.SENDGRID_USER_CONFIRMED_TEMPLATE_ID = "template-confirmed";

    try {
        const service = createSendgridService();
        await service.sendUserConfirmedEmail({
            id: "11111111-1111-4111-8111-111111111111",
            email: "alice@example.com",
            firstName: "Alice",
            lastName: "Example",
            companyId: "33333333-3333-4333-8333-333333333333",
            isActive: true,
            confirmedAt: "2026-04-10T12:00:00Z",
        });

        assert.equal(sgMail.setApiKey.mock.calls[0][0], "SG.test-key");
        assert.deepEqual(sgMail.send.mock.calls[0][0], {
            to: "alice@example.com",
            from: "noreply@example.com",
            templateId: "template-confirmed",
            dynamicTemplateData: {
                id: "11111111-1111-4111-8111-111111111111",
                email: "alice@example.com",
                first_name: "Alice",
                last_name: "Example",
                company_id: "33333333-3333-4333-8333-333333333333",
                is_active: true,
                confirmed_at: "2026-04-10T12:00:00Z",
            },
        });
    } finally {
        restoreEnv(originalEnv);
    }
});
