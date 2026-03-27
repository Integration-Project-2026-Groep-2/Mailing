const usersBody = document.getElementById("users-body");
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh-btn");

const POLL_INTERVAL_MS = 5000;

function escapeHtml(value) {
    const str = value === null || value === undefined ? "" : String(value);
    return str
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatDate(value) {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return date.toLocaleString();
}

function setRows(users) {
    if (!Array.isArray(users) || users.length === 0) {
        usersBody.innerHTML =
            '<tr><td colspan="7" class="empty-state">No users yet. Send a message on RabbitMQ and wait for the next refresh.</td></tr>';
        return;
    }

    usersBody.innerHTML = users
        .map((user) => {
            const id = encodeURIComponent(user.id || "");
            return `
                <tr>
                    <td>${escapeHtml(user.email)}</td>
                    <td>${escapeHtml(user.firstName)}</td>
                    <td>${escapeHtml(user.lastName)}</td>
                    <td>${user.gdprConsent ? "true" : "false"}</td>
                    <td>${escapeHtml(user.companyId || "-")}</td>
                    <td>${escapeHtml(formatDate(user.updatedAt))}</td>
                    <td>
                        <div class="actions">
                            <a class="button button-secondary" href="/users/${id}/edit">Edit</a>
                            <button class="button button-danger" type="button" disabled title="Delete functionality comes later">Delete</button>
                        </div>
                    </td>
                </tr>
            `;
        })
        .join("");
}

async function loadUsers() {
    statusEl.textContent = "Loading users...";

    try {
        const response = await fetch("/users", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Request failed (${response.status})`);
        }

        const users = await response.json();
        setRows(users);
        statusEl.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    } catch (error) {
        usersBody.innerHTML = `<tr><td colspan="7" class="empty-state error-state">Failed to load users: ${escapeHtml(error.message)}</td></tr>`;
        statusEl.textContent = "Could not refresh users.";
    }
}

refreshBtn.addEventListener("click", () => {
    loadUsers();
});

loadUsers();
setInterval(loadUsers, POLL_INTERVAL_MS);
