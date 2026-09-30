// Runs IPlayAndroidBuild's manifest and Gradle patches on a Unity 6-shaped manifest (twice, to prove they are safe to
// repeat) and checks the result. Used by check-unity-layer.sh.
using System;
using System.IO;
using System.Text.RegularExpressions;
public static class AndroidBuildTest
{
    private static int failures;
    private static void Expect(bool ok, string what) { Console.WriteLine((ok ? "  ok   " : "  FAIL ") + what); if (!ok) failures++; }
    private static int Count(string text, string pattern) { return Regex.Matches(text, pattern).Count; }

    public static int Main(string[] args)
    {
        var dir = Path.Combine(Path.GetTempPath(), "iplay-android-test");
        Directory.CreateDirectory(dir);
        var manifest = Path.Combine(dir, "AndroidManifest.xml");
        var gradle = Path.Combine(dir, "build.gradle");
        File.Copy(args[0], manifest, true);
        File.WriteAllText(gradle, "apply plugin: 'com.android.library'\ndependencies {\n}\n");
        for (var i = 0; i < 2; i++)
        {
            IPlayAndroidBuild.PatchManifest(manifest, "iplaycornhole", "cornhole.example.com");
            IPlayAndroidBuild.AddDependencies(gradle);
        }
        var m = File.ReadAllText(manifest);
        var g = File.ReadAllText(gradle);
        var bytes = File.ReadAllBytes(manifest);
        Expect(bytes[0] == (byte)'<', "manifest has no byte-order mark");
        Expect(Count(m, "android.permission.RECORD_AUDIO") == 1, "microphone permission added once");
        Expect(Count(m, "android:scheme=\"iplaycornhole\" android:host=\"join\"") == 1, "iplaycornhole://join link added once");
        Expect(Count(m, "android:autoVerify=\"true\"") == 1, "verified https app link added once");
        Expect(Count(m, "android:host=\"cornhole.example.com\" android:pathPrefix=\"/join/\"") == 1, "https link matches /join/ on the domain");
        Expect(Count(m, "android.intent.action.MAIN") == 1, "launcher filter untouched");
        Expect(Count(g, "androidx.credentials:credentials:") == 1, "Credential Manager dependency added once");
        Expect(Count(g, "identity.googleid:googleid:") == 1, "googleid dependency added once");
        Console.WriteLine(failures == 0 ? "Android build patches: all checks passed." : failures + " Android build check(s) FAILED.");
        return failures == 0 ? 0 : 1;
    }
}
