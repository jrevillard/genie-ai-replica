# R8/ProGuard rules for the el-salvador release APK.

# Tink (flutter_secure_storage) references classes from optional dependencies
# (errorprone annotations, javax.annotation) that are not on the Android
# runtime classpath. They are compile-time-only — silence R8 warnings so
# the build can proceed without bundling the annotations as code.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn javax.annotation.concurrent.**
