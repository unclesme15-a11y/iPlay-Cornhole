using System;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Puts the project's Player Settings in the state the game needs, so nobody has to click through them:
/// landscape only, IL2CPP, 64-bit Android, the app id, the microphone text, the invite-link scheme and the minimum
/// phone versions. It runs once by itself the first time the project is opened (it leaves a mark in
/// ProjectSettings/IPlaySetup.done), and again whenever you choose iPlay > Apply project settings.
/// The values come from Assets/Resources/iplay-cornhole-server.json ("bundleId", "deepLinkScheme").
/// </summary>
[InitializeOnLoad]
public static class IPlayProjectSetup
{
    private const string DoneMark = "ProjectSettings/IPlaySetup.done";
    public const string MicrophoneText = "iPlay Cornhole uses the microphone so you can talk to the other players at the table.";

    static IPlayProjectSetup()
    {
        EditorApplication.delayCall += () =>
        {
            if (File.Exists(DoneMark)) return;
            Apply();
            File.WriteAllText(DoneMark, "Applied " + DateTime.UtcNow.ToString("u") + ". Delete this file (or use iPlay > Apply project settings) to apply again.\n");
        };
    }

    [MenuItem("iPlay/Apply project settings")]
    public static void Apply()
    {
        var cfg = IPlayBuildConfig.Load();

        PlayerSettings.companyName = "iPlay";
        PlayerSettings.productName = "iPlay Cornhole";
        PlayerSettings.SetApplicationIdentifier(BuildTargetGroup.iOS, cfg.bundleId);
        PlayerSettings.SetApplicationIdentifier(BuildTargetGroup.Android, cfg.bundleId);
        if (string.IsNullOrEmpty(PlayerSettings.bundleVersion) || PlayerSettings.bundleVersion == "0.1")
            PlayerSettings.bundleVersion = "1.0.0"; // the server compares versions as 1.2.3

        // Landscape only, either way up (decided: docs/unity-client.md, "Screen shape").
        PlayerSettings.defaultInterfaceOrientation = UIOrientation.AutoRotation;
        PlayerSettings.allowedAutorotateToPortrait = false;
        PlayerSettings.allowedAutorotateToPortraitUpsideDown = false;
        PlayerSettings.allowedAutorotateToLandscapeLeft = true;
        PlayerSettings.allowedAutorotateToLandscapeRight = true;

        // Android: IL2CPP and 64-bit only (Google Play requires 64-bit); Android 7.0+ (the Keystore and Credential Manager).
        PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
        PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24;
        PlayerSettings.Android.forceInternetPermission = true;

        // iOS: 15.0+, the microphone text Apple shows before voice chat, the invite-link scheme.
        PlayerSettings.iOS.targetOSVersionString = "15.0";
        PlayerSettings.iOS.microphoneUsageDescription = MicrophoneText;
        PlayerSettings.iOS.iOSUrlSchemes = new[] { cfg.deepLinkScheme };

        AssetDatabase.SaveAssets();
        Debug.Log("iPlay: project settings applied (app id " + cfg.bundleId + ", landscape, IL2CPP, invite scheme " + cfg.deepLinkScheme + "://).");
    }
}

/// <summary>The few values the build scripts need, read from Resources/iplay-cornhole-server.json.</summary>
[Serializable]
public sealed class IPlayBuildConfig
{
    public string baseUrl = "";
    public string bundleId = "com.iplay.cornhole";
    public string deepLinkScheme = "iplaycornhole";

    public const string Path = "Assets/Resources/iplay-cornhole-server.json";

    public static IPlayBuildConfig Load()
    {
        var cfg = new IPlayBuildConfig();
        if (File.Exists(Path)) JsonUtility.FromJsonOverwrite(File.ReadAllText(Path), cfg);
        if (string.IsNullOrEmpty(cfg.bundleId)) cfg.bundleId = "com.iplay.cornhole";
        if (string.IsNullOrEmpty(cfg.deepLinkScheme)) cfg.deepLinkScheme = "iplaycornhole";
        return cfg;
    }

    /// <summary>The host invite links use (https only; universal links and app links need https).</summary>
    public string LinkHost
    {
        get
        {
            Uri u;
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out u) || u.Scheme != "https") return null;
            return u.Host;
        }
    }
}
