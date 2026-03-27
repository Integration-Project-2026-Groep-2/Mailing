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
        setField("companyId", user.companyId || "-");

        editStatusEl.textContent = `Loaded user: ${escapeHtml(user.email)}`;
        editStatusEl.classList.remove("error-state");
    } catch (error) {
        editStatusEl.textContent = `Failed to load user: ${error.message}`;
        editStatusEl.classList.add("error-state");
    }
}

editForm.addEventListener("submit", (event) => {
    event.preventDefault();
    editStatusEl.textContent = "Update action is not implemented yet.";
    editStatusEl.classList.remove("error-state");
});

loadUser();
