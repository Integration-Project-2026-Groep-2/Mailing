const assert = require("node:assert/strict");
const { processNotifyAllUsers } = require("../src/flows/notifyAllUsersFlows");

test("notify-all users flow sends to every active user and logs success", async () => {
    const payload = {
        subjectLine: "Quarterly update",
        updateType: "News",
        message: "New features are available.",
    };

    const userRepository = {
        findActiveUsers: jest.fn().mockResolvedValue([
            {
                id: "11111111-1111-4111-8111-111111111111",
                email: "alice@example.com",
            },
            {
                id: "22222222-2222-4222-8222-222222222222",
                email: "bob@example.com",
            },
        ]),
    };
    const mailLogRepository = {
        insertMailLog: jest.fn().mockResolvedValue(undefined),
    };
    const sendgridService = {
        notifyAllUsersTemplateId: "template-news",
        sendNotifyAllUsersEmail: jest.fn().mockResolvedValue(undefined),
    };

    await processNotifyAllUsers(payload, {
        userRepository,
        mailLogRepository,
        sendgridService,
    });

    assert.equal(sendgridService.sendNotifyAllUsersEmail.mock.calls.length, 2);
    assert.deepEqual(sendgridService.sendNotifyAllUsersEmail.mock.calls[0][0], {
        recipientEmail: "alice@example.com",
        subjectLine: payload.subjectLine,
        updateType: payload.updateType,
        message: payload.message,
    });
    assert.deepEqual(mailLogRepository.insertMailLog.mock.calls[0][0], {
        userId: "11111111-1111-4111-8111-111111111111",
        templateId: "template-news",
        status: "SENT",
    });
    assert.deepEqual(mailLogRepository.insertMailLog.mock.calls[1][0], {
        userId: "22222222-2222-4222-8222-222222222222",
        templateId: "template-news",
        status: "SENT",
    });
});

test("notify-all users flow continues after a recipient failure", async () => {
    const payload = {
        subjectLine: "Urgent update",
        updateType: "Alert",
        message: "Please review the new notice.",
    };

    const sendError = new Error("send failed");
    const userRepository = {
        findActiveUsers: jest.fn().mockResolvedValue([
            {
                id: "11111111-1111-4111-8111-111111111111",
                email: "alice@example.com",
            },
            {
                id: "22222222-2222-4222-8222-222222222222",
                email: "bob@example.com",
            },
        ]),
    };
    const mailLogRepository = {
        insertMailLog: jest.fn().mockResolvedValue(undefined),
    };
    const sendgridService = {
        notifyAllUsersTemplateId: "template-news",
        sendNotifyAllUsersEmail: jest
            .fn()
            .mockRejectedValueOnce(sendError)
            .mockResolvedValueOnce(undefined),
    };

    await processNotifyAllUsers(payload, {
        userRepository,
        mailLogRepository,
        sendgridService,
    });

    assert.equal(sendgridService.sendNotifyAllUsersEmail.mock.calls.length, 2);
    assert.deepEqual(mailLogRepository.insertMailLog.mock.calls[0][0], {
        userId: "11111111-1111-4111-8111-111111111111",
        templateId: "template-news",
        status: "FAILED",
    });
    assert.deepEqual(mailLogRepository.insertMailLog.mock.calls[1][0], {
        userId: "22222222-2222-4222-8222-222222222222",
        templateId: "template-news",
        status: "SENT",
    });
});
