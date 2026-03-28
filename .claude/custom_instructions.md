# GENIE.AI - Custom Instructions for Claude Code

**Last Updated:** 2026-03-22
**Project:** GENIE.AI
**Framework:** Vue 3 (Web) / Flutter 3.5.1+ (Mobile) / Node.js & Python (Backend)


---

## 1. CORE PRINCIPLES - READ FIRST BEFORE ANY CHANGES

### 🚨 CRITICAL RULES - NEVER VIOLATE

0. **ONE UNIQUE STATE OBJECT PER ENTITY (IMMUTABLE ARCHITECTURAL PRINCIPLE)**
   - **CRITICAL FOR SYSTEM PERFORMANCE & REACTIVITY**
   - **EXACTLY ONE** unique state object exists for each core entity (e.g., chat history, query context, user data) on the frontend.
   - Data is stored in a **shared repository** (Pinia stores for Vue 3, shared Providers/Repositories for Flutter).
   - Multiple views (sidebar, main chat, header) **reference** the same entity object.
   - NO duplication of data across different components or views.

   **Why This Matters:**
   - Memory efficiency: Same context in 3 views = stored once, not 3 times.
   - Consistency: Update once, all UI elements reflect the change automatically.
   - Performance: Cache hit means instant load, no redundant API calls.

   **When Investigating State/UI Issues:**
   1. **ALWAYS** check for duplicate IDs in backend responses FIRST.
   2. **NEVER** assume the backend is sending unique objects - VERIFY.
   3. **ALWAYS** measure response size before optimizing the frontend.
   4. **NEVER** add more caching/storage variables without checking the shared store.
   5. **ALWAYS** investigate payload size before implementing UI workarounds.

   **Common Violations:**
   - Backend sending duplicate entity IDs in the same response.
   - Backend sending full context objects repeatedly instead of references.
   - Vue 3: Breaking Pinia reactivity by improperly destructuring state.
   - Flutter: Creating local `setState` copies of data that should be in a global Provider.

   **Investigation Checklist:**
   - [ ] Capture actual API response (save to file for analysis).
   - [ ] Check for duplicate IDs in the response.
   - [ ] Measure response size (should be < 1 MB for standard chat loads).
   - [ ] Count unique vs total objects (should be equal).
   - [ ] Verify frontend shared repo grew by unique count, not total count.
   - [ ] Document findings with EVIDENCE before suggesting fixes.

   **Consequences of Violation:**
   - Memory bloat, inconsistent UI across platforms, performance degradation.
   - User experience issues: stuck loading states, lost chat context, excessive data usage.

   **ENFORCEMENT:** This rule is IMMUTABLE. Violating it causes systemic architectural breakdown.

1. **APP INITIALIZATION & I18NSERVICE ARCHITECTURAL CONSISTENCY - CRITICAL**
   - **CRITICAL FOR I18N TRANSLATION SYSTEM INTEGRITY**
   - When creating ANY new root component or wrapper (e.g., Vue `createApp` mounts, or Flutter `MaterialApp`), you MUST follow the existing pattern from the main entry point (`main.js` or `main.dart`).
   - **NEVER** create a root view without connecting it to the I18nService.
   - **NEVER** hardcode supported locales - ALWAYS use the dynamic language maps.

   **MANDATORY Configuration Pattern:**
   - **Vue 3:** Ensure `app.use(i18n)` is properly bound to the root instance, and the locale is reactive to the user's settings profile.
   - **Flutter:** ```dart
     // 1. Connect to I18nService's currentLocale
     locale: I18nService().currentLocale,

     // 2. Dynamically pull supportedLocales
     supportedLocales: I18nService().supportedLanguages.keys.map((code) => Locale(code)),

     // 3. Listen to I18nService for rebuilds
     ListenableBuilder(
       listenable: Listenable.merge([settingsController, I18nService()]),
       builder: (context, child) {
         return MaterialApp(
           locale: I18nService().currentLocale,  // CRITICAL
           // ... rest of config
         );
       },
     )
     ```

   **What Happens When You Violate This Rule:**
   - App uses device system locale (e.g., Russian) while the service uses default ('en').
   - Components using `tr()` get translations from the wrong locale source.
   - Result: Screens don't translate to selected language.
   - User frustration: "This module doesn't translate but everything else does!"

   **MANDATORY PRE-CREATION CHECKLIST for App Mounts:**
   - [ ] Have I read the main entry point's initialization configuration?
   - [ ] Have I verified locale is dynamically connected to the global I18nService?
   - [ ] Have I verified the state listener rebuilds the UI on language changes?
   - [ ] Did I grep for other initialization patterns to ensure consistency?
   - [ ] Did I ask the user if there are existing patterns I should follow?

   **FORBIDDEN:**
   - ❌ Creating root instances without checking the main file first.
   - ❌ Hardcoding supported locales as static lists.
   - ❌ Using device locale instead of the user's selected profile locale.
   - ❌ Assuming "this specific module needs different config."

   **REQUIRED:**
   - ✅ ALWAYS read the main setup first.
   - ✅ ALWAYS use the centralized I18nService for the locale parameter.
   - ✅ ALWAYS verify translations work after creating a new view.

   **ENFORCEMENT:** This rule is IMMUTABLE. Violating it causes complete i18n system breakdown for affected screens.

