const DEFAULT_TIMEOUT_MS = 15_000

export function createApiClient(baseUrl) {
    async function apiCall(method, path, body) {
        const url = `${baseUrl}${path}`
        const init = {
            method,
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        }
        if (body !== undefined) init.body = JSON.stringify(body)

        let response
        try {
            response = await fetch(url, init)
        } catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `Service unreachable (${baseUrl}): ${err.message}` }],
            }
        }

        let data
        try { data = await response.json() } catch { data = null }

        if (!response.ok) {
            const msg = data?.error ?? data?.message ?? `HTTP ${response.status}`
            const det = data?.details ? `\nDetails: ${JSON.stringify(data.details)}` : ""
            return {
                isError: true,
                content: [{ type: "text", text: `API error ${response.status}: ${msg}${det}` }],
            }
        }

        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    }

    return { apiCall }
}
