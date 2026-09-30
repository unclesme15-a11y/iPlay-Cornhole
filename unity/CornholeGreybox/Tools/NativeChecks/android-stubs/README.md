Compile-only stand-ins for the parts of androidx.credentials, Google's googleid library and Unity's UnityPlayer that
`Assets/Plugins/Android/IPlayNative.java` uses. Google's Maven host could not be reached where this was written; the
real libraries are added to the actual build by `Assets/Editor/IPlayAndroidBuild.cs`. The Android framework itself is
NOT stubbed: the check compiles against the real Android 14 framework jar (Robolectric's android-all, Maven Central).
