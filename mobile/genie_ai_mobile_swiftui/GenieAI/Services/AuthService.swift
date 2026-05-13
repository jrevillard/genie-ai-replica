// AuthService.swift
// Handles user authentication via Keycloak's OIDC authorization-code flow
// with PKCE. The user signs in through Keycloak's hosted page presented in
// an ASWebAuthenticationSession; the app receives an authorization code via
// a custom URL scheme, exchanges it for tokens, and persists them in the
// Keychain.

import Foundation
import Security
import CryptoKit
import AuthenticationServices
import UIKit

@Observable
class AuthService: NSObject {
    private let api = APIService.shared

    private(set) var currentUser: User?
    private(set) var isAuthenticated = false
    private(set) var isLoading = false
    private(set) var error: String?

    // MARK: - OIDC configuration
    //
    // Hard-coded for now (matches the Keycloak public client `genie-app` and
    // the redirect URI registered against it). If the backend host ever moves
    // we should derive these from a single source of truth (e.g. a config
    // file or the existing APIService.baseURL).
    private let keycloakIssuer = URL(string: "https://app.youngailinz.org/auth/realms/genie")!
    private let clientId = "genie-app"
    private let redirectURI = "int.itu.GenieAI://oauth2redirect"
    private let scope = "openid profile email"

    private var pendingVerifier: String?
    private var pendingState: String?
    private var authSession: ASWebAuthenticationSession?

    var accessToken: String? {
        get async { await api.getToken() }
    }

    override init() {
        super.init()
        Task {
            await loadStoredToken()
        }
    }

    // MARK: - Public: sign-in / sign-out

