const usersBody = document.getElementById("users-body");
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh-btn");
const applyMigrationsBtn = document.getElementById("apply-migrations-btn");

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
                    <td>${user.isActive ? "true" : "false"}</td>
                    <td>${escapeHtml(user.companyId || "-")}</td>
                    <td>${escapeHtml(formatDate(user.updatedAt))}</td>
                    <td>
                        <div class="actions">
                            <a class="button button-secondary" href="/users/${id}/edit">Edit</a>
                            <button
                                class="button button-danger deactivate-user-btn"
                                type="button"
                                data-user-id="${id}"
                                data-user-email="${escapeHtml(user.email)}"
                            >
                                Deactivate
                            </button>
                            <button
                                class="button button-danger button-danger-strong button-icon permanent-delete-user-btn"
                                type="button"
                                data-user-id="${id}"
                                data-user-email="${escapeHtml(user.email)}"
                                aria-label="Permanently delete user"
                                title="Permanently delete user"
                            >
                                <svg class="bin-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/>
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        })
        .join("");
}

async function deactivateUser(userId, userEmail) {
    if (!userId) {
        return;
    }

    const shouldDeactivate = window.confirm(
        `Deactivate ${userEmail || "this user"}? This sets isActive to false and notifies CRM.`,
    );
    if (!shouldDeactivate) {
        return;
    }

    statusEl.textContent = "Deactivating user...";

    try {
        const response = await fetch(
            `/users/${encodeURIComponent(userId)}/deactivate`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            },
        );

        const responseBody = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                responseBody.error || `Request failed (${response.status})`,
            );
        }

        statusEl.textContent = `User deactivated and CRM notified at ${new Date().toLocaleTimeString()}.`;
        await loadUsers();
    } catch (error) {
        console.error("[ui.users] deactivate failed", {
            userId,
            userEmail,
            errorMessage: error.message,
        });
        statusEl.textContent = `Failed to deactivate user: ${error.message}`;
    }
}

async function permanentlyDeleteUser(userId, userEmail) {
    if (!userId) {
        return;
    }

    const shouldDelete = window.confirm(
        `Permanently delete ${userEmail || "this user"}? This cannot be undone. The user will be removed from MariaDB and CRM will be notified with the same deactivation message.`,
    );
    if (!shouldDelete) {
        return;
    }

    statusEl.textContent = "Permanently deleting user...";

    try {
        const response = await fetch(
            `/users/${encodeURIComponent(userId)}/permanent-delete`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            },
        );

        const responseBody = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                responseBody.error || `Request failed (${response.status})`,
            );
        }

        statusEl.textContent = `User permanently deleted and CRM notified at ${new Date().toLocaleTimeString()}.`;
        await loadUsers();
    } catch (error) {
        console.error("[ui.users] permanent delete failed", {
            userId,
            userEmail,
            errorMessage: error.message,
        });
        statusEl.textContent = `Failed to permanently delete user: ${error.message}`;
    }
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
        console.error("[ui.users] list failed", {
            errorMessage: error.message,
        });
        usersBody.innerHTML = `<tr><td colspan="7" class="empty-state error-state">Failed to load users: ${escapeHtml(error.message)}</td></tr>`;
        statusEl.textContent = "Could not refresh users.";
    }
}

async function applyMigrations() {
    if (!applyMigrationsBtn) {
        return;
    }

    const shouldApply = window.confirm(
        "Apply pending database migrations on this VM? This will update the live schema.",
    );
    if (!shouldApply) {
        return;
    }

    applyMigrationsBtn.disabled = true;
    statusEl.textContent = "Applying pending migrations...";

    try {
        const response = await fetch("/admin/migrations/apply", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
        });

        const responseBody = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                responseBody.error || `Request failed (${response.status})`,
            );
        }

        const appliedCount = responseBody.applied?.length || 0;
        const skippedCount = responseBody.skipped?.length || 0;
        statusEl.textContent = `Migrations applied: ${appliedCount}, skipped: ${skippedCount}. Refreshing users...`;
        await loadUsers();
    } catch (error) {
        console.error("[ui.users] migration apply failed", {
            errorMessage: error.message,
        });
        statusEl.textContent = `Failed to apply migrations: ${error.message}`;
    } finally {
        applyMigrationsBtn.disabled = false;
    }
}

refreshBtn.addEventListener("click", () => {
    loadUsers();
});

if (applyMigrationsBtn) {
    applyMigrationsBtn.addEventListener("click", () => {
        applyMigrations();
    });
}

usersBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }

    const deactivateButton = target.closest(".deactivate-user-btn");
    if (deactivateButton instanceof HTMLElement) {
        const userId = deactivateButton.dataset.userId;
        const userEmail = deactivateButton.dataset.userEmail;
        deactivateUser(userId, userEmail);
        return;
    }

    const permanentDeleteButton = target.closest(".permanent-delete-user-btn");
    if (permanentDeleteButton instanceof HTMLElement) {
        const userId = permanentDeleteButton.dataset.userId;
        const userEmail = permanentDeleteButton.dataset.userEmail;
        permanentlyDeleteUser(userId, userEmail);
    }
});

loadUsers();
setInterval(loadUsers, POLL_INTERVAL_MS);
