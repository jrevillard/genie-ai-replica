# R8/ProGuard rules for the el-salvador release APK.

# Tink (flutter_secure_storage) references classes from optional dependencies
# (errorprone annotations, javax.annotation) that are not on the Android
# runtime classpath. They are compile-time-only — silence R8 warnings so
# the build can proceed without bundling the annotations as code.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn javax.annotation.concurrent.**

# Flutter engine + plugin entry points (the Flutter template's rules). Required
# once R8 minification is ENABLED: the engine calls into these classes
# reflectively from native code, so R8 must not rename or strip them.
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
