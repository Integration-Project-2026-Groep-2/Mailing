module.exports = {
    testEnvironment: "node",
    clearMocks: true,
    restoreMocks: true,
    collectCoverage: false,
    testMatch: ["**/test/**/*.test.js"],
    testPathIgnorePatterns: ["/test/integration/"],
};
