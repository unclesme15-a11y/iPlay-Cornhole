using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;
using IPlay.Cornhole;
#if UNITY_IOS && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

// The phone's own features: Sign in with Apple (iOS), Sign in with Google (Android), and a safe place for the login
// (iOS Keychain, Android Keystore). The native halves live in Assets/Plugins/iOS/IPlayNative.mm and
// Assets/Plugins/Android/IPlayNative.java. In the Editor everything falls back to PlayerPrefs and sign-in is not offered.

/// <summary>Receives answers from the native code (UnitySendMessage needs a GameObject with a known name).</summary>
public sealed class NativeBridge : MonoBehaviour
{
    public const string ObjectName = "IPlayNativeBridge";
    private static NativeBridge instance;
    private static readonly Dictionary<string, TaskCompletionSource<string>> pending = new Dictionary<string, TaskCompletionSource<string>>();

    public static void Ensure()
    {
        if (instance != null) return;
        var go = new GameObject(ObjectName);
        DontDestroyOnLoad(go);
        instance = go.AddComponent<NativeBridge>();
    }

    /// <summary>Starts waiting for one answer on a channel ("apple", "google"). A newer request replaces an older one.</summary>
    public static Task<string> Expect(string channel)
    {
        Ensure();
        TaskCompletionSource<string> old;
        if (pending.TryGetValue(channel, out old)) old.TrySetResult(null);
        var tcs = new TaskCompletionSource<string>();
        pending[channel] = tcs;
        return tcs.Task;
    }

    private static void Complete(string channel, string json)
    {
        TaskCompletionSource<string> tcs;
        if (!pending.TryGetValue(channel, out tcs)) return;
        pending.Remove(channel);
        tcs.TrySetResult(json);
    }

    // Called by the native code.
    public void OnAppleSignIn(string json) { Complete("apple", json); }
    public void OnGoogleSignIn(string json) { Complete("google", json); }