    /// Launch Keycloak's hosted login page in an ASWebAuthenticationSession
    /// and complete the PKCE code-exchange. On success the access/refresh
    /// tokens are stored in the Keychain and currentUser is populated.
    @MainActor
    func signIn() async throws {
        isLoading = true
        error = nil
        defer { isLoading = false }

        let verifier = Self.generateCodeVerifier()
        let challenge = Self.codeChallenge(from: verifier)
        let state = Self.generateState()
        pendingVerifier = verifier
        pendingState = state

        let authURL = buildAuthorizeURL(codeChallenge: challenge, state: state)
        let callback = try await presentSession(authURL: authURL)

        guard
            let components = URLComponents(url: callback, resolvingAgainstBaseURL: false),
            let returnedState = components.queryItems?.first(where: { $0.name == "state" })?.value,
            returnedState == state,
            let code = components.queryItems?.first(where: { $0.name == "code" })?.value
        else {
            if let errCode = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "error" })?.value {
                throw AuthError.serverError(errCode)
            }
            throw AuthError.invalidCredentials
        }

        let tokens = try await exchangeCodeForTokens(code: code, verifier: verifier)
        try await applyTokens(tokens)
    }

    func signOut() async {
        isLoading = true
        defer {
            isLoading = false
            currentUser = nil
            isAuthenticated = false
        }

        await api.clearToken()
        clearStoredTokens()
        // Keycloak end-session: best-effort, fire-and-forget. We don't open
        // a browser session for it — that would interrupt the user.
    }

    /// Refresh the access token using the stored refresh token. Throws if
    /// no refresh token is stored or the refresh fails.
    func refreshAccessToken() async throws {
        guard let refresh = loadRefreshToken() else {
            throw AuthError.noRefreshToken
        }
        let tokens = try await postToToken(body: [
            "grant_type": "refresh_token",
            "client_id": clientId,
            "refresh_token": refresh
        ])
        try await applyTokens(tokens, fetchUser: false)
    }

    func fetchCurrentUser() async throws {
        let data = try await api.get("me")
        let decoded = try JSONDecoder.withFlexibleDates().decode(User.self, from: data)
        currentUser = decoded
    }

    /// Back-compat alias for existing callers (e.g. ContentView's profile menu).
    func logout() async {
        await signOut()
    }

    // MARK: - PKCE helpers

    private static func generateCodeVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64URLEncodedString()
    }

    private static func codeChallenge(from verifier: String) -> String {
        let hash = SHA256.hash(data: Data(verifier.utf8))
        return Data(hash).base64URLEncodedString()
    }

    private static func generateState() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64URLEncodedString()
    }

    // MARK: - Authorize URL

    private func buildAuthorizeURL(codeChallenge: String, state: String) -> URL {
        var c = URLComponents(url: keycloakIssuer.appendingPathComponent("protocol/openid-connect/auth"),
                              resolvingAgainstBaseURL: false)!
        c.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "scope", value: scope),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state)
        ]
        return c.url!
    }

    // MARK: - ASWebAuthenticationSession

    @MainActor
    private func presentSession(authURL: URL) async throws -> URL {
        let callbackScheme = "int.itu.GenieAI"
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: authURL, callbackURLScheme: callbackScheme) { url, err in
                if let url {
                    continuation.resume(returning: url)
                } else if let err {
                    if let asErr = err as? ASWebAuthenticationSessionError, asErr.code == .canceledLogin {
                        continuation.resume(throwing: AuthError.cancelled)
                    } else {
                        continuation.resume(throwing: err)
                    }
                } else {
                    continuation.resume(throwing: AuthError.unknown)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            authSession = session
            session.start()
        }
    }

    // MARK: - Token exchange

    private func exchangeCodeForTokens(code: String, verifier: String) async throws -> TokenResponse {
        return try await postToToken(body: [
            "grant_type": "authorization_code",
            "client_id": clientId,
            "code": code,
            "redirect_uri": redirectURI,
            "code_verifier": verifier
        ])
    }

    private func postToToken(body: [String: String]) async throws -> TokenResponse {
        let url = keycloakIssuer.appendingPathComponent("protocol/openid-connect/token")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
            .map { "\($0.key)=\(Self.urlEncode($0.value))" }
            .joined(separator: "&")
            .data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let bodyString = String(data: data, encoding: .utf8) ?? ""
            throw AuthError.serverError("token endpoint: \(bodyString)")
        }
        return try JSONDecoder().decode(TokenResponse.self, from: data)
    }

    @MainActor
    private func applyTokens(_ tokens: TokenResponse, fetchUser: Bool = true) async throws {
        await api.setToken(tokens.accessToken)
        saveToken(tokens.accessToken)
        if let refresh = tokens.refreshToken {
            saveRefreshToken(refresh)
        }
        isAuthenticated = true
        if fetchUser {
            try await fetchCurrentUser()
        }
    }

    private static func urlEncode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? s
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
        guard let token = loadFromKeychain(key: accessTokenKey) else { return }
        await api.setToken(token)
        do {
            try await fetchCurrentUser()
            await MainActor.run { isAuthenticated = true }
        } catch {
            // Token may have expired — try refresh once before giving up.
            do {
                try await refreshAccessToken()
                try await fetchCurrentUser()
                await MainActor.run { isAuthenticated = true }
            } catch {
                print("[AuthService] Stored token unusable: \(error)")
                clearStoredTokens()
                await api.clearToken()
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

// MARK: - ASWebAuthenticationPresentationContextProviding

extension AuthService: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes
        let window = scenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first(where: { $0.isKeyWindow }) ?? UIWindow()
        return window
    }
}

// MARK: - Token response model

private struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let idToken: String?
    let expiresIn: Int?
    let tokenType: String?

    private enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case idToken = "id_token"
        case expiresIn = "expires_in"
        case tokenType = "token_type"
    }
}

// MARK: - base64url helper

private extension Data {
    func base64URLEncodedString() -> String {
        return base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private extension CharacterSet {
    static let urlQueryValueAllowed: CharacterSet = {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "+&=?")
        return allowed
    }()
}

// MARK: - Auth Error

enum AuthError: Error, LocalizedError {
    case noRefreshToken
    case invalidCredentials
    case networkError
    case serverError(String)
    case cancelled
    case unknown

    var errorDescription: String? {
        switch self {
        case .noRefreshToken: return "No refresh token available"
        case .invalidCredentials: return "Invalid credentials"
        case .networkError: return "Network error"
        case .serverError(let message): return message
        case .cancelled: return "Sign-in was cancelled"
        case .unknown: return "An unknown error occurred"
        }
    }
}
