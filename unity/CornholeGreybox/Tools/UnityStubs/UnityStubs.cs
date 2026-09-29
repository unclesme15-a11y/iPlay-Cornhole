// Minimal stand-ins for the Unity, Vivox and AppLovin APIs the Unity layer uses, so `check-unity-layer.sh` can compile
// the Unity-facing scripts with mono's compiler on a machine with no Unity Editor.
//
// WHAT THIS PROVES: my own code has no typos, wrong types, missing members or bad syntax against the API surface listed here.
// WHAT IT DOES NOT PROVE: that these signatures match the real Unity 6 / Vivox 16 / AppLovin MAX APIs. I wrote them from
// memory and from the working Street Dice code. Opening the project in Unity is the real test.
#pragma warning disable 0067, 0414, 0169, 0649
using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace UnityEngine
{
    public class Object
    {
        public static void Destroy(Object o) { }
        public static void DontDestroyOnLoad(Object o) { }
        public static T FindFirstObjectByType<T>() where T : Object { return null; }
    }
    public class Component : Object { public GameObject gameObject { get { return null; } } }
    public class Behaviour : Component { }
    public class MonoBehaviour : Behaviour
    {
        public Coroutine StartCoroutine(IEnumerator routine) { return null; }
    }
    public class Coroutine { }
    public class GameObject : Object
    {
        public GameObject(string name) { }
        public T AddComponent<T>() where T : Component, new() { return new T(); }
    }
    public sealed class RuntimeInitializeOnLoadMethodAttribute : Attribute { public RuntimeInitializeOnLoadMethodAttribute(RuntimeInitializeLoadType t) { } }
    public enum RuntimeInitializeLoadType { AfterSceneLoad }
    public enum RuntimePlatform { IPhonePlayer, Android, WindowsEditor }
    public static class Application
    {
        public static int targetFrameRate;
        public static string version { get { return "0.1"; } }
        public static RuntimePlatform platform { get { return RuntimePlatform.Android; } }
        public static string persistentDataPath { get { return "/tmp"; } }
        public static string absoluteURL { get { return ""; } }
        public static event Action<string> deepLinkActivated;
        public static void OpenURL(string url) { }
    }
    public static class Time
    {
        public static float unscaledTime { get { return 0; } }
        public static float realtimeSinceStartup { get { return 0; } }
        public static double realtimeSinceStartupAsDouble { get { return 0; } }
    }
    public static class Screen { public static int width { get { return 1280; } } public static int height { get { return 720; } } }
    public enum KeyCode { Escape }
    public enum TouchPhase { Began, Moved, Stationary, Ended, Canceled }
    public struct Touch { public Vector2 position; public TouchPhase phase; }
    public static class Input
    {
        public static int touchCount { get { return 0; } }
        public static Touch GetTouch(int i) { return new Touch(); }
        public static Vector3 mousePosition { get { return new Vector3(); } }
        public static bool GetMouseButton(int b) { return false; }
        public static bool GetMouseButtonDown(int b) { return false; }
        public static bool GetMouseButtonUp(int b) { return false; }
        public static bool GetKeyDown(KeyCode k) { return false; }
    }
    public struct Vector2
    {
        public float x, y;
        public Vector2(float x, float y) { this.x = x; this.y = y; }
        public static implicit operator Vector2(Vector3 v) { return new Vector2(v.x, v.y); }
    }
    public struct Vector3 { public float x, y, z; public Vector3(float x, float y, float z) { this.x = x; this.y = y; this.z = z; } }
    public struct Matrix4x4 { public static Matrix4x4 Scale(Vector3 v) { return new Matrix4x4(); } public static Matrix4x4 identity { get { return new Matrix4x4(); } } }
    public struct Color
    {
        public float r, g, b, a;
        public Color(float r, float g, float b, float a = 1f) { this.r = r; this.g = g; this.b = b; this.a = a; }
        public static Color black { get { return new Color(0, 0, 0); } }
        public static Color white { get { return new Color(1, 1, 1); } }
    }
    public struct Rect
    {
        public float x, y, width, height;
        public Rect(float x, float y, float w, float h) { this.x = x; this.y = y; width = w; height = h; }
        public float xMax { get { return x + width; } }
        public float yMax { get { return y + height; } }
    }
    public static class Mathf
    {
        public static float Min(float a, float b) { return a < b ? a : b; }
        public static float Max(float a, float b) { return a > b ? a : b; }
        public static float Clamp01(float v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
        public static int RoundToInt(float v) { return (int)Math.Round(v); }
        public static int CeilToInt(float v) { return (int)Math.Ceiling(v); }
        public static float Sin(float v) { return (float)Math.Sin(v); }
    }
    public class Texture : Object { }
    public class Texture2D : Texture { public static Texture2D whiteTexture { get { return null; } } }
    public class Font : Object { }
    public class TextAsset : Object { public string text { get { return ""; } } }
    public class AudioClip : Object { }
    public class AudioSource : Component { public bool playOnAwake; public void PlayOneShot(AudioClip c, float v) { } }
    public static class PlayerPrefs
    {
        public static bool HasKey(string k) { return false; }
        public static string GetString(string k) { return ""; }
        public static void SetString(string k, string v) { }
        public static void DeleteKey(string k) { }
        public static void Save() { }
    }
    public static class Resources { public static T Load<T>(string path) where T : Object { return null; } }
    public static class Debug
    {
        public static void Log(object m) { }
        public static void LogWarning(object m) { }
        public static void LogException(Exception e) { }
    }
    public enum TextAnchor { UpperLeft, MiddleLeft, MiddleCenter, MiddleRight }
    public enum FontStyle { Normal, Bold }
    public enum TextClipping { Overflow, Clip }
    public enum ScaleMode { StretchToFill, ScaleToFit }
    public class RectOffset { public RectOffset(int l, int r, int t, int b) { } }
    public class GUIStyleState { public Color textColor; }
    public class GUIContent { public static GUIContent none = new GUIContent(); }
    public class GUIStyle
    {
        public static GUIStyle none = new GUIStyle();
        public GUIStyle() { }
        public GUIStyle(GUIStyle other) { }
        public int fontSize; public TextAnchor alignment; public FontStyle fontStyle; public bool wordWrap; public TextClipping clipping;
        public GUIStyleState normal = new GUIStyleState(), hover = new GUIStyleState();
        public Font font; public RectOffset padding;
    }
    public class GUISkin { public GUIStyle label = new GUIStyle(); }
    public static class GUI
    {
        public static Matrix4x4 matrix;
        public static Color color;
        public static GUISkin skin = new GUISkin();
        public static void Label(Rect r, string text, GUIStyle style) { }
        public static bool Button(Rect r, GUIContent c, GUIStyle s) { return false; }
        public static void DrawTexture(Rect r, Texture t) { }
        public static void DrawTexture(Rect r, Texture t, ScaleMode m, bool alpha) { }
        public static string TextField(Rect r, string text, int maxLength, GUIStyle style) { return text; }
    }
    public static class GUIUtility
    {
        public static string systemCopyBuffer;
        public static void RotateAroundPivot(float angle, Vector2 pivot) { }
    }
}

namespace UnityEngine.Networking
{
    public class AsyncOperation { public event Action<AsyncOperation> completed; }
    public class UnityWebRequestAsyncOperation : AsyncOperation { }
    public class DownloadHandler { public string text { get { return ""; } } }
    public class DownloadHandlerBuffer : DownloadHandler { }
    public class UploadHandler { }
    public class UploadHandlerRaw : UploadHandler { public UploadHandlerRaw(byte[] data) { } }
    public class UnityWebRequest : IDisposable
    {
        public enum Result { InProgress, Success, ConnectionError, ProtocolError, DataProcessingError }
        public UnityWebRequest(string url, string method) { }
        public DownloadHandler downloadHandler; public UploadHandler uploadHandler; public int timeout;
        public Result result; public string error; public long responseCode;
        public void SetRequestHeader(string k, string v) { }
        public UnityWebRequestAsyncOperation SendWebRequest() { return null; }
        public void Dispose() { }
    }
}

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
