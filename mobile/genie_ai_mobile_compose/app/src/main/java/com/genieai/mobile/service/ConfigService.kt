package com.genieai.mobile.service

import android.content.Context
import android.util.Log
import androidx.compose.ui.graphics.Color
import com.genieai.mobile.GenieAIApplication
import com.genieai.mobile.data.model.QuickHelpButton
import com.google.gson.Gson
import com.google.gson.JsonObject

object ConfigService {

    private const val TAG = "ConfigService"
    private var config: JsonObject? = null
    private val gson = Gson()

    val appTitle: String
        get() = config?.getAsJsonObject("app")?.get("title")?.asString ?: "Genie AI"

    val primaryColor: String
        get() = config?.getAsJsonObject("theme")?.get("primaryColor")?.asString ?: "#4682B4"

    val secondaryColor: String
        get() = config?.getAsJsonObject("theme")?.get("secondaryColor")?.asString ?: "#5F9EA0"

    val backgroundColor: String
        get() = config?.getAsJsonObject("theme")?.get("backgroundColor")?.asString ?: "#D3E0EA"

    val textColor: String
        get() = config?.getAsJsonObject("theme")?.get("textColor")?.asString ?: "#1C2526"

    val navbarGradientStart: String
        get() = config?.getAsJsonObject("theme")?.getAsJsonObject("navbar")
            ?.get("gradientStart")?.asString ?: "#4682B4"

    val navbarGradientEnd: String
        get() = config?.getAsJsonObject("theme")?.getAsJsonObject("navbar")
            ?.get("gradientEnd")?.asString ?: "#5F9EA0"

    val navbarTextColor: String
        get() = config?.getAsJsonObject("theme")?.getAsJsonObject("navbar")
            ?.get("textColor")?.asString ?: "#F0F8FF"

    val welcomeMessage: String
        get() = config?.getAsJsonObject("features")?.getAsJsonObject("chat")
            ?.get("welcomeMessage")?.asString ?: "Welcome to Genie AI"

    val botName: String
        get() = config?.getAsJsonObject("features")?.getAsJsonObject("chat")
            ?.get("botName")?.asString ?: "Genie AI"

    fun init(context: Context = GenieAIApplication.instance) {
        try {
            val inputStream = context.resources.openRawResource(
                context.resources.getIdentifier("genie_ai_config", "raw", context.packageName)
            )
            val jsonString = inputStream.bufferedReader().use { it.readText() }
            config = gson.fromJson(jsonString, JsonObject::class.java)
            Log.d(TAG, "Config loaded: ${config?.get("app")}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load config: ${e.message}", e)
        }
    }

    fun getQuickHelpButtons(): List<QuickHelpButton> {
        val buttons = mutableListOf<QuickHelpButton>()
        val quickHelp = config?.getAsJsonObject("features")
            ?.getAsJsonObject("chat")
            ?.getAsJsonObject("quickHelp") ?: return buttons

        val buttonsArray = quickHelp.getAsJsonArray("buttons") ?: return buttons

        for (element in buttonsArray) {
            val btn = element.asJsonObject
            val appearance = btn.getAsJsonObject("appearance") ?: continue
            val action = btn.getAsJsonObject("action") ?: continue
            val style = appearance.getAsJsonObject("style")
            val darkMode = appearance.getAsJsonObject("darkMode")
            val gradient = style?.getAsJsonObject("background")?.getAsJsonObject("gradient")
            val darkStyle = darkMode?.getAsJsonObject("style")
            val darkGradient = darkStyle?.getAsJsonObject("background")?.getAsJsonObject("gradient")

            val rawLabel = appearance.getAsJsonObject("label")?.get("text")?.asString ?: ""
            val rawVisible = action.get("visibleText")?.asString ?: ""
            val rawHidden = action.get("hiddenPrompt")?.asString ?: ""

            buttons.add(
                QuickHelpButton(
                    id = btn.get("id")?.asString ?: "",
                    category = btn.get("category")?.let { if (it.isJsonNull) null else it.asString },
                    labelText = resolveI18nKey(rawLabel),
                    labelColor = parseColor(appearance.getAsJsonObject("label")?.get("color")?.asString),
                    iconPath = appearance.getAsJsonObject("icon")?.get("value")?.asString ?: "",
                    iconColor = parseColor(appearance.getAsJsonObject("icon")?.get("color")?.asString),
                    gradientStart = parseColor(gradient?.get("start")?.asString),
                    gradientEnd = parseColor(gradient?.get("end")?.asString),
                    darkLabelColor = parseColor(darkMode?.getAsJsonObject("label")?.get("color")?.asString),
                    darkIconColor = parseColor(darkMode?.getAsJsonObject("icon")?.get("color")?.asString),
                    darkGradientStart = parseColor(darkGradient?.get("start")?.asString),
                    darkGradientEnd = parseColor(darkGradient?.get("end")?.asString),
                    visibleText = resolveI18nKey(rawVisible),
                    hiddenPrompt = resolveI18nKey(rawHidden)
                )
            )
        }
        return buttons
    }

    fun getQuickHelpColumns(): Int {
        return config?.getAsJsonObject("features")
            ?.getAsJsonObject("chat")
            ?.getAsJsonObject("quickHelp")
            ?.getAsJsonObject("layout")
            ?.get("columns")?.asInt ?: 2
    }

    /**
     * Resolve an i18n key (e.g. "quickhelp.justChat") to its localized string.
     * Converts dotted keys to Android resource names (quickhelp.justChat → quickhelp_just_chat),
     * then looks up via resources. Falls back to the raw key if not found.
     */
    fun resolveI18nKey(key: String): String {
        if (key.isBlank()) return key
        val context = GenieAIApplication.instance
        // Convert dotted camelCase key to snake_case resource name
        // e.g. "quickhelp.justChat" → "quickhelp_just_chat"
        // e.g. "quickhelp.applyForIDUserPrompt" → "quickhelp_apply_for_id_user_prompt"
        val resourceName = key
            .replace(".", "_")
            .replace(Regex("([a-z])([A-Z])")) { "${it.groupValues[1]}_${it.groupValues[2]}" }
            .lowercase()
        val resId = context.resources.getIdentifier(resourceName, "string", context.packageName)
        return if (resId != 0) context.getString(resId) else key
    }

    private fun parseColor(hex: String?): Color {
        if (hex == null) return Color.Unspecified
        return try {
            Color(android.graphics.Color.parseColor(hex))
        } catch (_: Exception) {
            Color.Unspecified
        }
    }
}
