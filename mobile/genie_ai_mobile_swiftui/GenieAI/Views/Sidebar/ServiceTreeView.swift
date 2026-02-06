// ServiceTreeView.swift
// Hierarchical display of service categories with multi-select

import SwiftUI

/// Represents a selected service for multi-select tracking
struct ServiceSelection: Equatable {
    let id: String
    let name: String
    let categoryId: String
}

struct ServiceTreeView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(AppLocaleService.self) private var appLocale

    @State private var serviceTreeService = ServiceTreeService()
    @State private var expandedCategories: Set<String> = []
    @State private var selectedServices: [ServiceSelection] = []

    var searchText: String
    var onSelectionChanged: ((_ categoryId: String, _ name: String, _ contextLabels: String) -> Void)?

    var filteredCategories: [ServiceCategory] {
        if searchText.isEmpty {
            return serviceTreeService.categories
        }
        return serviceTreeService.categories.filter { category in
            category.name.localizedCaseInsensitiveContains(searchText) ||
            category.children?.contains { $0.name.localizedCaseInsensitiveContains(searchText) } == true
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if serviceTreeService.isLoading {
                    ProgressView()
                        .padding()
                } else if let _ = serviceTreeService.error {
                    // Error state
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.title2)
                            .foregroundColor(.orange)
                        Text("Failed to load knowledge areas. Please try again.")
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)
                            .multilineTextAlignment(.center)
                        Button("Retry") {
                            Task {
                                try? await serviceTreeService.getAllCategories(locale: appLocale.currentLocale)
                            }
                        }
                        .font(.subheadline)
                        .foregroundColor(theme.primaryColor)
                    }
                    .padding()
                } else if filteredCategories.isEmpty {
                    if searchText.isEmpty {
                        Text("No knowledge areas available")
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)
                            .padding()
                    } else {
                        Text(String(localized: "No knowledge areas found for \"\\(searchText)\""))
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)
                            .padding()
                    }
                } else {
                    ForEach(filteredCategories) { category in
                        CategoryRow(
                            category: category,
                            isExpanded: expandedCategories.contains(category.id),
                            searchText: searchText,
                            selectedServices: selectedServices,
                            onToggle: {
                                withAnimation {
                                    if expandedCategories.contains(category.id) {
                                        expandedCategories.remove(category.id)
                                    } else {
                                        expandedCategories.insert(category.id)
                                    }
                                }
                            },
                            onServiceToggled: { service in
                                toggleServiceSelection(service, categoryId: category.id)
                            }
                        )
                    }
                }
            }
        }
        .task {
            if serviceTreeService.categories.isEmpty {
                await loadCategories()
            }
        }
        .onChange(of: searchText) { _, newValue in
            // Auto-expand categories with matching children on search
            if newValue.isEmpty {
                // Collapse all except those with selections
                expandedCategories = Set(
                    serviceTreeService.categories
                        .filter { cat in selectedServices.contains { $0.categoryId == cat.id } }
                        .map { $0.id }
                )
            } else {
                // Expand categories that have matching children
                let matching = filteredCategories
                    .filter { cat in
                        cat.children?.contains { $0.name.localizedCaseInsensitiveContains(newValue) } == true
                    }
                    .map { $0.id }
                expandedCategories.formUnion(matching)
            }
        }
    }

    private func loadCategories() async {
        do {
            try await serviceTreeService.getAllCategories(locale: appLocale.currentLocale)
        } catch {
            print("[ServiceTreeView] Failed to load categories: \(error)")
        }
    }

    private func toggleServiceSelection(_ service: ServiceItem, categoryId: String) {
        if let index = selectedServices.firstIndex(where: { $0.id == service.id || $0.name == service.name }) {
            // Deselect
            selectedServices.remove(at: index)
        } else {
            // Select
            selectedServices.append(ServiceSelection(
                id: service.id,
                name: service.name,
                categoryId: categoryId
            ))
        }
        emitSelectionChange()
    }

    private func emitSelectionChange() {
        guard !selectedServices.isEmpty else {
            onSelectionChanged?("", "", "")
            return
        }

        let contextString = selectedServices.map { $0.name }.joined(separator: ", ")
        let primaryCategoryId = selectedServices.first?.categoryId ?? ""
        let combinedIds = selectedServices.map { $0.id }.joined(separator: ",")

        onSelectionChanged?(primaryCategoryId, contextString, contextString)
    }
}

struct CategoryRow: View {
    @Environment(ThemeManager.self) private var theme

    let category: ServiceCategory
    let isExpanded: Bool
    let searchText: String
    let selectedServices: [ServiceSelection]
    var onToggle: () -> Void
    var onServiceToggled: ((ServiceItem) -> Void)?

    private var selectedCountInCategory: Int {
        selectedServices.filter { $0.categoryId == category.id }.count
    }

    var body: some View {
        VStack(spacing: 0) {
            // Category Header
            HStack {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
                    .frame(width: 20)

                Image(systemName: "folder.fill")
                    .font(.caption)
                    .foregroundColor(theme.primaryColor)

                Text(category.name)
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundColor(theme.primaryTextColor)

                Spacer()

                if let count = category.children?.count, count > 0 {
                    Text("\(count)")
                        .font(.caption2)
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(theme.primaryColor)
                        .cornerRadius(8)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
            .onTapGesture(perform: onToggle)

            // Children (if expanded)
            if isExpanded, let children = category.children {
                ForEach(filteredChildren(children)) { service in
                    let isSelected = selectedServices.contains { $0.id == service.id || $0.name == service.name }
                    ServiceRow(
                        service: service,
                        isSelected: isSelected
                    ) {
                        onServiceToggled?(service)
                    }
                }
            }

            Divider()
                .padding(.leading)
        }
    }

    private func filteredChildren(_ children: [ServiceItem]) -> [ServiceItem] {
        if searchText.isEmpty {
            return children
        }
        return children.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }
}

struct ServiceRow: View {
    @Environment(ThemeManager.self) private var theme

    let service: ServiceItem
    let isSelected: Bool
    var onTapped: () -> Void

    var body: some View {
        HStack {
            Text(service.name)
                .font(.system(size: 13))
                .fontWeight(isSelected ? .semibold : .regular)
                .foregroundColor(isSelected ? .white : theme.primaryTextColor)

            Spacer()

            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundColor(.white)
            }
        }
        .padding(.leading, 48)
        .padding(.trailing, 16)
        .padding(.vertical, 10)
        .background(isSelected ? theme.primaryColor : Color.clear)
        .cornerRadius(8)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTapped)
    }
}

#Preview {
    ServiceTreeView(searchText: "")
        .environment(ThemeManager())
        .environment(AppLocaleService.shared)
}
