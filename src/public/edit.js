const editStatusEl = document.getElementById("edit-status");
const editForm = document.getElementById("edit-form");

function escapeHtml(value) {
    const str = value === null || value === undefined ? "" : String(value);
    return str
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getUserIdFromPath() {
    const match = window.location.pathname.match(/^\/users\/([^/]+)\/edit$/);
    return match ? decodeURIComponent(match[1]) : null;
}

function setField(id, value) {
    const field = document.getElementById(id);
    if (field) {
        field.value =
            value === null || value === undefined ? "" : String(value);
    }
}

function normalizeOptional(value) {
    const normalized = String(value ?? "").trim();
    return normalized === "" ? null : normalized;
}

async function loadUser() {
    const userId = getUserIdFromPath();
    if (!userId) {
        editStatusEl.textContent = "Invalid user id in URL.";
        editStatusEl.classList.add("error-state");
        return;
    }

    editStatusEl.textContent = "Loading user details...";

    try {
        const response = await fetch("/users", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Request failed (${response.status})`);
        }

        const users = await response.json();
        const user = users.find((item) => item.id === userId);

        if (!user) {
            editStatusEl.textContent = "User not found in latest users list.";
            editStatusEl.classList.add("error-state");
            return;
        }

        setField("email", user.email);
        setField("firstName", user.firstName);
        setField("lastName", user.lastName);
        setField("gdprConsent", user.gdprConsent ? "true" : "false");
        setField("companyId", user.companyId || "");

        editStatusEl.textContent = `Loaded user: ${escapeHtml(user.email)}`;
        editStatusEl.classList.remove("error-state");
    } catch (error) {
        editStatusEl.textContent = `Failed to load user: ${error.message}`;
        editStatusEl.classList.add("error-state");
    }
}

editForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const userId = getUserIdFromPath();
    if (!userId) {
        editStatusEl.textContent = "Invalid user id in URL.";
        editStatusEl.classList.add("error-state");
        return;
    }

    const payload = {
        email: normalizeOptional(document.getElementById("email")?.value),
        firstName: normalizeOptional(
            document.getElementById("firstName")?.value,
        ),
        lastName: normalizeOptional(document.getElementById("lastName")?.value),
        gdprConsent:
            String(document.getElementById("gdprConsent")?.value) === "true",
        companyId: normalizeOptional(
            document.getElementById("companyId")?.value,
        ),
    };

    editStatusEl.textContent = "Saving and publishing update...";
    editStatusEl.classList.remove("error-state");

    try {
        const response = await fetch(`/users/${encodeURIComponent(userId)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const responseBody = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                responseBody.error || `Request failed (${response.status})`,
            );
        }

        const updated = responseBody.user || {};
        setField("firstName", updated.firstName);
        setField("lastName", updated.lastName);
        setField("gdprConsent", updated.gdprConsent ? "true" : "false");
        setField("companyId", updated.companyId || "");
        editStatusEl.textContent = "User updated and sync event published.";
    } catch (error) {
        editStatusEl.textContent = `Failed to update user: ${error.message}`;
        editStatusEl.classList.add("error-state");
    }
});

loadUser();
