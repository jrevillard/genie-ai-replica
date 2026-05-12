import 'package:flutter/material.dart';

class InsightCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final Color backgroundColor;
  final Color iconColor;
  final bool isFeatured;
  final VoidCallback onTap;

  const InsightCard({
    super.key,
    required this.title,
    required this.icon,
    required this.backgroundColor,
    required this.iconColor,
    required this.onTap,
    this.isFeatured = false,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 150,
        margin: const EdgeInsets.only(right: 15),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: backgroundColor,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: isFeatured
                ? iconColor.withOpacity(0.5)
                : iconColor.withOpacity(0.1),
            width: isFeatured ? 2 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: iconColor.withOpacity(0.05),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: isFeatured
              ? CrossAxisAlignment.start
              : CrossAxisAlignment.center,
          children: [
            Icon(icon, color: iconColor, size: 32),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: isFeatured ? TextAlign.left : TextAlign.center,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                fontWeight:
                    isFeatured ? FontWeight.bold : FontWeight.w600,
                color: iconColor,
                height: 1.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
