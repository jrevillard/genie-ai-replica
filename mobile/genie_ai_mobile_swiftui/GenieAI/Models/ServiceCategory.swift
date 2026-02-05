// ServiceCategory.swift
// Service category model for the left sidebar service tree

import Foundation

struct ServiceCategory: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var description: String?
    var icon: String?
    var children: [ServiceItem]?
    var order: Int?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case description
        case icon
        case children
        case order
    }

    init(
        id: String = UUID().uuidString,
        name: String,
        description: String? = nil,
        icon: String? = nil,
        children: [ServiceItem]? = nil,
        order: Int? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.icon = icon
        self.children = children
        self.order = order
    }

    static func == (lhs: ServiceCategory, rhs: ServiceCategory) -> Bool {
        lhs.id == rhs.id
    }
}

struct ServiceItem: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var description: String?
    var categoryId: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case description
        case categoryId
    }

    init(
        id: String = UUID().uuidString,
        name: String,
        description: String? = nil,
        categoryId: String? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.categoryId = categoryId
    }

    static func == (lhs: ServiceItem, rhs: ServiceItem) -> Bool {
        lhs.id == rhs.id
    }
}

// Label for categorizing and filtering
struct Label: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var color: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case color
    }

    init(id: String = UUID().uuidString, name: String, color: String? = nil) {
        self.id = id
        self.name = name
        self.color = color
    }

    static func == (lhs: Label, rhs: Label) -> Bool {
        lhs.id == rhs.id
    }
}
