// UserService.swift
// Service for user profile and account management

import Foundation

@Observable
class UserService {
    private let api = APIService.shared

    private(set) var isLoading = false
    private(set) var error: String?

    // MARK: - Profile

    func getProfile(userId: String) async throws -> User {
        let data = try await api.get("users/\(userId)")
        return try JSONDecoder.withFlexibleDates().decode(User.self, from: data)
    }

    func updateProfile(
        userId: String,
        personalIdentification: PersonalIdentification,
        civilRegistration: CivilRegistration,
        addressResidency: AddressResidency,
        identityTravel: IdentityTravel,
        healthMedical: HealthMedical,
        employment: Employment,
        education: Education,
        financialTax: FinancialTax,
        socialSecurity: SocialSecurity,
        criminalLegal: CriminalLegal,
        transportation: Transportation,
        civicParticipation: CivicParticipation,
        files: [String: URL] = [:]
    ) async throws -> User {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let encoder = JSONEncoder()

        func toDict<T: Encodable>(_ value: T) throws -> [String: Any] {
            let data = try encoder.encode(value)
            return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        }

        var profileData: [String: Any] = [
            "personalIdentification": try toDict(personalIdentification),
            "civilRegistration": try toDict(civilRegistration),
            "addressResidency": try toDict(addressResidency),
            "identityTravel": try toDict(identityTravel),
            "healthMedical": try toDict(healthMedical),
            "employment": try toDict(employment),
            "education": try toDict(education),
            "financialTax": try toDict(financialTax),
            "socialSecurity": try toDict(socialSecurity),
            "criminalLegal": try toDict(criminalLegal),
            "transportation": try toDict(transportation),
            "civicParticipation": try toDict(civicParticipation)
        ]

        let data: Data

        if files.isEmpty {
            data = try await api.put("users/\(userId)", data: profileData)
        } else {
            // Null out fields that have file counterparts
            var fileParts: [(fieldName: String, fileURL: URL, filename: String)] = []
            for (key, url) in files {
                let parts = key.split(separator: "-", maxSplits: 1)
                if parts.count == 2,
                   let section = parts.first.map(String.init),
                   let field = parts.last.map(String.init),
                   var sectionDict = profileData[section] as? [String: Any] {
                    sectionDict[field] = nil
                    profileData[section] = sectionDict
                }
                fileParts.append((
                    fieldName: key,
                    fileURL: url,
                    filename: url.lastPathComponent
                ))
            }

            let jsonData = try JSONSerialization.data(withJSONObject: profileData)
            data = try await api.putMultipart(
                "users/\(userId)",
                jsonField: (name: "data", data: jsonData),
                files: fileParts
            )
        }

        return try JSONDecoder.withFlexibleDates().decode(User.self, from: data)
    }

    // MARK: - Account Settings

    func updateAccountSettings(userId: String, settings: [String: Any]) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let _ = try await api.put("users/\(userId)", data: settings)
    }

    func updateEmail(userId: String, newEmail: String, password: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let hashedPassword = password.sha256

        let _ = try await api.put("users/email", data: [
            "email": newEmail,
            "password": hashedPassword,
            "userId": userId
        ])
    }

    func resetUserData(userId: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let _ = try await api.post("users/reset-data", data: ["userId": userId])
    }

    func deleteAccount(password: String, reason: String = "") async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let hashedPassword = password.sha256

        let _ = try await api.post("users/delete", data: [
            "password": hashedPassword,
            "reason": reason
        ])
    }

    // MARK: - Availability Checks

    func checkUsernameAvailability(_ username: String) async throws -> Bool {
        let data = try await api.get("users/check-username", params: ["username": username])

        struct Response: Codable {
            let available: Bool
        }

        let response = try JSONDecoder.withFlexibleDates().decode(Response.self, from: data)
        return response.available
    }

    func checkEmailAvailability(_ email: String) async throws -> Bool {
        let data = try await api.get("users/check-email", params: ["email": email])

        struct Response: Codable {
            let available: Bool
        }

        let response = try JSONDecoder.withFlexibleDates().decode(Response.self, from: data)
        return response.available
    }
}