2. **NEVER Break Existing Features**
   - Every feature in this codebase exists for a reason.
   - Before removing/changing ANY code, verify its purpose.
   - If unsure, ASK the user - DO NOT guess.
   - Feature removal requires EXPLICIT user approval.
   - **DO NOT FUCKUP CODE THAT IS ALREADY WORKING** - If a feature works, preserve it.
   - When modifying working code, ensure the functionality remains intact across BOTH Vue 3 and Flutter environments.
   - Test thoroughly after changes to confirm nothing broke.

3. **QUALITY & USER EXPERIENCE > SPEED - MANDATORY PRE-CHECKLIST**
   - 🚨 **CRITICAL: BEFORE ANY CODE CHANGE, COMPLETE THIS CHECKLIST**
   - **NO EXCEPTIONS - NO SHORTCUTS**

   **MANDATORY PRE-CODE ANALYSIS:**
   - [ ] Have I read ALL related files before making changes?
   - [ ] Have I searched for ALL usages of the code I'm modifying?
   - [ ] Have I identified ALL edge cases and failure modes?
   - [ ] Have I considered the USER EXPERIENCE impact of this change?
   - [ ] Have I considered ARCHITECTURAL consistency with existing Vue/Flutter patterns?
   - [ ] Have I asked the user about unclear requirements?

   **QUALITY STANDARDS - YOU MUST MEET THESE:**
   - **User Experience First**: Every change must improve or preserve UX quality.
   - **Architectural Consistency**: Follow existing patterns, don't introduce inconsistencies.
   - **No Quick Wins**: If a "simple fix" compromises quality, it's not a fix.
   - **Complete Analysis**: Partial understanding leads to broken code.
   - **Test Thoroughly**: If you haven't tested it, it doesn't work.

   **FORBIDDEN BEHAVIORS:**
   - ❌ Rushing to complete tasks without full understanding.
   - ❌ Making "simple" changes that have side effects you didn't analyze.
   - ❌ Prioritizing "done quickly" over "done correctly".
   - ❌ Fixing one thing while breaking another.
   - ❌ Making assumptions about requirements.
   - ❌ Implementing before confirming approach with user.

   **REQUIRED WORKFLOW FOR EVERY TASK:**
   1. **READ FIRST** - All related files, all patterns, all context.
   2. **ANALYZE** - All impacts, all edge cases, all users affected.
   3. **PROPOSE** - Explain approach BEFORE coding.
   4. **CONFIRM** - Get user approval before implementing.
   5. **IMPLEMENT** - Code carefully, test thoroughly.
   6. **VERIFY** - Confirm nothing broke, UX improved.

   **ROOT CAUSE ANALYSIS AFTER EVERY MISTAKE:**
   - What did I miss in my analysis?
   - What assumption was wrong?
   - What pattern did I fail to recognize?
   - What question should I have asked?
   - Document in `.claude/custom_instructions.md` to prevent recurrence.

   **DAILY SELF-ASSESSMENT:**
   - "Did I prioritize quality over speed today?"
   - "Did I fully understand the problem before coding?"
   - "Did I confirm my approach with the user?"
   - "Did I break anything while fixing something else?"

   **ACCOUNTABILITY:**
   > "Quick wins that compromise quality are losses, not wins. I am responsible for understanding the full context and delivering quality solutions. Speed without quality is negligence."

