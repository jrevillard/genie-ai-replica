import 'package:flutter/material.dart';
import 'dart:async';
import 'package:genie_ai_mobile/services/service_tree_proxy.dart';

class ServiceTreePanel extends StatefulWidget {
  final String locale;
  final Function(Map<String, dynamic> selection) onSelectionChange;

  const ServiceTreePanel({
    super.key,
    this.locale = 'en',
    required this.onSelectionChange,
  });

  @override
  State<ServiceTreePanel> createState() => _ServiceTreePanelState();
}

class _ServiceTreePanelState extends State<ServiceTreePanel> {
  final ServiceTreeProxy _serviceTreeProxy = ServiceTreeProxy();
  final TextEditingController _searchController = TextEditingController();

  // ===========================================================================
  // COMPONENT STATE - Mirrored from Vue data()
  // ===========================================================================
  List<dynamic> _nodes = [];
  Map<String, List<int>> _selectedNodes =
      {}; // Tracks selected child indices per catKey
  bool _isLoading = true;
  String? _errorMessage;
  String _searchQuery = "";
  Timer? _searchDebounce;

  @override
  void initState() {
    super.initState();
    debugPrint("[SERVICE_TREE] Component initialized. Loading categories...");
    _loadCategories();
  }

  @override
  void dispose() {
    _searchController.dispose();
    _searchDebounce?.cancel();
    super.dispose();
  }

  // ===========================================================================
  // CORE LOGIC METHODS - Mirrored from Vue methods
  // ===========================================================================

  /// Replicates loadCategories() logic
  Future<void> _loadCategories() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      // USES: Existing ServiceTreeProxy
      final List<dynamic> rawCategories = await _serviceTreeProxy.getAllCategories(
        locale: widget.locale
      );

      if (!mounted) return;

