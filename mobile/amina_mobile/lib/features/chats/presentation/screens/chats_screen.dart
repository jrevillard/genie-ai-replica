import 'package:flutter/material.dart';
import 'chat_conversation.dart';
import '../widgets/chat_tile.dart';

class ChatsScreen extends StatefulWidget {
  const ChatsScreen({super.key});

  @override
  State<ChatsScreen> createState() => _ChatsScreenState();
}

class _ChatsScreenState extends State<ChatsScreen> {
  List<Map<String, dynamic>> _chatItems = [
    {
      "id": 1,
      "title": "Health Check-in",
      "lastMessage": "How are you feeling today?",
      "time": "2h ago",
      "unread": true,
    },
    {
      "id": 2,
      "title": "Medication Reminder",
      "lastMessage": "Time to take your meds",
      "time": "5h ago",
      "unread": false,
    },
    {
      "id": 3,
      "title": "Weekly Summary",
      "lastMessage": "Your health stats look great!",
      "time": "1d ago",
      "unread": false,
    },
  ];

  void _openChat(String title) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => ChatConversation(title: title),
      ),
    );
  }

  void _deleteChat(int id) {
    setState(() => _chatItems.removeWhere((chat) => chat['id'] == id));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text("Chat deleted"),
        duration: Duration(seconds: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FA),
      appBar: AppBar(
        backgroundColor:        Colors.white,
        elevation:              0,
        scrolledUnderElevation: 0,
        surfaceTintColor:       Colors.transparent,
        centerTitle:            true,
        title: const Text(
          'My Chats',
          style: TextStyle(
            color:         Color(0xFF111827),
            fontWeight:    FontWeight.w700,
            fontSize:      17,
            letterSpacing: -0.3,
          ),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(0.8),
          child: Container(height: 0.8, color: Color(0xFFE5E7EB)),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: Column(
          children: [
            const SizedBox(height: 20),

            // 🔍 Search bar
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(30),
                border: Border.all(color: Colors.grey[200]!),
              ),
              child: const TextField(
                textAlignVertical: TextAlignVertical.center,
                decoration: InputDecoration(
                  hintText: "Search your chat",
                  border: InputBorder.none,
                  suffixIcon: Icon(Icons.search, color: Colors.redAccent),
                ),
              ),
            ),

            const SizedBox(height: 15),

            // ➕ New chat button
            InkWell(
              onTap: () => _openChat("New AI Chat"),
              child: Container(
                padding: const EdgeInsets.all(15),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: Colors.grey[100]!),
                ),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 25,
                      backgroundColor: Colors.red[50],
                      child:
                          const Icon(Icons.mic, color: Colors.redAccent, size: 28),
                    ),
                    const SizedBox(width: 15),
                    const Text(
                      "New chat",
                      style:
                          TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 20),

            // 💬 Chat list — each item handles its own dismiss/delete UI
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _chatItems.length,
              itemBuilder: (context, index) {
                final chat = _chatItems[index];
                return ChatTile(
                  chat: chat,
                  onTap: () => _openChat(chat['title']),
                  onDelete: () => _deleteChat(chat['id']),
                );
              },
            ),

            const SizedBox(height: 20),
            _buildDoctorCard(),
            const SizedBox(height: 100),
          ],
        ),
      ),
    );
  }

  Widget _buildDoctorCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient:
            LinearGradient(colors: [Colors.blue[50]!, Colors.purple[50]!]),
        borderRadius: BorderRadius.circular(30),
        border: Border.all(color: Colors.blue[100]!),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 35,
            backgroundColor: Colors.red[50],
            child: const Icon(
              Icons.medical_services_outlined,
              color: Colors.redAccent,
              size: 35,
            ),
          ),
          const SizedBox(width: 15),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  "Doctor",
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.blue,
                  ),
                ),
                const SizedBox(height: 5),
                const Text(
                  "If you have doubts, you can contact your doctor. Book the next appointment!",
                  style: TextStyle(fontSize: 14),
                ),
                const SizedBox(height: 15),
                ElevatedButton.icon(
                  onPressed: () {},
                  icon: const Icon(Icons.calendar_today, size: 16),
                  label: const Text("Book Appointment"),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.blue,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(20)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
