using System;
using System.Threading.Tasks;
using IPlay.Cornhole;
#if UNITY_IOS && !UNITY_EDITOR
using Unity.Notifications.iOS;
#endif
#if UNITY_ANDROID && FIREBASE_MESSAGING && !UNITY_EDITOR
using Firebase;
using Firebase.Messaging;
using UnityEngine.Android;
#endif

// Getting a push token from the phone. iPhone: Unity's Mobile Notifications package (com.unity.mobile.notifications,
// already in Packages/manifest.json). Android: the Firebase Cloud Messaging SDK, which needs your Firebase project's
// google-services.json; import the SDK, add FIREBASE_MESSAGING to the Android Scripting Define Symbols, and this turns
// on. Until then Android simply gets no notifications (everything else works).

public static class PushProviders
{
    public static IPushProvider ForThisPhone()
    {
#if UNITY_IOS && !UNITY_EDITOR
        return new IosPushProvider();
#elif UNITY_ANDROID && FIREBASE_MESSAGING && !UNITY_EDITOR
        return new AndroidPushProvider();
#else
        return null;
#endif
    }
}

#if UNITY_IOS && !UNITY_EDITOR
public sealed class IosPushProvider : IPushProvider
{
    public string Platform { get { return "ios"; } }
    public bool IsSupported { get { return true; } }

    public async Task<string> RequestTokenAsync()
    {
        // Shows Apple's prompt the first time; afterwards it answers straight away. true = also register with APNs.
        using (var req = new AuthorizationRequest(AuthorizationOption.Alert | AuthorizationOption.Badge | AuthorizationOption.Sound, true))
        {
            var deadline = DateTime.UtcNow.AddMinutes(2);
            while (!req.IsFinished && DateTime.UtcNow < deadline) await Task.Yield();
            if (!req.IsFinished || !req.Granted || string.IsNullOrEmpty(req.DeviceToken)) return null;
            return req.DeviceToken;
        }
    }
}
#endif

#if UNITY_ANDROID && FIREBASE_MESSAGING && !UNITY_EDITOR
public sealed class AndroidPushProvider : IPushProvider
{
    private const string NotificationPermission = "android.permission.POST_NOTIFICATIONS";
    public string Platform { get { return "android"; } }
    public bool IsSupported { get { return true; } }

    public async Task<string> RequestTokenAsync()
    {
        // Android 13 and newer ask the player first; older versions allow notifications without asking.
        if (AndroidSdk() >= 33 && !Permission.HasUserAuthorizedPermission(NotificationPermission))
        {
            var answered = new TaskCompletionSource<bool>();
            var callbacks = new PermissionCallbacks();
            callbacks.PermissionGranted += _ => answered.TrySetResult(true);
            callbacks.PermissionDenied += _ => answered.TrySetResult(false);
            callbacks.PermissionDeniedAndDontAskAgain += _ => answered.TrySetResult(false);
            Permission.RequestUserPermission(NotificationPermission, callbacks);
            await Task.WhenAny(answered.Task, Task.Delay(TimeSpan.FromMinutes(2)));
            if (!Permission.HasUserAuthorizedPermission(NotificationPermission)) return null;
        }
        var status = await FirebaseApp.CheckAndFixDependenciesAsync();
        if (status != DependencyStatus.Available) return null;
        return await FirebaseMessaging.GetTokenAsync();
    }

    private static int AndroidSdk()
    {
        using (var version = new UnityEngine.AndroidJavaClass("android.os.Build$VERSION")) return version.GetStatic<int>("SDK_INT");
    }
}
#endif
