// Stand-ins for UnityEditor.iOS.Xcode (Unity's Xcode project API), which ships with Unity's iOS build support and is not
// in the Editor reference assembly used by check-unity-layer.sh. Only the members IPlayIosBuild.cs uses, with the
// signatures from Unity's documentation. Opening the project in Unity with iOS support is the real test.
using System.Collections.Generic;
namespace UnityEditor.iOS.Xcode
{
    public class PBXProject
    {
        public static string GetPBXProjectPath(string buildPath) { return buildPath + "/Unity-iPhone.xcodeproj/project.pbxproj"; }
        public void ReadFromFile(string path) { }
        public void WriteToFile(string path) { }
        public string GetUnityMainTargetGuid() { return ""; }
        public string GetUnityFrameworkTargetGuid() { return ""; }
        public void AddFrameworkToProject(string targetGuid, string framework, bool weak) { }
        public string FindFileGuidByProjectPath(string path) { return null; }
        public void SetCompileFlagsForFile(string targetGuid, string fileGuid, List<string> compileFlags) { }
    }
    public class ProjectCapabilityManager
    {
        public ProjectCapabilityManager(string pbxProjectPath, string entitlementFilePath, string targetName = null, string targetGuid = null) { }
        public void AddSignInWithApple() { }
        public void AddPushNotifications(bool development) { }
        public void AddAssociatedDomains(string[] domains) { }
        public void WriteToFile() { }
    }
    public class PlistElementDict
    {
        public void SetBoolean(string key, bool val) { }
        public void SetString(string key, string val) { }
    }
    public class PlistDocument
    {
        public PlistElementDict root = new PlistElementDict();
        public void ReadFromFile(string path) { }
        public void WriteToFile(string path) { }
    }
}