4. **NO WORKAROUNDS FOR BACKEND BUGS - FIX THE ROOT CAUSE**
   - **CRITICAL:** If the backend (Node.js/Python) has a bug, the backend MUST be fixed.
   - **NEVER** add frontend workarounds (Vue/Flutter) for backend issues.
   - **NEVER** suggest "quick fixes" that compromise system integrity.
   - **ALWAYS** identify the root cause and demand proper fixes.
   - Workarounds create technical debt and hidden failures.
   - If a backend API response is missing required fields, the backend API is broken and must be fixed.
   - **DO NOT** patch frontend code to handle malformed backend responses.
   - **ALWAYS** write detailed backend fix requests with clear requirements.
   - **VERIFY** that backend fixes meet the specification before closing tickets.

   **Examples of PROHIBITED Workarounds:**
   - ❌ Adding frontend logic to infer missing data from backend responses.
   - ❌ Storing frontend copies of data that should come from backend.
   - ❌ Making multiple API calls to work around missing data.
   - ❌ Hiding features because "backend can't support it properly".
   - ❌ Adding "compatibility layers" for broken backend behavior.

   **REQUIRED BEHAVIOR:**
   - ✅ Identify the exact backend API contract violation.
   - ✅ Document the expected vs actual behavior.
   - ✅ Write detailed fix requests for backend team.
   - ✅ Verify the fix addresses the root cause.
   - ✅ Reject "workable" solutions that aren't correct solutions.

5. **STRATEGIC FIXES ONLY - NO TACTICAL PATCHES**
   - **CRITICAL:** Every fix must be strategic and comprehensive.
   - **NO tactical repairs** that only fix one specific instance.
   - Tactical patches create a "snowflake built on a patchwork quilt".
   - Each tactical fix adds complexity without solving the root problem.

   **MANDATORY STRATEGIC FIX PROCESS:**
   - **When fixing chat states:** Check ALL chat types (standard, streaming, error, loading).
   - **When fixing payload contexts:** Check ALL API outgoing requests.
   - **When fixing UI components:** Search BOTH Vue and Flutter codebases for the similar pattern.
   - **When fixing any feature:** Search codebase for ALL similar patterns.

   **STRATEGIC FIX CHECKLIST:**
   1. **Search for ALL occurrences** of the pattern being fixed.
   2. **Identify the underlying architectural problem**, not just the symptom.
   3. **Design a solution that fixes ALL instances** of the problem.
   4. **Verify no other areas have the same issue.**
   5. **Document the root cause and solution.**

   **FORBIDDEN TACTICAL BEHAVIORS:**
   - ❌ Fixing only Vue when Flutter has the exact same bug.
   - ❌ Fixing only one component when others use the same pattern.
   - ❌ Adding workarounds instead of fixing the root cause.
   - ❌ Assuming "this is the only place with this problem".
   - ❌ Making isolated fixes without checking for similar code.

   **REQUIRED STRATEGIC BEHAVIOR:**
   - ✅ Search codebase for ALL similar patterns before fixing.
   - ✅ Fix the ROOT CAUSE, not just the symptom.
   - ✅ Apply the fix EVERYWHERE the pattern exists.
   - ✅ Verify ALL instances work correctly after the fix.
   - ✅ Document why this was the right strategic solution.

   **ACCOUNTABILITY:**
   > "Tactical fixes are technical debt in disguise. One tactical patch becomes ten, then a hundred, until the codebase is unmaintainable. I am responsible for finding and fixing the root cause strategically, not applying band-aids."

6. **DUAL-PROMPT LOGIC (VISIBLE vs INVISIBLE) - TWO DIFFERENT FEATURES**
   - **Visible Prompt** = The text the user actually sees and interacts with in the UI (e.g., Quickhelp buttons).
   - **Invisible Prompt** = The underlying system instruction sent to the LLM backend.
   - NEVER confuse these two features - they serve completely different purposes.
   - You must NEVER combine these into a single string.
   - The UI state (Vue/Flutter) MUST clearly delineate `display_text` vs `llm_instruction`.

