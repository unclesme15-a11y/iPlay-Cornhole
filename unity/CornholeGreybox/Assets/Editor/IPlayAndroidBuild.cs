using System.IO;
using System.Text;
using System.Xml;
using UnityEditor.Android;
using UnityEngine;

/// <summary>
/// After Unity writes the Android (Gradle) project, adds what the Android plugin (Assets/Plugins/Android/IPlayNative.java)
/// and invite links need, so the build works with no manual steps:
///   - Google's sign-in libraries (androidx.credentials and googleid) to unityLibrary/build.gradle
///   - invite links: iplaycornhole://join/CODE, and https://your-domain/join/CODE as a verified app link
///     (the server publishes /.well-known/assetlinks.json when ANDROID_PACKAGE and ANDROID_CERT_SHA256 are set)
///   - the microphone permission for voice chat, and the notification permission for push notifications.
/// </summary>
public sealed class IPlayAndroidBuild : IPostGenerateGradleAndroidProject
{
    public const string CredentialsVersion = "1.5.0";
    public const string GoogleIdVersion = "1.1.1";
    private const string AndroidNs = "http://schemas.android.com/apk/res/android";
    private const string Marker = "// iPlay Cornhole: Sign in with Google";

    public int callbackOrder { get { return 100; } }

    public void OnPostGenerateGradleAndroidProject(string path)
    {
        var cfg = IPlayBuildConfig.Load();
        AddDependencies(Path.Combine(path, "build.gradle"));
        var manifest = Path.Combine(path, "src", "main", "AndroidManifest.xml");
        if (File.Exists(manifest)) PatchManifest(manifest, cfg.deepLinkScheme, cfg.LinkHost);
        else Debug.LogWarning("iPlay: AndroidManifest.xml not found at " + manifest + "; invite links will not open the app.");
    }

    public static void AddDependencies(string gradleFile)
    {
        if (!File.Exists(gradleFile)) { Debug.LogWarning("iPlay: " + gradleFile + " not found; Sign in with Google will not build."); return; }
        var text = File.ReadAllText(gradleFile);
        if (text.Contains(Marker)) return;
        text += "\n" + Marker + " (added by Assets/Editor/IPlayAndroidBuild.cs)\ndependencies {\n"
              + "    implementation 'androidx.credentials:credentials:" + CredentialsVersion + "'\n"
              + "    implementation 'androidx.credentials:credentials-play-services-auth:" + CredentialsVersion + "'\n"
              + "    implementation 'com.google.android.libraries.identity.googleid:googleid:" + GoogleIdVersion + "'\n"
              + "}\n";
        File.WriteAllText(gradleFile, text);
    }

    /// <summary>Adds the invite-link intent filters to the launcher activity and the microphone permission. Safe to run twice.</summary>
    public static void PatchManifest(string manifestPath, string scheme, string httpsHost)
    {
        var doc = new XmlDocument();
        doc.Load(manifestPath);
        var ns = new XmlNamespaceManager(doc.NameTable);
        ns.AddNamespace("android", AndroidNs);
        var root = doc.DocumentElement;

        // Voice chat needs the microphone; push notifications need permission to notify (Android 13+).
        foreach (var permission in new[] { "android.permission.RECORD_AUDIO", "android.permission.POST_NOTIFICATIONS" })
        {
            if (root.SelectSingleNode("uses-permission[@android:name='" + permission + "']", ns) != null) continue;
            var perm = doc.CreateElement("uses-permission");
            perm.SetAttribute("name", AndroidNs, permission);
            root.PrependChild(perm);
        }

        var launcher = root.SelectSingleNode("application/activity[intent-filter/action/@android:name='android.intent.action.MAIN']", ns) as XmlElement;
        if (launcher == null)
        {
            Debug.LogWarning("iPlay: no launcher activity in " + manifestPath + "; invite links will not open the app.");
            Save(doc, manifestPath);
            return;
        }

        if (launcher.SelectSingleNode("intent-filter/data[@android:scheme='" + scheme + "']", ns) == null)
            launcher.AppendChild(LinkFilter(doc, false, scheme, null));
        if (httpsHost != null && launcher.SelectSingleNode("intent-filter/data[@android:host='" + httpsHost + "']", ns) == null)
            launcher.AppendChild(LinkFilter(doc, true, "https", httpsHost));

        Save(doc, manifestPath);
    }

    /// <summary>Plain UTF-8 with no byte-order mark (some Android build tools reject one).</summary>
    private static void Save(XmlDocument doc, string path)
    {
        var settings = new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = true };
        using (var w = XmlWriter.Create(path, settings)) doc.Save(w);
    }

    private static XmlElement LinkFilter(XmlDocument doc, bool verified, string scheme, string host)
    {
        var filter = doc.CreateElement("intent-filter");
        if (verified) filter.SetAttribute("autoVerify", AndroidNs, "true");
        filter.AppendChild(Named(doc, "action", "android.intent.action.VIEW"));
        filter.AppendChild(Named(doc, "category", "android.intent.category.DEFAULT"));
        filter.AppendChild(Named(doc, "category", "android.intent.category.BROWSABLE"));
        var data = doc.CreateElement("data");
        data.SetAttribute("scheme", AndroidNs, scheme);
        if (host != null)
        {
            data.SetAttribute("host", AndroidNs, host);
            data.SetAttribute("pathPrefix", AndroidNs, "/join/");
        }
        else data.SetAttribute("host", AndroidNs, "join");
        filter.AppendChild(data);
        return filter;
    }

    private static XmlElement Named(XmlDocument doc, string tag, string name)
    {
        var e = doc.CreateElement(tag);
        e.SetAttribute("name", AndroidNs, name);
        return e;
    }
}
