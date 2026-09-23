# R8 / ProGuard rules for release builds.
#
# The Flutter Gradle plugin enables R8 ("minify") for release builds. R8 then
# fails with "Missing classes detected" on annotation types that Tink — pulled
# in transitively by flutter_secure_storage — references at compile time only.
# These annotations have CLASS/SOURCE retention and are absent at runtime, so
# the correct fix is to silence the warnings rather than to bundle the jars.
#
# These six lines are exactly what R8 itself emits to
#   build/app/outputs/mapping/<flavor>Release/missing_rules.txt
# whenever the release build stops on them. Re-read that file if a future
# dependency bump introduces new ones.

-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi
-dontwarn javax.annotation.Nullable
-dontwarn javax.annotation.concurrent.GuardedBy
