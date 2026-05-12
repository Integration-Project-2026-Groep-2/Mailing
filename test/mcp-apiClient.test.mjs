import { createApiClient } from "../mcp/apiClient.js"

const BASE = "http://localhost:3000"

function makeClient(fetchImpl) {
    global.fetch = fetchImpl
    return createApiClient(BASE)
}

function mockResponse(status, body) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    })
}

describe("createApiClient", () => {
    afterEach(() => { delete global.fetch })

    test("returns pretty JSON on 200", async () => {
        const { apiCall } = makeClient(() => mockResponse(200, { status: "ok" }))
        const result = await apiCall("GET", "/health")
        expect(result.isError).toBeUndefined()
        expect(result.content[0].text).toBe(JSON.stringify({ status: "ok" }, null, 2))
    })

    test("returns isError on network failure (service unreachable)", async () => {
        const { apiCall } = makeClient(() => Promise.reject(new Error("ECONNREFUSED")))
        const result = await apiCall("GET", "/health")
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("Service unreachable")
        expect(result.content[0].text).toContain("ECONNREFUSED")
    })

    test("returns isError on 404 with error field", async () => {
        const { apiCall } = makeClient(() => mockResponse(404, { error: "User not found" }))
        const result = await apiCall("GET", "/users/bad-id")
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toBe("API error 404: User not found")
    })

    test("returns isError on 409 duplicate email", async () => {
        const { apiCall } = makeClient(() => mockResponse(409, { error: "Email already exists" }))
        const result = await apiCall("POST", "/users", { email: "x@x.com", isActive: true })
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("409")
    })

    test("returns isError on 422 with details", async () => {
        const { apiCall } = makeClient(() =>
            mockResponse(422, { error: "Validation failed", details: { field: "email" } })
        )
        const result = await apiCall("POST", "/users", {})
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("422")
        expect(result.content[0].text).toContain("Details:")
    })

    test("returns isError on 502 (publish failed)", async () => {
        const { apiCall } = makeClient(() =>
            mockResponse(502, { error: "Publish failed", persisted: true })
        )
        const result = await apiCall("POST", "/users", { email: "x@x.com", isActive: true })
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("502")
    })

    test("falls back to HTTP status when body has no error or message", async () => {
        const { apiCall } = makeClient(() => mockResponse(500, null))
        const result = await apiCall("GET", "/health")
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("HTTP 500")
    })

    test("sends body as JSON for POST", async () => {
        let capturedInit
        const { apiCall } = makeClient((url, init) => {
            capturedInit = init
            return mockResponse(201, { id: "abc" })
        })
        await apiCall("POST", "/users", { email: "a@b.com", isActive: true })
        expect(capturedInit.method).toBe("POST")
        expect(capturedInit.body).toBe(JSON.stringify({ email: "a@b.com", isActive: true }))
        expect(capturedInit.headers["Content-Type"]).toBe("application/json")
    })

    test("does not send body for GET", async () => {
        let capturedInit
        const { apiCall } = makeClient((url, init) => {
            capturedInit = init
            return mockResponse(200, [])
        })
        await apiCall("GET", "/users")
        expect(capturedInit.body).toBeUndefined()
    })
})
