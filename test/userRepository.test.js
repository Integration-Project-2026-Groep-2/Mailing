const assert = require("node:assert/strict");
const {
    createUserRepository,
    mapPersistedUser,
} = require("../src/repositories/userRepository");
const { createMockConnection, createMockPool } = require("./helpers");

test("mapPersistedUser normalizes persisted rows", () => {
    assert.deepEqual(
        mapPersistedUser({
            id: "11111111-1111-4111-8111-111111111111",
            crmMasterId: "22222222-2222-4222-8222-222222222222",
            email: "Alice@Example.com",
            firstName: " Alice ",
            lastName: null,
            isActive: 1,
            companyId: "",
        }),
        {
            id: "11111111-1111-4111-8111-111111111111",
            crmMasterId: "22222222-2222-4222-8222-222222222222",
            email: "Alice@Example.com",
            firstName: "Alice",
            lastName: null,
            isActive: true,
            companyId: null,
        },
    );
});

test("findUserByEmail queries the database and maps the result", async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValue([
        [
            {
                id: "11111111-1111-4111-8111-111111111111",
                email: "alice@example.com",
                firstName: "Alice",
                lastName: "Example",
                isActive: 1,
                companyId: null,
            },
        ],
    ]);
    const repository = createUserRepository(pool);

    const user = await repository.findUserByEmail("alice@example.com");

    assert.equal(pool.query.mock.calls.length, 1);
    assert.equal(user.email, "alice@example.com");
});

test("replaceUserId moves mail logs and user row in a transaction", async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValue([{}, undefined]);
    const repository = createUserRepository(pool);

    await repository.replaceUserId(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
    );

    assert.equal(pool.query.mock.calls.length, 1);
    assert.match(pool.query.mock.calls[0][0], /SET crmMasterId = \?/);
    assert.deepEqual(pool.query.mock.calls[0][1], [
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111",
    ]);
});

test("upsertUser writes the expected user snapshot", async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValue([{}, undefined]);
    const repository = createUserRepository(pool);

    await repository.upsertUser({
        id: "11111111-1111-4111-8111-111111111111",
        crmMasterId: "22222222-2222-4222-8222-222222222222",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Example",
        isActive: true,
        companyId: null,
    });

    assert.equal(pool.query.mock.calls.length, 1);
    assert.deepEqual(pool.query.mock.calls[0][1], [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "alice@example.com",
        "Alice",
        "Example",
        true,
        null,
    ]);
});

test("deactivateUserByIdentity falls back to email when the id does not match", async () => {
    const pool = createMockPool();
    pool.query
        .mockResolvedValueOnce([{ affectedRows: 0 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const repository = createUserRepository(pool);

    const affectedRows = await repository.deactivateUserByIdentity({
        id: "11111111-1111-4111-8111-111111111111",
        email: "alice@example.com",
    });

    assert.equal(affectedRows, 1);
    assert.equal(pool.query.mock.calls.length, 2);
});