      setState(() {
        // THE FIX: Explicitly cast each element to Map<String, dynamic> to avoid TypeError
        _nodes = rawCategories.map((cat) {
          final map = Map<String, dynamic>.from(cat as Map);
          return {
            ...map,
            'expanded': false,
          };
        }).toList();
        
        _isLoading = false;
      });
      debugPrint("[SERVICE_TREE] Successfully loaded ${_nodes.length} categories.");
    } catch (e) {
      debugPrint("[SERVICE_TREE] Error loading categories: $e");
      if (mounted) {
        setState(() {
          _errorMessage = "Failed to load government services. Please try again.";
          _isLoading = false;
        });
      }
    }
  }

  /// Replicates performSearch() logic
  void _performSearch(String query) {
    setState(() {
      _searchQuery = query.toLowerCase();

      for (var node in _nodes) {
        if (_searchQuery.isEmpty) {
          node['expanded'] = false;
          continue;
        }

        final String categoryName =
            (node['name'] ?? "").toString().toLowerCase();
        final List children = node['children'] as List? ?? [];

        final bool matchesCategory = categoryName.contains(_searchQuery);
        final bool matchesChild = children.any(
            (child) => child.toString().toLowerCase().contains(_searchQuery));

        // Auto-expand node if it or any child matches the query
        node['expanded'] = matchesCategory || matchesChild;
      }
    });
  }

  /// Replicates toggleAllNodes() logic
  void _toggleAllNodes() {
    final bool anyExpanded = _nodes.any((node) => node['expanded'] == true);
    final bool shouldExpand = !anyExpanded;

    setState(() {
      for (var node in _nodes) {
        node['expanded'] = shouldExpand;
      }
    });
  }

  /// Replicates toggleChildSelection() logic
  void _toggleChildSelection(String catKey, String childName, int childIndex) {
    setState(() {
      if (!_selectedNodes.containsKey(catKey)) {
        _selectedNodes[catKey] = [];
      }

      bool isSelected;
      if (_selectedNodes[catKey]!.contains(childIndex)) {
        _selectedNodes[catKey]!.remove(childIndex);
        isSelected = false;
      } else {
        _selectedNodes[catKey]!.add(childIndex);
        isSelected = true;
      }

      // Notify parent component of the selection change
      widget.onSelectionChange({
        'category': catKey,
        'service': childName,
        'selected': isSelected,
      });
    });
  }

  bool _isChildSelected(String catKey, int childIndex) {
    return _selectedNodes[catKey]?.contains(childIndex) ?? false;
  }

  String translate(String key, String fallback) {
    // This is a placeholder for your i18n logic
    return fallback;
  }

  // ===========================================================================
  // UI BUILDERS
  // ===========================================================================

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: Color(0xFF4E97D1)),
            SizedBox(height: 16),
            Text("Loading services...", style: TextStyle(color: Colors.grey)),
          ],
        ),
      );
    }

    if (_errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, color: Colors.red, size: 48),
              const SizedBox(height: 16),
              Text(_errorMessage!, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              ElevatedButton(
                  onPressed: _loadCategories, child: const Text("Retry")),
            ],
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Panel Header
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text(
            translate("sidebar.governmentServices", "Government Services"),
            style: const TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 13,
              color: Colors.grey,
              letterSpacing: 0.5,
            ),
          ),
        ),

        _buildSearchContainer(),

        const SizedBox(height: 8),

        // Service Tree List container
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.only(bottom: 24),
            itemCount: _nodes.length,
            itemBuilder: (ctx, idx) => _buildCategoryNode(_nodes[idx]),
          ),
        ),
      ],
    );
  }

  /// Search UI mirroring the Vue search-container
  Widget _buildSearchContainer() {
    final bool anyExpanded = _nodes.any((node) => node['expanded'] == true);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _searchController,
              onChanged: _performSearch,
              decoration: InputDecoration(
                hintText: translate(
                    "sidebar.searchPlaceholder", "Search services..."),
                isDense: true,
                prefixIcon: const Icon(Icons.search, size: 18),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFFCCCCCC)),
                ),
                contentPadding: const EdgeInsets.symmetric(vertical: 8),
              ),
            ),
          ),
          const SizedBox(width: 8),
          // Toggle button
          Material(
            color: Colors.black.withOpacity(0.05),
            borderRadius: BorderRadius.circular(4),
            child: InkWell(
              onTap: _toggleAllNodes,
              child: Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                child: Text(
                  anyExpanded ? "−" : "+",
                  style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF555555)),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Builds a category node and its optional children
  Widget _buildCategoryNode(Map<String, dynamic> node) {
    final List children = node['children'] as List? ?? [];
    final String catKey = (node['catKey'] ?? "").toString();
    final bool isExpanded = node['expanded'] == true;

    // Highlight category if search matches child
    final bool hasSearchMatch = _searchQuery.isNotEmpty &&
        children.any((c) => c.toString().toLowerCase().contains(_searchQuery));

    return Column(
      children: [
        ListTile(
          dense: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16),
          onTap: () => setState(() => node['expanded'] = !isExpanded),
          leading: Icon(
            isExpanded ? Icons.arrow_drop_down : Icons.arrow_right,
            color: hasSearchMatch ? const Color(0xFF4E97D1) : Colors.grey[600],
            size: 22,
          ),
          title: Text(
            node['name'] ?? "Unknown Category",
            style: TextStyle(
              fontWeight: isExpanded ? FontWeight.bold : FontWeight.w500,
              fontSize: 13,
              color: hasSearchMatch ? const Color(0xFF4E97D1) : null,
            ),
          ),
        ),
        if (isExpanded)
          Padding(
            padding: const EdgeInsets.only(left: 32),
            child: Column(
              children: children.asMap().entries.map((entry) {
                final int index = entry.key;
                final String serviceName = entry.value.toString();
                final bool isSelected = _isChildSelected(catKey, index);

                // Real-time search highlighting
                final bool isSearchMatch = _searchQuery.isNotEmpty &&
                    serviceName.toLowerCase().contains(_searchQuery);

                return ListTile(
                  dense: true,
                  selected: isSelected,
                  selectedTileColor:
                      const Color(0x264E97D1), // 15% opacity accent
                  title: Text(
                    serviceName,
                    style: TextStyle(
                      fontSize: 12.5,
                      color: isSearchMatch
                          ? const Color(0xFF4E97D1)
                          : (isSelected ? const Color(0xFF4E97D1) : null),
                      fontWeight: isSearchMatch || isSelected
                          ? FontWeight.bold
                          : FontWeight.normal,
                    ),
                  ),
                  onTap: () =>
                      _toggleChildSelection(catKey, serviceName, index),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                  visualDensity: const VisualDensity(vertical: -3),
                  shape: Border(
                      left: BorderSide(
                          color: isSelected
                              ? const Color(0xFF4E97D1)
                              : Colors.transparent,
                          width: 2)),
                );
              }).toList(),
            ),
          )
      ],
    );
  }
}