7. **MANDATORY UNIT TESTING BEFORE DELIVERY**
   - **ALL code changes MUST be tested before giving to user.**
   - Vue 3: Run `npm run test` and verify linting.
   - Flutter: Run `flutter test` and verify all tests pass.
   - **Execute tests repetitively until 100% of tests pass before handover.**
   - **Unit test suites must cover 100% of regression for feature tests.**
   - If tests fail, fix the failures BEFORE presenting changes to user.
   - NEVER say "here's the code" without running tests first.
   - If introducing new features, write tests for them.
   - If modifying existing features, ensure existing tests still pass.
   - **NO EXCEPTIONS** - Tests are not optional.
   - **NO CODE HANDOVER UNTIL 100% TEST PASS RATE.**

8. **CONTEXT SYNCHRONIZATION IS SACRED**
   - This is the core of GENIE.AI accuracy.
   - ALL changes to context selection (e.g., Knowledge Areas, specific files) MUST immediately reflect in BOTH the visual UI (Query Context Header) AND the state payload sent to the API.
   - Desynchronization between the visual context (what the user sees is selected) and the payload context (what the LLM actually receives) is a catastrophic failure.

9. **MANDATORY COMPREHENSIVE I18N AUDIT - NEVER SKIP**
   - **CRITICAL:** When user reports "screens not translating" or missing translations.
   - **NEVER** assume only certain keys are missing - ALWAYS AUDIT EVERYTHING.

   **MANDATORY AUDIT PROCESS:**
   1. **IDENTIFY ALL SCREENS** in the affected folder/module.
   2. **EXTRACT ALL TRANSLATION KEYS** used by ALL screens in that module.
   3. **CHECK ALL LOCALE FILES** for ALL extracted keys.
   4. **CREATE COMPREHENSIVE MATRIX** showing which keys exist in which files.
   5. **IDENTIFY ALL MISSING SECTIONS** - not just individual keys.

   **ABSOLUTELY FORBIDDEN:**
   - ❌ Checking only the screens user mentioned.
   - ❌ Assuming files with some translations are "complete".
   - ❌ Creating prompts/scripts without completing the audit first.
   - ❌ Adding only individual keys instead of complete sections.

   **REQUIRED BEHAVIOR:**
   - ✅ Extract ALL translation keys from ALL screens in the module.
   - ✅ Check ALL locale files for ALL those keys.
   - ✅ Identify which complete SECTIONS are missing.
   - ✅ Report exact count of missing keys per file.
   - ✅ Add COMPLETE sections to missing files (preserving existing translations).

   **ENFORCEMENT:**
   > "Partial investigation leads to massive oversights. I MUST audit comprehensively or not at all. Missing translation keys across files is a catastrophic failure that wastes hours of time and frustrates the user. Comprehensive audits are MANDATORY, not optional."

10. **PRESERVE EXISTING TRANSLATIONS - NEVER OVERWRITE**
   - When adding missing sections to locale files:
   - **ALWAYS** check if translation already exists for that language.
   - **PRESERVE** existing translations (even if partial).
   - **ADD** only what's missing from en.json / en.dart.
   - **NEVER** overwrite existing translated content with English.

   **CHECKLIST BEFORE ADDING SECTIONS:**
   - [ ] Read the target locale file completely.
   - [ ] Identify which sections already exist.
   - [ ] Extract sections from English source that are missing.
   - [ ] Insert missing sections, preserving existing ones.
   - [ ] Verify JSON/Dart structure remains valid.
   - [ ] Test in app to confirm translations work.

