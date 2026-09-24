# R8/ProGuard rules for the mobile app.
#
# flutter_secure_storage's bundled Tink library references
# com.google.errorprone.annotations.* and javax.annotation.* classes
# that are compile-time-only. They are not on the Android runtime
# classpath, so R8 errors on the missing classes during release builds.
# Silencing the warnings lets R8 complete the minification step.
#
# Verified 2026-09 against the v3.0 deps via `flutter build apk --release`
# on a fresh checkout (see CHANGELOG / mobile-backport-plan §3 MR-D).

-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn javax.annotation.concurrent.**
