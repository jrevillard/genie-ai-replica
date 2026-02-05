// AuthService.swift
// Authentication service managing login, registration, and token storage

import Foundation
import Security

@Observable
class AuthService {
    private let api = APIService.shared

    private(set) var currentUser: User?
    private(set) var isAuthenticated = false
    private(set) var isLoading = false
    private(set) var error: String?

    var accessToken: String? {
        get async { await api.getToken() }
    }

    init() {
        Task {
            await loadStoredToken()
        }
    }

    // MARK: - Authentication

    func login(loginName: String, password: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let hashedPassword = password.sha256

        let data = try await api.post("auth/login", data: [
            "loginName": loginName,
            "encPassword": hashedPassword
        ])

        let response = try JSONDecoder.withFlexibleDates().decode(AuthResponse.self, from: data)

        await api.setToken(response.accessToken)
        saveToken(response.accessToken)

        if let refreshToken = response.refreshToken {
            saveRefreshToken(refreshToken)
        }

        currentUser = response.user
        isAuthenticated = true

        // Fetch full user data if not included in response
        if currentUser == nil {
            try await fetchCurrentUser()
        }
    }

    func register(username: String, email: String, password: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let hashedPassword = password.sha256

        let data = try await api.post("auth/register", data: [
            "username": username,
            "email": email,
            "encPassword": hashedPassword
        ])

        // Registration successful - user needs to verify email
        let _ = try JSONDecoder.withFlexibleDates().decode([String: AnyCodable].self, from: data)
    }

    func logout() async {
        isLoading = true

        defer {
            isLoading = false
            currentUser = nil
            isAuthenticated = false
        }

        do {
            let _ = try await api.post("auth/logout", data: [:])
        } catch {
            print("[AuthService] Logout error: \(error)")
        }

        await api.clearToken()
        clearStoredTokens()
    }

    func fetchCurrentUser() async throws {
        let data = try await api.get("auth/me")

        struct MeResponse: Codable {
            let user: User?
        }

        let response = try JSONDecoder.withFlexibleDates().decode(MeResponse.self, from: data)
        currentUser = response.user
    }

    func refreshToken() async throws {
        guard let refreshToken = loadRefreshToken() else {
            throw AuthError.noRefreshToken
        }

        let data = try await api.post("auth/refresh-token", data: [
            "refreshToken": refreshToken
        ])

        let response = try JSONDecoder.withFlexibleDates().decode(AuthResponse.self, from: data)

        await api.setToken(response.accessToken)
        saveToken(response.accessToken)

        if let newRefreshToken = response.refreshToken {
            saveRefreshToken(newRefreshToken)
        }
    }

    // MARK: - Password Reset

    func initiatePasswordReset(email: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let _ = try await api.post("auth/reset-password", data: [
            "email": email
        ])
    }

    func confirmPasswordReset(token: String, newPassword: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let hashedPassword = newPassword.sha256

        let _ = try await api.post("auth/reset-password/confirm", data: [
            "token": token,
            "newPassword": hashedPassword
        ])
    }

    func verifyEmail(token: String) async throws {
        let _ = try await api.get("auth/verify-email/\(token)")
    }

    // MARK: - Token Storage (Keychain)

    private let accessTokenKey = "genie_ai_access_token"
    private let refreshTokenKey = "genie_ai_refresh_token"

    private func saveToken(_ token: String) {
        saveToKeychain(key: accessTokenKey, value: token)
    }

    private func saveRefreshToken(_ token: String) {
        saveToKeychain(key: refreshTokenKey, value: token)
    }

    private func loadStoredToken() async {
        if let token = loadFromKeychain(key: accessTokenKey) {
            await api.setToken(token)

            do {
                try await fetchCurrentUser()
                isAuthenticated = true
            } catch {
                print("[AuthService] Failed to fetch user with stored token: \(error)")
                clearStoredTokens()
            }
        }
    }

    private func loadRefreshToken() -> String? {
        loadFromKeychain(key: refreshTokenKey)
    }

    private func clearStoredTokens() {
        deleteFromKeychain(key: accessTokenKey)
        deleteFromKeychain(key: refreshTokenKey)
    }

    // MARK: - Keychain Helpers

    private func saveToKeychain(key: String, value: String) {
        let data = value.data(using: .utf8)!

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]

        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    private func loadFromKeychain(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }

        return value
    }

    private func deleteFromKeychain(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]

        SecItemDelete(query as CFDictionary)
    }
}

// MARK: - Auth Error

enum AuthError: Error, LocalizedError {
    case noRefreshToken
    case invalidCredentials
    case networkError
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .noRefreshToken:
            return "No refresh token available"
        case .invalidCredentials:
            return "Invalid credentials"
        case .networkError:
            return "Network error"
        case .serverError(let message):
            return message
        }
    }
}