**CORE AUDIT PRINCIPLE:**
> "When fixing translation issues, I will audit comprehensively or not at all. Partial audits that miss thousands of keys are worse than no audit at all. The user's time is valuable, and my job is to solve the COMPLETE problem, not create more work."
11. **Test Before Committing - CRITICAL WORKFLOW**
   - 🚨 **NEVER commit code before the user tests it**
   - **Flutter (Mobile):** User does FULL `flutter run` (NOT hot reload/restart) for testing. User records logs with `adb logcat` during testing.
   - **Vue 3 (Web):** User does a full browser refresh (clearing cache) to test Web.
   - Await EXPLICIT user approval before ANY git commit.
   - Run `flutter analyze` (Mobile) and `npm run lint` (Web) before any commit.
   - Check for overflow on small screens (< 360px width for Flutter, reduced browser width for Vue).
   - Verify Vue/Flutter state synchronization flows still work.

   **COMMIT RULES:**
   - ❌ DO NOT commit immediately after making code changes.
   - ❌ DO NOT assume the user will do a hot restart or rely on HMR (Hot Module Replacement).
   - ✅ DO present changes for user review.
   - ✅ DO wait for the user to test and approve.
   - ✅ DO commit only after the user says "commit" or "ok commit".

12. **Consolidation != Removal**
   - When refactoring (whether Pinia stores, Vue components, or Flutter widgets), consolidate DUPLICATE code.
   - NEVER remove unique functionality.
   - If behavior differs between two implementations, there's a reason.
   - ASK before consolidating non-identical code.

13. **Responsive Design is Mandatory**
   - **Flutter (Mobile):** Small screens: < 360px width (Infinix, etc.). 
     - Use `isSmallScreen = screenWidth < 360` pattern.
     - Test with `Wrap` widgets instead of `Row` for action bars.
     - Hide text labels on small screens, keep icons.
     - Reduce icon sizes: `isSmallScreen ? 18.0 : 20.0`.
   - **Vue 3 (Web):** Use Tailwind/CSS Grid for fluid layouts. Sidebars must cleanly collapse on mobile viewports.

14. **ASK QUESTIONS EARLY - PREVENT REWORK**
   - 🚨 **NEVER make assumptions about UX requirements**
   - If the user says "add a toggle", ask:
     1. "What should this toggle control?"
     2. "Should it have a text label or just an icon?"
     3. "Where should it appear? (sidebar, chat header, both?)"
     4. "Who should see it? (everyone, admins only, system only?)"
     5. "Should non-privileged users see it disabled or hidden?"
   - **Before implementing controls, confirm**:
     - Visual design (icon only? icon + text? icon + text + state?)
     - Placement (which screen(s)?)
     - Permissions (who can use it?)
     - Behavior for non-privileged users (disabled or hidden?)
   - **Cost of getting it wrong**: Rework, frustration, lost time.
   - **Cost of asking**: 30 seconds of clarification.
   - **Always over-communicate on UX requirements.**

---

## 15. UX BEST PRACTICES - CRITICAL

### 15.1 Toggle Controls Pattern
When implementing toggle switches (Switch widget in Flutter, toggles in Vue), ALWAYS provide:

1. **Header Label** - Small text above the toggle describing what it controls.
   - Example: "LLM Context", "Developer Mode", "Streaming"
   - Style: Small font, secondary text color (e.g., `text-gray-500` in Vue, `Colors.grey[600]` in Flutter).
   - Placement: Inside a Column/div above the toggle.

2. **State Label** - Text next to the toggle showing current state.
   - Format: Use descriptive state names, not just "On/Off".
   - Examples: "Enabled"/"Disabled", "Global"/"Local".
   - Style: Semi-bold text.
   - **Color-code the state:**
     - Positive/Active states: Primary Theme Color or Green.
     - Negative/Inactive states: Grey or Orange.

3. **Proper Structure:**
   - Must be properly padded so the touch target is at least 48x48 on mobile.

### 15.2 Progressive Disclosure for Role-Based Features
- **Admin controls**: Show to admins, hide from regular users.
- **Disabled vs Hidden**:
  - If a user CAN see the feature but can't use it → DISABLE it (show but grayed out).
  - If a user should NEVER see the feature → HIDE it completely.
  - **Default to DISABLED for role-based features** - this teaches users about features they could unlock.

### 15.3 Consistent UI Patterns Across Locations
When the same control appears in multiple places:
1. **Use identical visual design** - same labels, colors, sizing.
2. **Maintain same behavior** - same click handlers, same confirmation dialogs.
3. **Sync state** - changes in one location MUST reflect in others via Pinia (Vue) or Providers (Flutter).

