import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { createApiClient } from "./apiClient.js"

const API_BASE = (process.env.MAILING_API_URL ?? "http://localhost:3000").replace(/\/$/, "")
const { apiCall } = createApiClient(API_BASE)

const log = (msg) => process.stderr.write(`[mailing-mcp] ${msg}\n`)

const server = new McpServer({ name: "shiftfestival-mailing", version: "1.0.0" })

// ── Tools ──────────────────────────────────────────────────────────────────

server.tool(
    "check_health",
    "Check the health of the Shiftfestival mailing service and its database connectivity.",
    {},
    () => apiCall("GET", "/health")
)

server.tool(
    "get_users",
    "List all users in the mailing service (up to 100), ordered by most recent update. Returns id, email, firstName, lastName, isActive, companyId, crmMasterId, and updatedAt.",
    {},
    () => apiCall("GET", "/users")
)

server.tool(
    "get_user",
    "Fetch a single user by their UUID. Returns id, email, firstName, lastName, isActive, companyId, and crmMasterId.",
    {
        id: z.string().uuid().describe("UUID v4 of the user to retrieve."),
    },
    ({ id }) => apiCall("GET", `/users/${id}`)
)

server.tool(
    "create_user",
    "Create a new user in the mailing service. The user is persisted to the database and a mailing.user.created event is published to RabbitMQ. Email must be unique and is immutable after creation.",
    {
        email: z.string().email().max(254).describe("Email address. Must be unique. Immutable after creation."),
        firstName: z.string().max(80).optional().describe("First name of the user."),
        lastName: z.string().max(80).optional().describe("Last name of the user."),
        isActive: z.boolean().describe("Whether the user is active and should receive emails."),
        companyId: z.string().uuid().optional().describe("UUID v4 of the company the user belongs to."),
    },
    (args) => apiCall("POST", "/users", args)
)

server.tool(
    "update_user",
    "Update an existing user's fields. Email is immutable and cannot be changed. A mailing.user.updated event is published to RabbitMQ on success.",
    {
        id: z.string().uuid().describe("UUID v4 of the user to update."),
        firstName: z.string().max(80).nullable().optional().describe("New first name. Pass null to clear."),
        lastName: z.string().max(80).nullable().optional().describe("New last name. Pass null to clear."),
        isActive: z.boolean().optional().describe("Set the user's active status."),
        companyId: z.string().uuid().nullable().optional().describe("New company UUID v4. Pass null to clear."),
    },
    ({ id, ...fields }) => apiCall("PUT", `/users/${id}`, fields)
)

server.tool(
    "deactivate_user",
    "Deactivate a user by ID, setting isActive to false. The user remains in the database. A mailing.user.deactivated event is published to RabbitMQ.",
    {
        id: z.string().uuid().describe("UUID v4 of the user to deactivate."),
    },
    ({ id }) => apiCall("POST", `/users/${id}/deactivate`)
)

server.tool(
    "delete_user",
    "Permanently delete a user from the database (GDPR hard delete). This action is irreversible. Mail logs for the user are also deleted via CASCADE. A mailing.user.deactivated event is published to RabbitMQ.",
    {
        id: z.string().uuid().describe("UUID v4 of the user to permanently delete."),
    },
    ({ id }) => apiCall("POST", `/users/${id}/permanent-delete`)
)

server.tool(
    "notify_all_users",
    "Send a broadcast email to all active users using the notify-all SendGrid template. Provide a subject line, update type classification, and the message body.",
    {
        subjectLine: z.string().min(1).max(255).describe("The email subject line shown to recipients."),
        updateType: z.string().min(1).describe("Classification of the update type (e.g. 'announcement', 'maintenance', 'security')."),
        message: z.string().min(1).max(10000).describe("The body message content of the broadcast email."),
    },
    (args) => apiCall("POST", "/admin/notify-all-users", args)
)

server.tool(
    "get_mail_logs",
    "Retrieve email delivery logs ordered by most recent. Optionally filter by userId. Returns templateId, status (SENT/BOUNCED/FAILED), and sentAt per entry.",
    {
        userId: z.string().uuid().optional().describe("Filter logs to a specific user UUID. Omit to get all recent logs."),
        limit: z.number().int().min(1).max(100).default(50).describe("Maximum number of entries to return (1–100, default 50)."),
    },
    (args) => {
        const params = new URLSearchParams()
        if (args.userId) params.set("userId", args.userId)
        if (args.limit !== undefined) params.set("limit", String(args.limit))
        const qs = params.toString()
        return apiCall("GET", `/mail-logs${qs ? `?${qs}` : ""}`)
    }
)

server.tool(
    "list_migrations",
    "List all database migrations and their applied status (pending vs. applied).",
    {},
    () => apiCall("GET", "/admin/migrations")
)

server.tool(
    "apply_migrations",
    "Apply all pending database migrations. Already-applied migrations are skipped. Returns counts of applied and skipped migrations.",
    {},
    () => apiCall("POST", "/admin/migrations/apply")
)

// ── Resources ──────────────────────────────────────────────────────────────

async function fetchResource(path, uri) {
    try {
        const res = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(10_000) })
        const data = await res.json()
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] }
    } catch (err) {
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error: err.message }) }] }
    }
}

server.resource(
    "mailing-health",
    "mailing://health",
    { description: "Live health status of the mailing service and its database connection.", mimeType: "application/json" },
    () => fetchResource("/health", "mailing://health")
)

server.resource(
    "mailing-users",
    "mailing://users",
    { description: "Current snapshot of all users in the mailing service (up to 100).", mimeType: "application/json" },
    () => fetchResource("/users", "mailing://users")
)

server.resource(
    "mailing-migrations",
    "mailing://migrations",
    { description: "Database migration history and pending migration status.", mimeType: "application/json" },
    () => fetchResource("/admin/migrations", "mailing://migrations")
)

server.resource(
    "mailing-mail-logs",
    "mailing://mail-logs",
    { description: "Recent email delivery log entries (last 50). Shows templateId, status, and sentAt per email sent.", mimeType: "application/json" },
    () => fetchResource("/mail-logs", "mailing://mail-logs")
)

// ── Start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
log(`Connected. API base: ${API_BASE}`)
