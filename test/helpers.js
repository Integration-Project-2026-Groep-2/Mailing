function createMockPool() {
    return {
        query: jest.fn(),
        getConnection: jest.fn(),
        end: jest.fn(),
    };
}

function createMockConnection() {
    return {
        query: jest.fn(),
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
    };
}

module.exports = {
    createMockConnection,
    createMockPool,
};
