# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Native modules whose Java classes are looked up by name from C++ (JNI). R8 cannot see those lookups,
# so their names must stay intact. React Native's own rules already cover NativeModules, @DoNotStrip
# classes and `native` methods; these are the libraries that ship no consumer rules of their own.
-keep class com.margelo.nitro.** { *; }
-keep class com.op.sqlite.** { *; }
-keep class com.mrousavy.camera.** { *; }
-keep class com.reactnativecompressor.** { *; }
-keep class com.zxcpoiu.incallmanager.** { *; }
-keep class com.reactnativefullscreennotificationincomingcall.** { *; }
-keep class org.webrtc.** { *; }
