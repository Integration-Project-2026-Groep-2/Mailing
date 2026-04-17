jest.mock("../src/publishers/heartbeatPublisher", () => ({
    createHeartbeatPublisher: jest.fn(() => ({
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
    buildRabbitUrlFromEnv: jest.fn(() => "amqp://test"),
}));

jest.mock("../src/publishers/mailingUserPublisher", () => ({
    createMailingUserPublisher: jest.fn(() => ({
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock("../src/consumers/crmUserConfirmedConsumer", () => ({
    createCrmUserConfirmedConsumer: jest.fn(() => ({
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock("../src/consumers/crmUserDeactivatedConsumer", () => ({
    createCrmUserDeactivatedConsumer: jest.fn(() => ({
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock("../src/consumers/crmUserUpdatedConsumer", () => ({
    createCrmUserUpdatedConsumer: jest.fn(() => ({
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock("../src/consumers/invoiceFinalizedConsumer", () => ({
    createInvoiceFinalizedConsumer: jest.fn(() => ({
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock("../src/consumers/notifyAllUsersConsumer", () => ({
    createNotifyAllUsersConsumer: jest.fn(() => ({
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock("../src/consumers/planningSessionUpdatedConsumer", () => ({
    createPlanningSessionUpdatedConsumer: jest.fn(() => ({
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock("../src/consumers/planningSessionCancelledConsumer", () => ({
    createPlanningSessionCancelledConsumer: jest.fn(() => ({
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock("../src/consumers/planningSessionRescheduledConsumer", () => ({
    createPlanningSessionRescheduledConsumer: jest.fn(() => ({
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock("../src/repositories/userRepository", () => ({
    createUserRepository: jest.fn(() => ({
        findUserByEmail: jest.fn(),
    })),
}));

jest.mock("../src/repositories/mailLogRepository", () => ({
    createMailLogRepository: jest.fn(() => ({
        insertMailLog: jest.fn(),
    })),
}));

jest.mock("../src/services/sendgridService", () => ({
    createSendgridService: jest.fn(() => ({
        confirmationTemplateId: "template-confirmed",
        notifyAllUsersTemplateId: "template-news",
        sendUserConfirmedEmail: jest.fn().mockResolvedValue(undefined),
        sendNotifyAllUsersEmail: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock("../src/services/migrationService", () => ({
    createMigrationService: jest.fn(() => ({
        runPendingMigrations: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock("mysql2/promise", () => ({
    createPool: jest.fn(() => ({
        getConnection: jest.fn().mockResolvedValue({
            release: jest.fn(),
        }),
        end: jest.fn().mockResolvedValue(undefined),
    })),
}));

const assert = require("node:assert/strict");

test("start wires all consumers and shutdown stops them", async () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
    const serverModule = require("../src/server");

    const closeMock = jest.fn((callback) => callback && callback());
    const listenSpy = jest
        .spyOn(serverModule.app, "listen")
        .mockImplementation((_, callback) => {
            if (callback) {
                callback();
            }

            return {
                close: closeMock,
            };
        });

    try {
        await serverModule.start();
        await serverModule.shutdown("SIGTERM");

        assert.equal(listenSpy.mock.calls.length, 1);
        assert.equal(closeMock.mock.calls.length, 1);
        assert.equal(exitSpy.mock.calls[0][0], 0);
    } finally {
        exitSpy.mockRestore();
        listenSpy.mockRestore();
    }
});
