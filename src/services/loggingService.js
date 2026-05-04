const { createControlRoomPublisher } = require("../publishers/controlRoomPublisher");

let publisher;

function initializeLogging() {
    if (!publisher) {
        publisher = createControlRoomPublisher();
    }
    return publisher;
}

function getLogger() {
    if (!publisher) {
        // Fallback to console if not initialized
        return {
            info: console.log,
            warn: console.warn,
            error: console.error,
            debug: console.debug,
            fatal: console.error,
            start: async () => {},
            stop: async () => {},
        };
    }
    return publisher;
}

module.exports = {
    initializeLogging,
    getLogger,
};
