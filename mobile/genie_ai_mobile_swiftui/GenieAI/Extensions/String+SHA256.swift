// String+SHA256.swift
// Extension for SHA256 hashing of strings

import Foundation
import CryptoKit

extension String {
    /// Returns the SHA256 hash of the string as a hex string
    var sha256: String {
        let inputData = Data(self.utf8)
        let hashed = SHA256.hash(data: inputData)
        return hashed.compactMap { String(format: "%02x", $0) }.joined()
    }
}
