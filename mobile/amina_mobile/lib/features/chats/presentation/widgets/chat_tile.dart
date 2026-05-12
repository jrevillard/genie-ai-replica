import 'package:flutter/material.dart';

class ChatTile extends StatelessWidget {
  final Map<String, dynamic> chat;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  const ChatTile({
    super.key,
    required this.chat,
    required this.onTap,
    required this.onDelete,
  });

  Future<bool?> _confirmDelete(BuildContext context) {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
        title: const Text(
          "⚠️ Are you sure?",
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        content: const Text(
          "If you delete this chat, you will lose all the health information shared here. This cannot be undone.",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text("Cancel", style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20)),
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child:
                const Text("Delete", style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dismissible(
      key: Key(chat['id'].toString()),
      direction: DismissDirection.endToStart,
      confirmDismiss: (_) => _confirmDelete(context),
      onDismissed: (_) => onDelete(),
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 25),
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: Colors.redAccent,
          borderRadius: BorderRadius.circular(20),
        ),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.delete_forever, color: Colors.white, size: 30),
            Text(
              "Delete",
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
      child: InkWell(
        onTap: onTap,
        child: Container(
          margin: const EdgeInsets.only(bottom: 12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.grey[200]!),
          ),
          child: ListTile(
            contentPadding: const EdgeInsets.all(15),
            leading: Container(
              width: 50,
              height: 50,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.blue[100]!, Colors.purple[50]!],
                ),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.person, color: Colors.blue),
            ),
            title: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  chat['title'],
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                Text(
                  chat['time'],
                  style: const TextStyle(fontSize: 12, color: Colors.grey),
                ),
              ],
            ),
            subtitle: Padding(
              padding: const EdgeInsets.only(top: 5),
              child: Text(
                chat['lastMessage'],
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            trailing: chat['unread']
                ? const Icon(Icons.circle, size: 12, color: Colors.redAccent)
                : const SizedBox.shrink(),
          ),
        ),
      ),
    );
  }
}
