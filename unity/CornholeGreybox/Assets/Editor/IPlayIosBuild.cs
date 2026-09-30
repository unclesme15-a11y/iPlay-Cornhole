#if UNITY_IOS
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.Callbacks;
using UnityEditor.iOS.Xcode;
using UnityEngine;

/// <summary>
/// After Unity writes the Xcode project: adds what the iPhone plugin (Assets/Plugins/iOS/IPlayNative.mm) needs, so the
/// Xcode project is ready to archive with no manual steps:
///   - the Sign in with Apple capability, and Associated Domains for invite links (applinks:your-domain, when baseUrl is https)
///   - AuthenticationServices and Security frameworks, and ARC for the plugin file
///   - Info.plist: the microphone text, and "no non-exempt encryption" (the game only uses HTTPS), which answers
///     App Store Connect's export-compliance question for every upload.
/// Your Apple Team still has to allow Sign in with Apple and Associated Domains for the app id (developer.apple.com).
/// </summary>
public static class IPlayIosBuild
{
    [PostProcessBuild(100)]
    public static void OnPostprocessBuild(BuildTarget target, string path)
    {
        if (target != BuildTarget.iOS) return;
        var cfg = IPlayBuildConfig.Load();

        var projectPath = PBXProject.GetPBXProjectPath(path);
        var project = new PBXProject();
        project.ReadFromFile(projectPath);
        var mainTarget = project.GetUnityMainTargetGuid();
        var frameworkTarget = project.GetUnityFrameworkTargetGuid();
        project.AddFrameworkToProject(frameworkTarget, "AuthenticationServices.framework", true);
        project.AddFrameworkToProject(frameworkTarget, "Security.framework", false);
        var plugin = project.FindFileGuidByProjectPath("Libraries/Plugins/iOS/IPlayNative.mm");
        if (plugin != null) project.SetCompileFlagsForFile(frameworkTarget, plugin, new List<string> { "-fobjc-arc" });
        else Debug.LogWarning("iPlay: IPlayNative.mm was not found in the Xcode project; Sign in with Apple and the Keychain will not work.");
        project.WriteToFile(projectPath);

        var capabilities = new ProjectCapabilityManager(projectPath, "Unity-iPhone/iplaycornhole.entitlements", null, mainTarget);
        capabilities.AddSignInWithApple();
        var host = cfg.LinkHost;
        if (host != null) capabilities.AddAssociatedDomains(new[] { "applinks:" + host });
        else Debug.LogWarning("iPlay: baseUrl is not https, so invite links will open in the browser, not the app.");
        capabilities.WriteToFile();

        var plistPath = Path.Combine(path, "Info.plist");
        var plist = new PlistDocument();
        plist.ReadFromFile(plistPath);
        plist.root.SetBoolean("ITSAppUsesNonExemptEncryption", false);
        plist.root.SetString("NSMicrophoneUsageDescription", IPlayProjectSetup.MicrophoneText);
        plist.WriteToFile(plistPath);
    }
}
#endif
