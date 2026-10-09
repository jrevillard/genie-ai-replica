# Lean Android build image for the GENIE.AI Flutter app (APK/AAB only).
# Versions match android/app/build.gradle, android/settings.gradle and the
# FLUTTER_VERSION pinned in .gitlab-ci.yml. minSdk 29 (Android 10) is set in
# build.gradle — the image only provides the toolchain.
#
# Build:  docker build -t genie-android-builder:3.41.7 \
#           -f mobile/genie_ai_mobile/docker/android-builder.Dockerfile mobile/genie_ai_mobile/docker
FROM debian:bookworm-slim

ARG FLUTTER_VERSION=3.41.7
ARG CMDLINE_TOOLS_BUILD=13114758
ARG ANDROID_PLATFORM=android-36
ARG BUILD_TOOLS=35.0.0
ARG NDK_VERSION=27.0.12077973
ARG CMAKE_VERSION=3.22.1

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    FLUTTER_HOME=/opt/flutter \
    PUB_CACHE=/root/.pub-cache \
    GRADLE_USER_HOME=/root/.gradle \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    LANG=C.UTF-8
ENV PATH=$FLUTTER_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
       openjdk-17-jdk-headless ca-certificates curl git unzip xz-utils zip \
    && rm -rf /var/lib/apt/lists/*

# Android SDK: only what an APK/AAB build needs (no emulator). Platforms 33-35,
# platform-tools and CMake are pulled in by plugins; without them Gradle
# downloads them again on every build (the container is thrown away).
RUN mkdir -p $ANDROID_HOME/cmdline-tools \
    && curl -fsSL -o /tmp/cmdline-tools.zip \
       "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_BUILD}_latest.zip" \
    && unzip -q /tmp/cmdline-tools.zip -d $ANDROID_HOME/cmdline-tools \
    && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
    && rm /tmp/cmdline-tools.zip \
    && yes | sdkmanager --licenses > /dev/null \
    && sdkmanager --install \
       "platforms;${ANDROID_PLATFORM}" \
       "platforms;android-35" "platforms;android-34" "platforms;android-33" \
       "platform-tools" \
       "build-tools;${BUILD_TOOLS}" \
       "ndk;${NDK_VERSION}" \
       "cmake;${CMAKE_VERSION}" > /dev/null

# Flutter SDK, Android artifacts only.
RUN curl -fsSL \
       "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz" \
       | tar -xJ -C /opt \
    && git config --global --add safe.directory $FLUTTER_HOME \
    && flutter config --no-analytics --no-cli-animations \
       --no-enable-web --no-enable-linux-desktop \
    && dart --disable-analytics \
    && flutter precache --android --no-ios --no-web --no-linux --no-macos --no-windows --no-fuchsia \
    && flutter --version

WORKDIR /workspace
