using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;
using IPlay.Cornhole;

/// <summary>The one place the game touches the network on a phone. (Tests use HttpClient instead.)</summary>
public sealed class UnityHttpTransport : IHttpTransport
{
    public Task<HttpResult> SendAsync(string method, string url, IDictionary<string, string> headers, string body)
    {
        var done = new TaskCompletionSource<HttpResult>();
        var request = new UnityWebRequest(url, method);
        request.downloadHandler = new DownloadHandlerBuffer();
        if (body != null) request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
        foreach (var kv in headers) request.SetRequestHeader(kv.Key, kv.Value);
        request.timeout = 20;
        var op = request.SendWebRequest();
        op.completed += _ =>
        {
            try
            {
                if (request.result == UnityWebRequest.Result.ConnectionError)
                    done.TrySetException(new Exception(request.error ?? "connection error"));
                else
                    done.TrySetResult(new HttpResult { Status = (int)request.responseCode, Body = request.downloadHandler.text });
            }
            finally { request.Dispose(); }
        };
        return done.Task;
    }
}

/// <summary>Saved choices (sound, voice...) in PlayerPrefs. The login itself goes in <see cref="SecureStore"/>.</summary>
public sealed class PlayerPrefsStore : IKeyValueStore
{
    public string Get(string key) { return PlayerPrefs.HasKey(key) ? PlayerPrefs.GetString(key) : null; }
    public void Set(string key, string value) { PlayerPrefs.SetString(key, value); PlayerPrefs.Save(); }
    public void Delete(string key) { PlayerPrefs.DeleteKey(key); PlayerPrefs.Save(); }
}

/// <summary>Where the game server is, and the links the app shows. Read from Resources/iplay-cornhole-server.json.</summary>
public sealed class ServerSettings
{
    public string BaseUrl = "http://127.0.0.1:3000";
    public string TermsUrl = "", PrivacyUrl = "", SupportUrl = "", IosStoreUrl = "", AndroidStoreUrl = "";
    /// <summary>The "Web application" OAuth client id from the Google Cloud console (Android sign-in asks for a token for it).</summary>
    public string GoogleWebClientId = "";

    public static ServerSettings Load()
    {
        var s = new ServerSettings();
        var asset = Resources.Load<TextAsset>("iplay-cornhole-server");
        if (asset == null) return s;
        var json = MiniJson.ParseObject(asset.text);
        s.BaseUrl = J.Str(json, "baseUrl", s.BaseUrl);
        s.TermsUrl = J.Str(json, "termsUrl", "");
        s.GoogleWebClientId = J.Str(json, "googleWebClientId", "");
        s.PrivacyUrl = J.Str(json, "privacyUrl", "");
        s.SupportUrl = J.Str(json, "supportUrl", "");
        s.IosStoreUrl = J.Str(json, "iosStoreUrl", "");
        s.AndroidStoreUrl = J.Str(json, "androidStoreUrl", "");
        return s;
    }

    public string StoreUrl { get { return Application.platform == RuntimePlatform.IPhonePlayer ? IosStoreUrl : AndroidStoreUrl; } }
}

/// <summary>
/// Plays the sounds the server names in its cues (cornhole_hit, bag_thud, ground_thud), the instant they are due.
/// The game-show ring-in for a cornhole is the one that matters.
/// </summary>
public sealed class CueSounds
{
    private readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
    private readonly AudioSource source;
    public bool Enabled = true;
    /// <summary>Which of the three ring-in sounds to use: "" (the main one), "_alt_ding" or "_alt_buzz".</summary>
    public string RingInVariant = "_alt_ding"; // the owner's pick: two bells, no buzzer

    public CueSounds(GameObject host)
    {
        source = host.AddComponent<AudioSource>();
        source.playOnAwake = false;
        foreach (var id in new[] { "cornhole_hit", "cornhole_hit_alt_ding", "cornhole_hit_alt_buzz", "bag_thud", "ground_thud" })
        {
            var clip = Resources.Load<AudioClip>("Audio/" + id);
            if (clip != null) clips[id] = clip;
        }
    }

    public void Play(string soundId, float volume = 1f)
    {
        if (!Enabled || string.IsNullOrEmpty(soundId)) return;
        if (soundId == "cornhole_hit" && RingInVariant.Length > 0) soundId += RingInVariant;
        AudioClip clip;
        if (clips.TryGetValue(soundId, out clip)) source.PlayOneShot(clip, volume);
    }

    public void PlayCue(Cue cue) { if (cue != null) Play(cue.Sound); }
}
