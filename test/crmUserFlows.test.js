const assert = require("node:assert/strict");
const {
    processCrmUserConfirmedUser,
    processCrmUserDeactivatedUser,
    processCrmUserUpdatedUser,
} = require("../src/flows/crmUserFlows");

test("confirmed user flow reconciles user, sends email, and logs success", async () => {
    const rawUser = {
        id: "11111111-1111-4111-8111-111111111111",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Example",
        isActive: true,
        companyId: null,
        confirmedAt: "2026-04-10T12:00:00Z",
    };

    const userRepository = {
        findUserByEmail: jest.fn().mockResolvedValue({
            id: "22222222-2222-4222-8222-222222222222",
            email: rawUser.email,
        }),
        findUserByCrmMasterId: jest.fn().mockResolvedValue(null),
        upsertUser: jest.fn().mockResolvedValue({
            ...rawUser,
            id: "22222222-2222-4222-8222-222222222222",
            crmMasterId: rawUser.id,
            companyId: null,
        }),
    };
    const mailLogRepository = {
        insertMailLog: jest.fn().mockResolvedValue(undefined),
    };
    const sendgridService = {
        confirmationTemplateId: "template-confirmed",
        sendUserConfirmedEmail: jest.fn().mockResolvedValue(undefined),
    };

    await processCrmUserConfirmedUser(rawUser, {
        userRepository,
        mailLogRepository,
        sendgridService,
    });

    assert.equal(userRepository.upsertUser.mock.calls.length, 1);
    assert.deepEqual(userRepository.upsertUser.mock.calls[0][0], {
        id: "22222222-2222-4222-8222-222222222222",
        crmMasterId: rawUser.id,
        email: rawUser.email,
        firstName: rawUser.firstName,
        lastName: rawUser.lastName,
        isActive: rawUser.isActive,
        companyId: rawUser.companyId,
    });
    assert.equal(sendgridService.sendUserConfirmedEmail.mock.calls.length, 1);
    assert.deepEqual(mailLogRepository.insertMailLog.mock.calls[0][0], {
        userId: "22222222-2222-4222-8222-222222222222",
        templateId: "template-confirmed",
        status: "SENT",
    });
});

test("confirmed user flow records failed send attempts", async () => {
    const rawUser = {
        id: "11111111-1111-4111-8111-111111111111",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Example",
        isActive: true,
        companyId: null,
        confirmedAt: "2026-04-10T12:00:00Z",
    };

    const sendError = new Error("send failed");
    const userRepository = {
        findUserByEmail: jest.fn().mockResolvedValue(null),
        findUserByCrmMasterId: jest.fn().mockResolvedValue(null),
        upsertUser: jest.fn().mockResolvedValue({
            ...rawUser,
            crmMasterId: rawUser.id,
        }),
    };
    const mailLogRepository = {
        insertMailLog: jest.fn().mockResolvedValue(undefined),
    };
    const sendgridService = {
        confirmationTemplateId: "template-confirmed",
        sendUserConfirmedEmail: jest.fn().mockRejectedValue(sendError),
    };

    await assert.rejects(
        processCrmUserConfirmedUser(rawUser, {
            userRepository,
            mailLogRepository,
            sendgridService,
        }),
        /send failed/,
    );

    assert.deepEqual(mailLogRepository.insertMailLog.mock.calls[0][0], {
        userId: rawUser.id,
        templateId: "template-confirmed",
        status: "FAILED",
    });
});

test("deactivated user flow deactivates by identity after reconciliation", async () => {
    const payload = {
        id: "11111111-1111-4111-8111-111111111111",
        email: "alice@example.com",
        deactivatedAt: "2026-04-10T12:00:00Z",
    };

    const userRepository = {
        findUserByCrmMasterId: jest.fn().mockResolvedValue(null),
        findUserByEmail: jest.fn().mockResolvedValue({
            id: "22222222-2222-4222-8222-222222222222",
            email: payload.email,
        }),
        setCrmMasterIdByLocalId: jest.fn().mockResolvedValue(undefined),
        deactivateUserByIdentity: jest.fn().mockResolvedValue(1),
    };

    await processCrmUserDeactivatedUser(payload, { userRepository });

    assert.equal(userRepository.setCrmMasterIdByLocalId.mock.calls.length, 1);
    assert.deepEqual(userRepository.deactivateUserByIdentity.mock.calls[0][0], {
        id: "22222222-2222-4222-8222-222222222222",
        email: payload.email,
    });
});

test("updated user flow persists the CRM snapshot without sending email", async () => {
    const payload = {
        id: "11111111-1111-4111-8111-111111111111",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Example",
        phone: "+32123456789",
        role: "visitor",
        companyId: "33333333-3333-4333-8333-333333333333",
        badgeCode: "B123",
        street: "Main Street",
        houseNumber: "42",
        postalCode: "1000",
        city: "Brussels",
        country: "BE",
        isActive: true,
        gdprConsent: true,
        updatedAt: "2026-04-10T12:00:00Z",
    };

    const userRepository = {
        findUserByCrmMasterId: jest.fn().mockResolvedValue(null),
        findUserByEmail: jest.fn().mockResolvedValue({
            id: "44444444-4444-4444-8444-444444444444",
            email: payload.email,
        }),
        upsertUser: jest.fn().mockResolvedValue({
            id: "44444444-4444-4444-8444-444444444444",
            crmMasterId: payload.id,
            email: payload.email,
        }),
    };

    await processCrmUserUpdatedUser(payload, { userRepository });

    assert.equal(userRepository.upsertUser.mock.calls.length, 1);
    assert.deepEqual(userRepository.upsertUser.mock.calls[0][0], {
        id: "44444444-4444-4444-8444-444444444444",
        crmMasterId: payload.id,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        isActive: payload.isActive,
        companyId: payload.companyId,
    });
});