    /// <summary>A random nonce for one sign-in (base64url, 32 bytes).</summary>
    public static string NewNonce()
    {
        var bytes = new byte[32];
        using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    public static string Sha256Hex(string s)
    {
        using (var sha = SHA256.Create())
        {
            var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
            var sb = new StringBuilder(hash.Length * 2);
            foreach (var b in hash) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }

    /// <summary>Turns the native answer {"ok":true,"token":"..."} into a result; null when cancelled. Throws on a real error.</summary>
    public static IdentityResult ToResult(string json, string nonce, string what)
    {
        if (string.IsNullOrEmpty(json)) return null;
        var o = MiniJson.ParseObject(json);
        if (J.Bool(o, "ok")) return new IdentityResult { Token = J.Str(o, "token", ""), Nonce = nonce };
        if (J.Bool(o, "cancelled")) return null;
        throw new InvalidOperationException(what + " did not work: " + J.Str(o, "error", "unknown error"));
    }
}

/// <summary>Sign in with Apple (iPhone only). The server checks the token against APPLE_CLIENT_IDS (the app's bundle id).</summary>
public sealed class AppleSignInProvider : IdentityProvider
{
    public override string Name { get { return "apple"; } }

#if UNITY_IOS && !UNITY_EDITOR
    [DllImport("__Internal")] private static extern void IPlayAppleSignIn(string hashedNonce, string gameObject, string method);
    [DllImport("__Internal")] [return: MarshalAs(UnmanagedType.I1)] private static extern bool IPlayAppleSignInAvailable();
    public static bool Available { get { return IPlayAppleSignInAvailable(); } }
#else
    public static bool Available { get { return false; } }
#endif

    public override async Task<IdentityResult> SignInAsync()
    {
        // Apple puts the SHA-256 of what we send into the token; the server hashes our raw nonce to compare.
        var nonce = NativeBridge.NewNonce();
        var answer = NativeBridge.Expect("apple");
#if UNITY_IOS && !UNITY_EDITOR
        IPlayAppleSignIn(NativeBridge.Sha256Hex(nonce), NativeBridge.ObjectName, "OnAppleSignIn");
#else
        return null;
#endif
#pragma warning disable 0162
        return NativeBridge.ToResult(await answer, nonce, "Sign in with Apple");
#pragma warning restore 0162
    }
}

/// <summary>Sign in with Google (Android only), through Android's Credential Manager. Needs the Web client id from the
/// Google Cloud console in Resources/iplay-cornhole-server.json ("googleWebClientId"), and the same id in the server's
/// GOOGLE_CLIENT_IDS (the token is issued for it).</summary>
public sealed class GoogleSignInProvider : IdentityProvider
{
#pragma warning disable 0414 // only read in Android builds
    private readonly string webClientId;
#pragma warning restore 0414
    public GoogleSignInProvider(string webClientId) { this.webClientId = webClientId; }
    public override string Name { get { return "google"; } }

    public override async Task<IdentityResult> SignInAsync()
    {
        // Google puts this nonce into the token as it is.
        var nonce = NativeBridge.NewNonce();
        var answer = NativeBridge.Expect("google");
#if UNITY_ANDROID && !UNITY_EDITOR
        using (var cls = new AndroidJavaClass("com.iplay.cornhole.IPlayNative"))
            cls.CallStatic("signInWithGoogle", webClientId, nonce, NativeBridge.ObjectName, "OnGoogleSignIn");
#else
        return null;
#endif
#pragma warning disable 0162
        return NativeBridge.ToResult(await answer, nonce, "Sign in with Google");
#pragma warning restore 0162
    }
}

/// <summary>Keeps the login safe: the iOS Keychain or the Android Keystore; PlayerPrefs in the Editor.
/// Values saved by older builds in PlayerPrefs are moved over the first time they are read.
/// On iOS the Keychain outlives an uninstall, so a fresh install clears it (PlayerPrefs are wiped by an uninstall,
/// so a missing install mark means a fresh install). That keeps "delete the app" meaning what players expect.</summary>
public sealed class SecureStore : IKeyValueStore
{
    private const string InstallMark = "iPlay.Cornhole.Installed";

#if UNITY_IOS && !UNITY_EDITOR
    [DllImport("__Internal")] [return: MarshalAs(UnmanagedType.I1)] private static extern bool IPlayKeychainSet(string key, string value);
    [DllImport("__Internal")] private static extern string IPlayKeychainGet(string key);
    [DllImport("__Internal")] private static extern void IPlayKeychainDelete(string key);
    [DllImport("__Internal")] private static extern void IPlayKeychainClear();
    private static bool NativeSet(string k, string v) { return IPlayKeychainSet(k, v); }
    private static string NativeGet(string k) { return IPlayKeychainGet(k); }
    private static void NativeDelete(string k) { IPlayKeychainDelete(k); }
    private static void NativeClear() { IPlayKeychainClear(); }
    private const bool HasNative = true;
#elif UNITY_ANDROID && !UNITY_EDITOR
    private static AndroidJavaClass cls;
    private static AndroidJavaClass Cls { get { return cls ?? (cls = new AndroidJavaClass("com.iplay.cornhole.IPlayNative")); } }
    private static bool NativeSet(string k, string v) { return Cls.CallStatic<bool>("secureSet", k, v); }
    private static string NativeGet(string k) { return Cls.CallStatic<string>("secureGet", k); }
    private static void NativeDelete(string k) { Cls.CallStatic("secureDelete", k); }
    private static void NativeClear() { Cls.CallStatic("secureClear"); }
    private const bool HasNative = true;
#else
    private static bool NativeSet(string k, string v) { return false; }
    private static string NativeGet(string k) { return null; }
    private static void NativeDelete(string k) { }
    private static void NativeClear() { }
    private const bool HasNative = false;
#endif

    private readonly PlayerPrefsStore prefs = new PlayerPrefsStore();
    private bool nativeWorks = HasNative;

    public SecureStore()
    {
        if (!nativeWorks) return;
        try
        {
            if (prefs.Get(InstallMark) == null)
            {
                NativeClear();
                prefs.Set(InstallMark, "1");
            }
        }
        catch (Exception e) { Fallback(e); }
    }

    public string Get(string key)
    {
        if (!nativeWorks) return prefs.Get(key);
        try
        {
            var v = NativeGet(key);
            if (v != null) return v;
            var old = prefs.Get(key); // saved by an older build: move it into safe storage
            if (old != null && NativeSet(key, old)) prefs.Delete(key);
            return old;
        }
        catch (Exception e) { Fallback(e); return prefs.Get(key); }
    }

    public void Set(string key, string value)
    {
        if (!nativeWorks) { prefs.Set(key, value); return; }
        try
        {
            if (NativeSet(key, value)) { prefs.Delete(key); return; }
            Debug.LogWarning("Secure storage refused a value; keeping it in PlayerPrefs for now.");
            prefs.Set(key, value);
        }
        catch (Exception e) { Fallback(e); prefs.Set(key, value); }
    }

    public void Delete(string key)
    {
        prefs.Delete(key);
        if (!nativeWorks) return;
        try { NativeDelete(key); } catch (Exception e) { Fallback(e); }
    }

    private void Fallback(Exception e)
    {
        Debug.LogWarning("Secure storage is not working on this phone, using PlayerPrefs: " + e.Message);
        nativeWorks = false;
    }
}
