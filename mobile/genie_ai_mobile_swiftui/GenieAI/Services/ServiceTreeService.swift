// ServiceTreeService.swift
// Service for fetching service categories

import Foundation

@Observable
class ServiceTreeService {
    private let api = APIService.shared

    private(set) var categories: [ServiceCategory] = []
    private(set) var isLoading = false
    private(set) var error: String?

    func getAllCategories(locale: String = "en") async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        do {
            let data = try await api.get("services/categories", params: ["locale": locale])

            let decoder = JSONDecoder()
            categories = try decoder.decode([ServiceCategory].self, from: data)
        } catch {
            self.error = error.localizedDescription
            print("[ServiceTreeService] Error loading categories: \(error)")
            throw error
        }
    }

    func getCategoryServices(categoryId: String, locale: String = "en") async throws -> [ServiceItem] {
        let data = try await api.get("services/categories/\(categoryId)", params: ["locale": locale])

        struct Response: Codable {
            let children: [ServiceItem]?
        }

        let decoder = JSONDecoder()
        let response = try decoder.decode(Response.self, from: data)
        return response.children ?? []
    }

    func searchServices(query: String, locale: String = "en") async throws -> [ServiceItem] {
        let data = try await api.get("services/search", params: ["query": query, "locale": locale])

        struct Response: Codable {
            let results: [ServiceItem]?
        }

        let decoder = JSONDecoder()
        let response = try decoder.decode(Response.self, from: data)
        return response.results ?? []
    }
}