### 15.4 Parent-Child Feature Access Principle - CRITICAL
**Users ALWAYS NEED convenient access to features from both parent and child levels.**

**Examples in GENIE.AI:**
- **Parent**: Knowledge Area Sidebar → **Child**: Specific Document/Query View.
  - Both locations might need: Context inclusion toggles.
  - User should NOT have to navigate to the child to access common controls.
  - Parent controls = quick access, Child controls = detailed management.

**Key Principles:**
- ✅ Common controls in BOTH parent and child.
- ✅ Parent = quick/convenient access.
- ✅ Child = detailed/advanced options.
- ❌ DON'T force navigation to child for common tasks.
- ❌ DON'T duplicate different controls for same feature (sync state instead).

---

## 16. API FIELD NAME CONSISTENCY - CRITICAL LESSONS

### 🚨 LESSON: Frontend-Backend Field Name Mismatches Cause Silent Failures

**What Went Wrong (Historical Post-Mortem):**
Users reported that UI elements weren't displaying. Investigation revealed:
1. **Different field names for different data types:**
   - One API endpoint sends: `reactionBreakdown`
   - Another API sends: `reactionCounts`
   - Frontend code expected these different names, but backend wasn't consistently sending them.
2. **Empty data objects:**
   - Backend was sending `{}` (empty map) instead of expected nulls or populated fields.

**The Fix Pattern - Add Verification Logging (Cross-Platform):**

```dart
// FLUTTER: ALWAYS add verification logging when consuming API data
final payloadData = response['data'] as Map<String, dynamic>?;
debugPrint('[GENIE API VERIFY] Available fields: ${response.keys.toList()}');
debugPrint('[GENIE API VERIFY] Payload: $payloadData');

if (payloadData == null || payloadData.isEmpty) {
  debugPrint('[GENIE API VERIFY] ❌ UI elements NOT displayed: payload is empty');
  return const SizedBox.shrink();
}
// VUE 3: ALWAYS add verification logging
const payloadData = response.data;
console.log('[GENIE API VERIFY] Available fields:', Object.keys(response));
console.log('[GENIE API VERIFY] Payload:', payloadData);

if (!payloadData || Object.keys(payloadData).length === 0) {
  console.warn('[GENIE API VERIFY] ❌ UI elements NOT displayed: payload is empty');
  return;
}
```
### Critical Rules for API Integration:
ALWAYS Add Verification Logging: Use descriptive prefixes like [GENIE API VERIFY] for easy searching.

Handle Field Name Variations: Document expected field names in code comments. Add defensive normalization for deprecated aliases.

Test With Real Data: Dont assume the API contract matches documentation. Test edge cases: empty data, null values, missing fields.

## 17. STATE MANAGEMENT & ERROR RECOVERY - CRITICAL LESSONS
🚨 LESSON: State Lock Bugs Cause Permanent UI Failure
What Went Wrong:
When network connections drop (ClientException or Axios timeouts), the UI becomes permanently stuck in a loading state and never recovers, even when the network returns.

Root Cause Pattern:
Relying on specific success/catch conditions to reset loading state, while missing edge cases where the code silently fails.

If polling fails, isLoading stays true forever.

User sees permanent loading spinner.

Only fix is app restart + hard refresh.

The Fix Pattern - Always Use finally Blocks:

```dart
// FLUTTER EXAMPLE: Always reset state in finally block
setState(() {
  _isLoading = true;
  _errorMessage = null;
});

try {
  await fetchGenieData();
} catch (e) {
  debugPrint("Error: $e");
  if (mounted && _data.isEmpty) {
    setState(() => _errorMessage = e.toString());
  }
} finally {
  // ✅ ALWAYS RESET LOADING STATE
  if (mounted) {
    setState(() => _isLoading = false);
  }
}
```

``` JavaScript
// VUE 3 EXAMPLE: Always reset state in finally block
isLoading.value = true;
errorMessage.value = null;

try {
  await fetchGenieData();
} catch (error) {
  console.error(error);
  if (!data.value.length) {
    errorMessage.value = error.message;
```
