import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/components/sidebar/service_tree_panel.dart';
import 'package:genie_ai_mobile/components/sidebar/chat_folders_panel.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

class SidebarComponent extends StatefulWidget {
  final Map<String, dynamic> user;
  const SidebarComponent({super.key, required this.user});

  @override
  State<SidebarComponent> createState() => _SidebarComponentState();
}

class _SidebarComponentState extends State<SidebarComponent>
    with SingleTickerProviderStateMixin {
  // ===========================================================================
  // COMPONENT STATE - Mirrored from Vue data()
  // ===========================================================================
  late TabController _tabController;
  String _activeTab = "services"; // 'services' or 'history'
  String _activeSubTab = "all"; // 'all', 'folders', 'starred', 'archived'
  String _currentUserId = "";

  @override
  void initState() {
    super.initState();
    debugPrint("[SIDEBAR] Initializing Sidebar component...");

    // Extract user ID for sub-component integration
    final userData = widget.user['user'] ?? widget.user;
    _currentUserId = (userData['_key'] ?? userData['id'] ?? "").toString();

    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        setState(() {
          _activeTab = _tabController.index == 0 ? "services" : "history";
        });
        debugPrint("[SIDEBAR] Primary tab switched to: $_activeTab");
      }
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  String translate(String key, String fallback) => fallback;

  // ===========================================================================
  // UI BUILDERS
  // ===========================================================================

  @override
  Widget build(BuildContext context) {
    final isDark = ThemeManager().isDarkMode;
    final bgColor = isDark ? const Color(0xFF222222) : Colors.white;
    const accentColor = Color(0xFF2A9D8F);

    return Drawer(
      width: 320,
      backgroundColor: bgColor,
      child: Column(
        children: [
          _buildSidebarHeader(),
          _buildPrimaryTabs(accentColor, isDark),
          Expanded(
            child: Container(
              color: isDark ? const Color(0xFF1E1E1E) : const Color(0xFFF9FAFB),
              child: TabBarView(
                controller: _tabController,
                children: [
                  // Tab 1: Government Services
                  ServiceTreePanel(
                    onSelectionChange: (sel) =>
                        debugPrint("[SIDEBAR] Service selection: $sel"),
                  ),
                  // Tab 2: Chat History & Folders
                  _buildHistoryContent(accentColor, isDark),
                ],
              ),
            ),
          ),
          _buildWeatherContainer(isDark),
        ],
      ),
    );
  }

  /// Replicates sidebar-tabs styling
  Widget _buildPrimaryTabs(Color accent, bool isDark) {
    return Container(
      height: 50,
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF2A2A2A) : const Color(0xFFF3F4F6),
        border: Border(
            bottom:
                BorderSide(color: isDark ? Colors.white10 : Colors.black12)),
      ),
      child: TabBar(
        controller: _tabController,
        indicatorColor: accent,
        indicatorWeight: 3,
        labelColor: accent,
        unselectedLabelColor: isDark ? Colors.white60 : Colors.black54,
        labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
        tabs: [
          Tab(
            icon: const Icon(Icons.list, size: 20),
            text: translate("sidebar.governmentServices", "SERVICES"),
          ),
          Tab(
            icon: const Icon(Icons.history, size: 20),
            text: translate("sidebar.savedChats", "HISTORY"),
          ),
        ],
      ),
    );
  }

  /// Replicates chat-sub-tabs and folder navigation
  Widget _buildHistoryContent(Color accent, bool isDark) {
    return Column(
      children: [
        _buildSubTabNavigation(accent, isDark),
        Expanded(
          child: ChatFoldersPanel(
            activeTab: _activeSubTab,
            userId: _currentUserId,
            onOpenChat: (chatId) =>
                debugPrint("[SIDEBAR] Opening chat: $chatId"),
          ),
        ),
      ],
    );
  }

  /// Horizontal sub-tab bar for All/Folders/Starred/Archived
  Widget _buildSubTabNavigation(Color accent, bool isDark) {
    final subTabs = ['all', 'folders', 'starred', 'archived'];

    return Container(
      height: 40,
      decoration: BoxDecoration(
        color: isDark ? Colors.black26 : Colors.white,
        border: Border(
            bottom:
                BorderSide(color: isDark ? Colors.white10 : Colors.black12)),
      ),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: subTabs.length,
        itemBuilder: (ctx, idx) {
          final tab = subTabs[idx];
          final isActive = _activeSubTab == tab;

          return InkWell(
            onTap: () => setState(() => _activeSubTab = tab),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color:
                        isActive ? const Color(0xFF4E97D1) : Colors.transparent,
                    width: 2,
                  ),
                ),
              ),
              child: Text(
                tab.toUpperCase(),
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                  color: isActive
                      ? const Color(0xFF4E97D1)
                      : (isDark ? Colors.white38 : Colors.black38),
                  letterSpacing: 0.5,
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildSidebarHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 50, 16, 16),
      color: const Color(0xFF4E97D1),
      child: Row(
        children: [
          const Icon(Icons.auto_awesome, color: Colors.white, size: 24),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text("GENIE.AI",
                  style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 16)),
              Text(translate("sidebar.tagline", "Smart Public Services"),
                  style: const TextStyle(color: Colors.white70, fontSize: 10)),
            ],
          ),
        ],
      ),
    );
  }

  /// Positioned fixed weather placeholder
  Widget _buildWeatherContainer(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF222222) : Colors.white,
        border: Border(
            top: BorderSide(color: isDark ? Colors.white10 : Colors.black12)),
      ),
      child: Row(
        children: [
          Icon(Icons.wb_sunny_outlined,
              size: 22, color: isDark ? Colors.white38 : Colors.black38),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text("24°C - Mostly Sunny",
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: isDark ? Colors.white70 : Colors.black87)),
                Text(translate("sidebar.weatherLocation", "Current Location"),
                    style: const TextStyle(fontSize: 10, color: Colors.grey)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
