// Stand-ins for the Unity Services (Core, Authentication, Vivox) and AppLovin MAX APIs the Unity layer uses, so
// `check-unity-layer.sh` can compile the Unity-facing scripts with no Unity Editor. Unity's own engine API is NOT stubbed:
// the check compiles against Unity's real engine reference assemblies (downloaded from NuGet by the script).
//
// WHAT THIS PROVES: the code compiles against the real UnityEngine API (2021.3 LTS reference assemblies; every call used
// also exists in Unity 6), and has no typos or wrong types against the Vivox/AppLovin surface below.
// WHAT IT DOES NOT PROVE: that the Vivox 16 / AppLovin MAX signatures below match the real packages (their download
// servers could not be reached from where this was written). Written from their documentation and the Street Dice code.
#pragma warning disable 0067, 0414, 0169, 0649
using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;
namespace Unity.Services.Core
{
    public enum ServicesInitializationState { Uninitialized, Initializing, Initialized }
    public static class UnityServices
    {
        public static ServicesInitializationState State { get { return ServicesInitializationState.Uninitialized; } }
        public static Task InitializeAsync() { return Task.FromResult(0); }
    }
}
namespace Unity.Services.Authentication
{
    public class AuthenticationService
    {
        public static AuthenticationService Instance = new AuthenticationService();
        public bool IsSignedIn { get { return false; } }
        public Task SignInAnonymouslyAsync() { return Task.FromResult(0); }
    }
}
namespace Unity.Services.Vivox
{
    public enum ChatCapability { AudioOnly, TextOnly, TextAndAudio }
    public enum TransmissionMode { None, Single, All }
    public class LoginOptions { public string DisplayName; }
    public class VivoxParticipant
    {
        public string DisplayName; public bool SpeechDetected;
        public event Action ParticipantSpeechDetected; public event Action ParticipantAudioEnergyChanged;
        public void MutePlayerLocally() { }
        public void UnmutePlayerLocally() { }
    }
    public interface IVivoxTokenProvider
    {
        Task<string> GetTokenAsync(string issuer = null, TimeSpan? expiration = null, string targetUserUri = null, string action = null, string channelUri = null, string fromUserUri = null, string realm = null);
    }
    public class VivoxService
    {
        public static VivoxService Instance = new VivoxService();
        public event Action<VivoxParticipant> ParticipantAddedToChannel;
        public void SetTokenProvider(IVivoxTokenProvider p) { }
        public Task InitializeAsync() { return Task.FromResult(0); }
        public Task LoginAsync(LoginOptions o) { return Task.FromResult(0); }
        public Task JoinGroupChannelAsync(string name, ChatCapability c) { return Task.FromResult(0); }
        public Task LeaveChannelAsync(string name) { return Task.FromResult(0); }
        public Task SetChannelTransmissionModeAsync(TransmissionMode m, string channelName = null) { return Task.FromResult(0); }
    }
}

#if APPLOVIN_MAX
public class MaxSdkBase
{
    public enum BannerPosition { BottomCenter }
    public class SdkConfiguration { }
    public class AdInfo { }
    public class ErrorInfo { }
}
public class MaxSdkCallbacks
{
    public static event Action<MaxSdkBase.SdkConfiguration> OnSdkInitializedEvent;
    public class Interstitial
    {
        public static event Action<string, MaxSdkBase.AdInfo> OnAdHiddenEvent;
        public static event Action<string, MaxSdkBase.ErrorInfo> OnAdLoadFailedEvent;
    }
}
public class MaxSdk : MaxSdkBase
{
    public static void SetSdkKey(string k) { }
    public static void InitializeSdk() { }
    public static void LoadInterstitial(string id) { }
    public static bool IsInterstitialReady(string id) { return false; }
    public static void ShowInterstitial(string id) { }
    public static void CreateBanner(string id, BannerPosition p) { }
    public static void ShowBanner(string id) { }
    public static void HideBanner(string id) { }
}
#endif

// Unity Mobile Notifications (com.unity.mobile.notifications), iOS part: only what NativePush.cs uses.
namespace Unity.Notifications.iOS
{
    [Flags] public enum AuthorizationOption { None = 0, Badge = 1, Sound = 2, Alert = 4 }
    public class AuthorizationRequest : IDisposable
    {
        public AuthorizationRequest(AuthorizationOption authorizationOption, bool registerForRemoteNotifications) { }
        public bool IsFinished { get { return true; } }
        public bool Granted { get { return false; } }
        public string Error { get { return null; } }
        public string DeviceToken { get { return null; } }
        public void Dispose() { }
    }
}

// Firebase Unity SDK (FirebaseApp + Messaging): only what NativePush.cs uses.
namespace Firebase
{
    public enum DependencyStatus { Available, UnavailableDisabled, UnavailableInvalid, UnavilableMissing, UnavailablePermission, UnavailableUpdaterequired, UnavailableUpdating, UnavailableOther }
    public class FirebaseApp
    {
        public static Task<DependencyStatus> CheckAndFixDependenciesAsync() { return Task.FromResult(DependencyStatus.Available); }
    }
}
namespace Firebase.Messaging
{
    public static class FirebaseMessaging
    {
        public static Task<string> GetTokenAsync() { return Task.FromResult(""); }
    }
}
