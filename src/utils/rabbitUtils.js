function buildRabbitUrlFromEnv() {
    if (process.env.RABBITMQ_URL) {
        return process.env.RABBITMQ_URL;
    }

    const host = process.env.RABBITMQ_HOST || "rabbitmq";
    const port = Number(
        process.env.RABBITMQ_PORT || process.env.RABBITMQ_AMQP_PORT || 5672,
    );
    const user = encodeURIComponent(
        process.env.RABBITMQ_DEFAULT_USER || "guest",
    );
    const password = encodeURIComponent(
        process.env.RABBITMQ_DEFAULT_PASS || "guest",
    );
    const vhost = process.env.RABBITMQ_VHOST || "/";
    const normalizedVHost = vhost === "/" ? "%2F" : encodeURIComponent(vhost);

    return `amqp://${user}:${password}@${host}:${port}/${normalizedVHost}`;
}

module.exports = {
    buildRabbitUrlFromEnv,
};
