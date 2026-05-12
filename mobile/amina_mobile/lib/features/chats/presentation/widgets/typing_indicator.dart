import 'package:flutter/material.dart';

class TypingIndicator extends StatelessWidget {
  const TypingIndicator({super.key});

  @override
  Widget build(BuildContext context) {
    return const Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        child: Text(
          "🤖 Amina is thinking...",
          style: TextStyle(color: Colors.grey, fontStyle: FontStyle.italic),
        ),
      ),
    );
  }
}
