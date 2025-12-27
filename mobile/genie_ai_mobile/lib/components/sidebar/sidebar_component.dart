import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/components/sidebar/service_tree_panel.dart';
import 'package:genie_ai_mobile/components/sidebar/chat_folders_panel.dart';

class SidebarComponent extends StatefulWidget {
  final Map<String, dynamic> user;

  final Function(Map<String, dynamic>)? onServiceSelected;
  final Function(String)? onConversationSelected;

  const SidebarComponent({
    super.key,
    required this.user,
    this.onServiceSelected,
    this.onConversationSelected,
  });

  @override
  State<SidebarComponent> createState() => _SidebarComponentState();
}

class _SidebarComponentState extends State<SidebarComponent>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  String _activeTab = "services";
  String _activeSubTab = "all";
  String _currentUserId = "";

  @override
  void initState() {
    super.initState();
    debugPrint("[SIDEBAR] Initializing Sidebar component...");

    final userData = widget.user['user'] ?? widget.user;
    _currentUserId = (userData['_key'] ?? userData['id'] ?? "").toString();

    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        setState(() {
          _activeTab = _tabController.index == 0 ? "services" : "history";
        });
      }
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  String translate(String key, [String defaultValue = ""]) {
    return defaultValue.isNotEmpty ? defaultValue : key;
  }

  Widget _buildPrimaryTabs(ThemeData theme, bool isDark) {
    return Container(
      decoration: BoxDecoration(
        color: isDark ? Colors.black12 : Colors.grey[100],
        border: Border(
          bottom: BorderSide(
            color: isDark ? Colors.white10 : Colors.grey[300]!,
            width: 1,
          ),
        ),
      ),
      child: TabBar(
        controller: _tabController,
        labelColor: theme.primaryColor,
        unselectedLabelColor: Colors.grey,
        indicatorColor: theme.primaryColor,
        indicatorSize: TabBarIndicatorSize.tab,
        labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
        tabs: const [
          Tab(
            icon: Icon(Icons.category_outlined, size: 20),
            text: "Services",
            iconMargin: EdgeInsets.only(bottom: 4),
          ),
          Tab(
            icon: Icon(Icons.history, size: 20),
            text: "History",
            iconMargin: EdgeInsets.only(bottom: 4),
          ),
        ],
      ),
    );
  }

  Widget _buildSubTabNavigation(ThemeData theme, bool isDark) {
    final List<Map<String, dynamic>> subTabs = [
      {'key': 'all', 'label': 'All', 'icon': Icons.chat_bubble_outline},
      {'key': 'folders', 'label': 'Folders', 'icon': Icons.folder_outlined},
      {'key': 'starred', 'label': 'Starred', 'icon': Icons.star_outline},
      {'key': 'archived', 'label': 'Archived', 'icon': Icons.archive_outlined},
    ];

    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: isDark ? Colors.black12 : Colors.grey[50],
        border: Border(
          bottom: BorderSide(
            color: isDark ? Colors.white10 : Colors.grey[300]!,
            width: 1,
          ),
        ),
      ),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        itemCount: subTabs.length,
        itemBuilder: (context, index) {
          final tab = subTabs[index];
          final bool isActive = _activeSubTab == tab['key'];

          return InkWell(
            onTap: () {
              setState(() {
                _activeSubTab = tab['key'] as String;
              });
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: isActive ? theme.primaryColor : Colors.transparent,
                    width: 3,
                  ),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    tab['icon'] as IconData,
                    size: 16,
                    color: isActive
                        ? theme.primaryColor
                        : (isDark ? Colors.white60 : Colors.black54),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    tab['label'] as String,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: isActive ? FontWeight.bold : FontWeight.w600,
                      color: isActive
                          ? theme.primaryColor
                          : (isDark ? Colors.white70 : Colors.black54),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildSidebarContent(ThemeData theme, bool isDark) {
    final backgroundColor = isDark ? const Color(0xFF1E1E1E) : Colors.white;

    return Container(
      color: backgroundColor,
      child: Column(
        children: [
          // Primary tabs
          _buildPrimaryTabs(theme, isDark),

          // Main expandable content
          Expanded(
            child: Column(
              children: [
                if (_activeTab == "history")
                  _buildSubTabNavigation(theme, isDark),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      ServiceTreePanel(
                        onSelectionChange: (selection) {
                          debugPrint(
                              "[SIDEBAR] Service selection changed: $selection");
                          widget.onServiceSelected?.call(selection);
                        },
                      ),
                      ChatFoldersPanel(
                        activeTab: _activeSubTab,
                        userId: _currentUserId,
                        onOpenChat: (convId) {
                          debugPrint("[SIDEBAR] Opening conversation: $convId");
                          widget.onConversationSelected?.call(convId);
                        },
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Weather footer
          Container(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Icon(
                  Icons.wb_sunny_outlined,
                  size: 24,
                  color: isDark ? Colors.amber[200] : Colors.amber[600],
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "24°C - Mostly Sunny",
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: isDark ? Colors.white70 : Colors.black87,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        translate(
                            "sidebar.weatherLocation", "Current Location"),
                        style:
                            const TextStyle(fontSize: 11, color: Colors.grey),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final bool isWideScreen = MediaQuery.of(context).size.width > 1200;

    // Persistent sidebar on wide screens
    if (isWideScreen) {
      return SizedBox(
        width: 360,
        child: _buildSidebarContent(theme, isDark),
      );
    }

    // Mobile drawer: constrained to safe area below AppBar and above bottom input
    return Drawer(
      elevation: 0,
      backgroundColor:
          Colors.transparent, // Important: no background on drawer itself
      child: SafeArea(
        top: false, // We manually handle top (AppBar height)
        bottom: true, // Respect bottom safe area (home indicator)
        child: Column(
          children: [
            // Empty space equal to AppBar height (60) so content starts below navbar
            SizedBox(
              height: kToolbarHeight + MediaQuery.of(context).padding.top,
            ),
            // The actual sidebar content
            Expanded(
              child: _buildSidebarContent(theme, isDark),
            ),
          ],
        ),
      ),
    );
  }
}
