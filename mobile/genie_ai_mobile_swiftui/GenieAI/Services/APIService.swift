// APIService.swift
// Base HTTP client with token management using async/await

import Foundation

actor APIService {
    static let shared = APIService()

    private let baseURL = "https://app.youngailinz.org/api"
    private var accessToken: String?
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)
    }

    // MARK: - Token Management

    /// Closure invoked when a request returns 401. AuthService installs this
    /// to perform a Keycloak refresh-token grant; on success the original
    /// request is retried once with the new bearer.
    private var onUnauthorized: (@Sendable () async throws -> Void)?

    /// Tracks an in-flight refresh so concurrent 401s coalesce into a single
    /// refresh round-trip rather than triggering N parallel grants.
    private var refreshTask: Task<Void, Error>?

    func setUnauthorizedHandler(_ handler: @Sendable @escaping () async throws -> Void) {
        onUnauthorized = handler
    }

    func setToken(_ token: String) {
        print("[APIService] Setting access token: \(String(token.prefix(5)))...")
        accessToken = token
    }

    func clearToken() {
        print("[APIService] Clearing access token")
        accessToken = nil
    }

    func getToken() -> String? {
        accessToken
    }

    // MARK: - Headers

    private func getHeaders(contentType: String = "application/json") -> [String: String] {
        var headers: [String: String] = [
            "Content-Type": contentType
        ]
        if let token = accessToken {
            headers["Authorization"] = "Bearer \(token)"
        }
        return headers
    }

    // MARK: - HTTP Methods

    func get(_ endpoint: String, params: [String: String]? = nil) async throws -> Data {
        var urlString = "\(baseURL)/\(endpoint)"
        if let params = params, !params.isEmpty {
            let queryString = params.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
            urlString += "?\(queryString)"
        }

        guard let url = URL(string: urlString) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.allHTTPHeaderFields = getHeaders()

        print("----------------------------------------------------------------")
        print("[API Request] GET")
        print("URL: \(url)")

        return try await performRequest(request)
    }

    func post(_ endpoint: String, data: [String: Any]) async throws -> Data {
        guard let url = URL(string: "\(baseURL)/\(endpoint)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.allHTTPHeaderFields = getHeaders()
        request.httpBody = try JSONSerialization.data(withJSONObject: data)

        print("----------------------------------------------------------------")
        print("[API Request] POST")
        print("URL: \(url)")
        print("Body: \(data)")

        return try await performRequest(request)
    }

    func put(_ endpoint: String, data: [String: Any]) async throws -> Data {
        guard let url = URL(string: "\(baseURL)/\(endpoint)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.allHTTPHeaderFields = getHeaders()
        request.httpBody = try JSONSerialization.data(withJSONObject: data)

        print("----------------------------------------------------------------")
        print("[API Request] PUT")
        print("URL: \(url)")
        print("Body: \(data)")

        return try await performRequest(request)
    }

    func patch(_ endpoint: String, data: [String: Any]) async throws -> Data {
        guard let url = URL(string: "\(baseURL)/\(endpoint)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.allHTTPHeaderFields = getHeaders()
        request.httpBody = try JSONSerialization.data(withJSONObject: data)

        print("----------------------------------------------------------------")
        print("[API Request] PATCH")
        print("URL: \(url)")
        print("Body: \(data)")

        return try await performRequest(request)
    }

    func putMultipart(
        _ endpoint: String,
        jsonField: (name: String, data: Data),
        files: [(fieldName: String, fileURL: URL, filename: String)]
    ) async throws -> Data {
        guard let url = URL(string: "\(baseURL)/\(endpoint)") else {
            throw APIError.invalidURL
        }

        let boundary = UUID().uuidString

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let token = accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        var body = Data()

        // JSON data field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(jsonField.name)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: application/json\r\n\r\n".data(using: .utf8)!)
        body.append(jsonField.data)
        body.append("\r\n".data(using: .utf8)!)

        // File parts
        for file in files {
            let fileData = try Data(contentsOf: file.fileURL)
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(file.fieldName)\"; filename=\"\(file.filename)\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
            body.append(fileData)
            body.append("\r\n".data(using: .utf8)!)
        }

        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        print("----------------------------------------------------------------")
        print("[API Request] PUT multipart")
        print("URL: \(url)")
        print("Files: \(files.map { $0.fieldName })")

        return try await performRequest(request)
    }

    func delete(_ endpoint: String, params: [String: String]? = nil) async throws -> Data {
        var urlString = "\(baseURL)/\(endpoint)"
        if let params = params, !params.isEmpty {
            let queryString = params.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
            urlString += "?\(queryString)"
        }

        guard let url = URL(string: urlString) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.allHTTPHeaderFields = getHeaders()

        print("----------------------------------------------------------------")
        print("[API Request] DELETE")
        print("URL: \(url)")

        return try await performRequest(request)
    }

    // MARK: - Request Execution

    private func performRequest(_ request: URLRequest) async throws -> Data {
        var req = request
        var didRetry = false

        while true {
            do {
                let (data, response) = try await session.data(for: req)

                guard let httpResponse = response as? HTTPURLResponse else {
                    throw APIError.invalidResponse
                }

                print("[API Response] Status Code: \(httpResponse.statusCode)")
                if let bodyString = String(data: data, encoding: .utf8) {
                    print("Body: \(bodyString)")
                }
                print("----------------------------------------------------------------")

                // Refresh-on-401: if the auth layer has installed a handler,
                // try to refresh tokens once and replay the request with the
                // new bearer. If the refresh itself fails (or the retry also
                // returns 401), surface the error to the caller.
                if httpResponse.statusCode == 401, !didRetry, onUnauthorized != nil {
                    do {
                        try await coalescedRefresh()
                    } catch {
                        throw APIError.httpError(statusCode: 401, data: data)
                    }
                    if let token = accessToken {
                        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    }
                    didRetry = true
                    continue
                }

                guard (200...299).contains(httpResponse.statusCode) else {
                    throw APIError.httpError(statusCode: httpResponse.statusCode, data: data)
                }

                return data
            } catch let error as APIError {
                throw error
            } catch {
                print("!!!!!!!!!!! [API EXCEPTION] !!!!!!!!!!!")
                print("Error: \(error)")
                print("----------------------------------------------------------------")
                throw APIError.networkError(error)
            }
        }
    }

    /// Run the unauthorized handler, coalescing concurrent 401 retries so the
    /// app fires at most one refresh-token round-trip at a time.
    private func coalescedRefresh() async throws {
        if let existing = refreshTask {
            try await existing.value
            return
        }
        guard let handler = onUnauthorized else { return }
        let task = Task<Void, Error> { try await handler() }
        refreshTask = task
        do {
            try await task.value
            refreshTask = nil
        } catch {
            refreshTask = nil
            throw error
        }
    }
}

// MARK: - API Error

enum APIError: Error, LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int, data: Data)
    case networkError(Error)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode, _):
            return "HTTP Error: \(statusCode)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .decodingError(let error):
            return "Decoding error: \(error.localizedDescription)"
        }
    }
}
