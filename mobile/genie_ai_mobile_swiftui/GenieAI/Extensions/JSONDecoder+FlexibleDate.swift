// JSONDecoder+FlexibleDate.swift
// Flexible ISO 8601 date decoding that handles fractional seconds and timestamps

import Foundation

extension JSONDecoder {
    /// Date decoding strategy that handles:
    /// - ISO 8601 with fractional seconds ("2026-02-05T23:07:00.123Z")
    /// - ISO 8601 without fractional seconds ("2026-02-05T23:07:00Z")
    /// - Unix timestamps (1738796820.123)
    static var flexibleDateStrategy: JSONDecoder.DateDecodingStrategy {
        .custom { decoder in
            let container = try decoder.singleValueContainer()

            // Try as numeric timestamp first
            if let timestamp = try? container.decode(Double.self) {
                return Date(timeIntervalSince1970: timestamp)
            }

            let string = try container.decode(String.self)

            // Try ISO 8601 with fractional seconds
            let formatterWithFractional = ISO8601DateFormatter()
            formatterWithFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatterWithFractional.date(from: string) {
                return date
            }

            // Try ISO 8601 without fractional seconds
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: string) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode date from: \(string)"
            )
        }
    }

    /// Convenience: returns a JSONDecoder with flexible ISO 8601 date handling
    static func withFlexibleDates() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = flexibleDateStrategy
        return decoder
    }
}
