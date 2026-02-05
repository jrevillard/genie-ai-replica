// PasswordValidator.swift
// Password strength validation utility (ported from Flutter password_proxy.dart)

import SwiftUI

struct PasswordStrength {
    let score: Int      // 0-4
    let isValid: Bool

    var color: Color {
        switch score {
        case 0: return .red
        case 1: return .orange
        case 2: return .yellow
        case 3: return .green
        default: return .green
        }
    }

    var normalizedScore: Double {
        Double(score) / 4.0
    }
}

enum PasswordValidator {
    static func validateStrength(_ password: String) -> PasswordStrength {
        guard !password.isEmpty else {
            return PasswordStrength(score: 0, isValid: false)
        }

        var score = 0

        // Lowercase letter
        if password.range(of: "[a-z]", options: .regularExpression) != nil {
            score += 1
        }

        // Uppercase letter
        if password.range(of: "[A-Z]", options: .regularExpression) != nil {
            score += 1
        }

        // Digit
        if password.range(of: "[0-9]", options: .regularExpression) != nil {
            score += 1
        }

        // Special character
        if password.range(of: "[^a-zA-Z0-9]", options: .regularExpression) != nil {
            score += 1
        }

        // Length bonus
        if password.count >= 12 {
            score += 1
        }

        // Clamp to 0-4
        let clampedScore = min(score, 4)

        // Valid if score >= 3 AND length >= 8
        let isValid = clampedScore >= 3 && password.count >= 8

        return PasswordStrength(score: clampedScore, isValid: isValid)
    }

    static func doPasswordsMatch(_ password: String, _ confirmPassword: String) -> Bool {
        password == confirmPassword
    }
}
