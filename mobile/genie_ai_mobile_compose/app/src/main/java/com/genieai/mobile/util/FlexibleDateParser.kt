package com.genieai.mobile.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object FlexibleDateParser {

    private val formats = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.SSSZ",
        "yyyy-MM-dd'T'HH:mm:ssZ",
        "yyyy-MM-dd HH:mm:ss",
        "yyyy-MM-dd",
        "MM/dd/yyyy",
        "dd/MM/yyyy"
    )

    fun parse(dateString: String?): Date? {
        if (dateString.isNullOrBlank()) return null
        for (format in formats) {
            try {
                val sdf = SimpleDateFormat(format, Locale.US)
                sdf.timeZone = TimeZone.getTimeZone("UTC")
                return sdf.parse(dateString)
            } catch (_: Exception) {
                // Try next format
            }
        }
        return null
    }

    fun formatRelative(dateString: String?): String {
        val date = parse(dateString) ?: return ""
        val now = Date()
        val diffMs = now.time - date.time
        val diffSec = diffMs / 1000
        val diffMin = diffSec / 60
        val diffHour = diffMin / 60
        val diffDay = diffHour / 24

        return when {
            diffDay > 365 -> "${diffDay / 365}y ago"
            diffDay > 30 -> "${diffDay / 30}mo ago"
            diffDay > 0 -> "${diffDay}d ago"
            diffHour > 0 -> "${diffHour}h ago"
            diffMin > 0 -> "${diffMin}m ago"
            else -> "Just now"
        }
    }

    fun formatDate(dateString: String?, pattern: String = "MMM d, yyyy"): String {
        val date = parse(dateString) ?: return ""
        return SimpleDateFormat(pattern, Locale.getDefault()).format(date)
    }
}
