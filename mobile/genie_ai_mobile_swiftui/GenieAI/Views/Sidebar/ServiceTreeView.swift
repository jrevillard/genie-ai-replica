// ServiceTreeView.swift
// Hierarchical display of service categories with multi-select — Liquid Glass design

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
    @State private var visibleCount = 0

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

    private var totalItemCount: Int {
        max(filteredCategories.count, 1)
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: theme.spacingMD) {
                if serviceTreeService.isLoading {
                    loadingState
                } else if let _ = serviceTreeService.error {
                    errorState
                } else if filteredCategories.isEmpty {
                    emptyState
                } else {
                    ForEach(Array(filteredCategories.enumerated()), id: \.element.id) { offset, category in
                        CategoryRow(
                            category: category,
                            isExpanded: expandedCategories.contains(category.id),
                            searchText: searchText,
                            selectedServices: selectedServices,
                            onToggle: {
                                withAnimation(theme.animationSmooth) {
                                    if expandedCategories.contains(category.id) {
                                        expandedCategories.remove(category.id)
                                    } else {
                                        expandedCategories.insert(category.id)
                                    }
                                }
                                if theme.hapticsEnabled {
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                }
                            },
                            onServiceToggled: { service in
                                toggleServiceSelection(service, categoryId: category.id)
                            }
                        )
                        .staggeredAppearance(index: offset, visibleCount: visibleCount, theme: theme)
                    }
                }
            }
            .padding(.horizontal, theme.spacingMD)
            .padding(.top, theme.spacingMD)
            .padding(.bottom, theme.spacingXL)
        }
        .task {
            if serviceTreeService.categories.isEmpty {
                await loadCategories()
            }
        }
        .onAppear { triggerStaggeredAnimation() }
        .onChange(of: serviceTreeService.categories.count) { _, _ in triggerStaggeredAnimation() }
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

    // MARK: - Staggered Animation

    private func triggerStaggeredAnimation() {
        visibleCount = 0
        DispatchQueue.main.async {
            visibleCount = totalItemCount
        }
    }

    // MARK: - Loading State

    private var loadingState: some View {
        VStack(spacing: theme.spacingMD) {
            ProgressView()
                .tint(theme.primaryColor)
            Text("Loading knowledge areas...")
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)
        }
        .frame(maxWidth: .infinity)
        .padding(theme.spacingXL)
    }

    // MARK: - Error State

    private var errorState: some View {
        VStack(spacing: theme.spacingMD) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundColor(.orange.opacity(0.7))

            Text("Failed to load knowledge areas. Please try again.")
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)
                .italic()
                .multilineTextAlignment(.center)

            Button {
                Task {
                    try? await serviceTreeService.getAllCategories(locale: appLocale.currentLocale)
                }
            } label: {
                Text("Retry")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
                    .background(theme.primaryColor, in: Capsule())
            }
        }
        .frame(maxWidth: .infinity)
        .padding(theme.spacingXL)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: theme.radiusLG, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: theme.radiusLG, style: .continuous)
                .stroke(theme.glassBorder, lineWidth: 1)
        )
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: theme.spacingMD) {
            Image(systemName: searchText.isEmpty ? "square.grid.2x2" : "magnifyingglass")
                .font(.system(size: 32))
                .foregroundColor(theme.secondaryTextColor.opacity(0.5))

            Text(searchText.isEmpty
                 ? String(localized: "No knowledge areas available")
                 : String(localized: "No knowledge areas found for \"\(searchText)\""))
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)
                .italic()
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(theme.spacingXL)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: theme.radiusLG, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: theme.radiusLG, style: .continuous)
                .stroke(theme.glassBorder, lineWidth: 1)
        )
    }

    // MARK: - Helpers

    private func loadCategories() async {
        do {
            try await serviceTreeService.getAllCategories(locale: appLocale.currentLocale)
        } catch {
            print("[ServiceTreeView] Failed to load categories: \(error)")
        }
    }

    private func toggleServiceSelection(_ service: ServiceItem, categoryId: String) {
        withAnimation(theme.animationSmooth) {
            if let index = selectedServices.firstIndex(where: { $0.id == service.id || $0.name == service.name }) {
                selectedServices.remove(at: index)
            } else {
                selectedServices.append(ServiceSelection(
                    id: service.id,
                    name: service.name,
                    categoryId: categoryId
                ))
            }
        }
        if theme.hapticsEnabled {
            UISelectionFeedbackGenerator().selectionChanged()
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

        onSelectionChanged?(primaryCategoryId, contextString, contextString)
    }
}

// MARK: - Category Row

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
            Button(action: onToggle) {
                HStack(spacing: theme.spacingMD) {
                    // Colored circle icon badge (deterministic color per category)
                    Image(systemName: "book.closed")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(CategoryPalette.color(for: category.name), in: Circle())

                    Text(category.name)
                        .font(.subheadline)
                        .fontWeight(.bold)
                        .foregroundColor(theme.primaryTextColor)
                        .lineLimit(1)

                    Spacer()

                    // Selected count badge
                    if selectedCountInCategory > 0 {
                        Text("\(selectedCountInCategory)")
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundStyle(.white)
                            .frame(width: 20, height: 20)
                            .background(theme.primaryColor, in: Circle())
                    }

                    // Children count pill
                    if let count = category.children?.count, count > 0 {
                        Text("\(count)")
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .foregroundColor(theme.primaryColor)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(theme.primaryColor.opacity(0.12), in: Capsule())
                    }

                    // Rotating chevron
                    Image(systemName: "chevron.forward")
                        .font(.footnote)
                        .fontWeight(.semibold)
                        .foregroundColor(isExpanded ? theme.primaryColor : theme.secondaryTextColor)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .padding(theme.spacingMD)
                .contentShape(Rectangle())
            }
            .buttonStyle(GlassPressButtonStyle(hapticsEnabled: theme.hapticsEnabled))

            // Children (if expanded)
            if isExpanded, let children = category.children {
                VStack(spacing: theme.spacingXS) {
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
                .padding(.horizontal, theme.spacingMD)
                .padding(.bottom, theme.spacingMD)
            }
        }
        .glassCard(theme: theme)
    }

    private func filteredChildren(_ children: [ServiceItem]) -> [ServiceItem] {
        if searchText.isEmpty {
            return children
        }
        return children.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }
}

// MARK: - Service Row

struct ServiceRow: View {
    @Environment(ThemeManager.self) private var theme

    let service: ServiceItem
    let isSelected: Bool
    var onTapped: () -> Void

    var body: some View {
        Button(action: onTapped) {
            HStack(spacing: theme.spacingMD) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 18))
                    .foregroundColor(isSelected ? theme.primaryColor : theme.secondaryTextColor.opacity(0.5))
                    .contentTransition(.symbolEffect(.replace))

                Text(service.name)
                    .font(.subheadline)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .foregroundColor(isSelected ? theme.primaryColor : theme.primaryTextColor)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                Spacer()
            }
            .padding(.horizontal, theme.spacingMD)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
            .background(
                isSelected
                    ? RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous)
                        .fill(theme.primaryColor.opacity(0.08))
                    : nil
            )
        }
        .buttonStyle(GlassPressButtonStyle(hapticsEnabled: theme.hapticsEnabled))
    }
}

#Preview {
    ServiceTreeView(searchText: "")
        .environment(ThemeManager())
        .environment(AppLocaleService.shared)
}
