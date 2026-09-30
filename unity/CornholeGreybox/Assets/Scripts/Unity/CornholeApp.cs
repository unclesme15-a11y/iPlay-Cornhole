using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using IPlay.Cornhole;

/// <summary>
/// The whole game client, as one root object like Street Dice's controller: it builds itself at launch (no scene
/// needed), owns the services, and draws every screen with the iPlay look. Screens live in the other files of this
/// partial class. All the real logic is in IPlay.Cornhole.Core (tested on its own); this is input, drawing and glue,
/// and it is the part the final art replaces.
/// </summary>
public sealed partial class CornholeApp : MonoBehaviour
{
    private enum Page { Intro, AdultGate, AdultDenied, Outage, Terms, Rejoin, Menu, Ranked, Searching, Party, Friends, Leaderboards, Profile, Settings, Match }

    private const float IntroSeconds = 1.6f;

    // services
    private ServerSettings server;
    private ApiClient api;
    private AccountSession account;
    private RankedFlow ranked;
    private Leaderboards boards;
    private AdPacer ads;
    private LocalSettings settings;
    private CueSounds sounds;
    private IKeyValueStore store;
    private ThrowGuide Guide { get { return account.Guide; } }

    // screen state
    private Page screen = Page.Intro;
    private float introStarted;
    private StartupOutcome outage;
    private string toast;
    private float toastUntil;
    private bool busy;
    private Texture2D logo;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void Boot()
    {
        if (FindFirstObjectByType<CornholeApp>() != null) return;
        var go = new GameObject("iPlay Cornhole");
        go.AddComponent<CornholeApp>();
        DontDestroyOnLoad(go);
    }

    private void Awake()
    {
        Application.targetFrameRate = 60;
        // Landscape only (the owner's decision): either way up, never portrait. Player Settings should say the same.
        Screen.autorotateToPortrait = false;
        Screen.autorotateToPortraitUpsideDown = false;
        Screen.autorotateToLandscapeLeft = true;
        Screen.autorotateToLandscapeRight = true;
        Screen.orientation = ScreenOrientation.AutoRotation;
        server = ServerSettings.Load();
        store = new PlayerPrefsStore();
        settings = new LocalSettings(store);
        api = new ApiClient(new UnityHttpTransport(), server.BaseUrl, new ClientInfo { Version = NormalizeVersion(Application.version), Platform = Application.platform == RuntimePlatform.IPhonePlayer ? "ios" : "android" });
        // The login lives in the Keychain / Keystore; plain settings stay in PlayerPrefs.
        account = new AccountSession(api, new SecureStore());
        RegisterIdentityProviders();
        ranked = new RankedFlow(api);
        boards = new Leaderboards(api);
        ads = new AdPacer();
        sounds = new CueSounds(gameObject) { Enabled = settings.Sound };
        logo = Resources.Load<Texture2D>("Branding/iplay-mark-white");
        introStarted = Time.unscaledTime;
        InitializeAds();
        Application.deepLinkActivated += OnDeepLink;
        OnDeepLink(Application.absoluteURL);
    }

    /// <summary>iPhone offers Sign in with Apple, Android offers Sign in with Google. A button only shows when the server
    /// has that sign-in switched on too (APPLE_CLIENT_IDS / GOOGLE_CLIENT_IDS).</summary>
    private void RegisterIdentityProviders()
    {
        IdentityProviders.Clear();
        if (Application.platform == RuntimePlatform.IPhonePlayer && AppleSignInProvider.Available)
            IdentityProviders.Add(new AppleSignInProvider());
        if (Application.platform == RuntimePlatform.Android && !string.IsNullOrEmpty(server.GoogleWebClientId))
            IdentityProviders.Add(new GoogleSignInProvider(server.GoogleWebClientId));
    }

    /// <summary>The server wants 1.2.3; Unity's version can be shorter (0.1).</summary>
    private static string NormalizeVersion(string v)
    {
        var parts = new List<string>((v ?? "0.1.0").Split('.'));
        while (parts.Count < 3) parts.Add("0");
        for (var i = 0; i < 3; i++)
        {
            var digits = "";
            foreach (var c in parts[i]) { if (c >= '0' && c <= '9') digits += c; else break; }
            parts[i] = digits.Length == 0 ? "0" : digits;
        }
        return parts[0] + "." + parts[1] + "." + parts[2];
    }

    private void Update()
    {
        switch (screen)
        {
            case Page.Intro:
                if (Time.unscaledTime - introStarted >= IntroSeconds && !busy) { busy = true; _ = BeginStartup(); }
                break;
            case Page.Searching:
                UpdateSearching();
                break;
            case Page.Match:
                UpdateMatch();
                break;
        }
        UpdateAds();
        if (Input.GetKeyDown(KeyCode.Escape)) OnBackPressed();
    }

    private void OnGUI()
    {
        UiKit.Begin();
        UiKit.Backdrop();
        switch (screen)
        {
            case Page.Intro: DrawIntro(); break;
            case Page.AdultGate: DrawAdultGate(); break;
            case Page.AdultDenied: DrawAdultDenied(); break;
            case Page.Outage: DrawOutage(); break;
            case Page.Terms: DrawTerms(); break;
            case Page.Rejoin: DrawRejoin(); break;
            case Page.Menu: DrawMenu(); break;
            case Page.Ranked: DrawRanked(); break;
            case Page.Searching: DrawSearching(); break;
            case Page.Party: DrawParty(); break;
            case Page.Friends: DrawFriends(); break;
            case Page.Leaderboards: DrawLeaderboards(); break;
            case Page.Profile: DrawProfile(); break;
            case Page.Settings: DrawSettings(); break;
            case Page.Match: DrawMatch(); break;
        }
        if (Time.unscaledTime < toastUntil) UiKit.Toast(toast);
    }

    // ------------------------------------------------------------------ helpers
    private void Go(Page next) { screen = next; }

    private void Say(string message, float seconds = 3f) { toast = message; toastUntil = Time.unscaledTime + seconds; }

    /// <summary>Runs a server call from a button. Shows a friendly message if it fails, and never lets one call run twice at once.</summary>
    private async Task Do(Func<Task> action)
    {
        if (busy) return;
        busy = true;
        try { await action(); }
        catch (ApiException e) { Say(Friendly(e)); if (e.IsAuth) await RelaunchAsync(); }
        catch (Exception e) { Debug.LogException(e); Say("Something went wrong. Try again."); }
        finally { busy = false; }
    }

    private async Task RelaunchAsync()
    {
        screen = Page.Intro;
        introStarted = Time.unscaledTime - IntroSeconds;
        busy = false;
        await Task.Yield();
    }

    /// <summary>Turns a server error code into words a player understands.</summary>
    private static string Friendly(ApiException e)
    {
        switch (e.Code)
        {
            case "network": return "Can't reach the server. Check your connection.";
            case "adult_confirmation_required": return "You must be 18 or older.";
            case "terms_update_required": return "Please accept the new terms first.";
            case "already_in_match": return "You're already in a match.";
            case "already_queued": return "You're already searching.";
            case "ranked_cooldown": return "You left a ranked match. Wait a little before searching again.";
            case "party_required": return "Ranked teams need a partner. Make a party first.";
            case "party_full": return "That party is full.";
            case "party_not_found": return "That party code isn't valid (it may have expired).";
            case "party_not_available": return "You can't join that party.";
            case "maintenance": return "iPlay Cornhole is being updated. Back soon.";
            case "server_busy": return "The server is busy. Try again in a minute.";
            case "name_profane": case "name_reserved": case "name_chars": case "name_length": return e.Message;
            case "rename_cooldown": return "You can change your name once a week.";
            case "match_not_found": return "That match isn't running any more.";
            case "not_your_turn": return "It isn't your turn.";
            case "color_taken": return "That color was taken. Pick another.";
            case "character_taken": return "That character was taken. Pick another.";
            case "account_banned": return "This account is banned.";
            case "voice_unavailable": return "Voice chat isn't available.";
            default: return e.Message;
        }
    }

    private void OnBackPressed()
    {
        switch (screen)
        {
            case Page.Ranked: case Page.Friends: case Page.Leaderboards: case Page.Profile: case Page.Settings: case Page.Party:
                Go(Page.Menu); break;
            case Page.Searching:
                _ = Do(async () => { await ranked.CancelAsync(); Go(Page.Ranked); });
                break;
            case Page.Match:
                leaveConfirm = true; break;
        }
    }

    private static string Ago(double seconds)
    {
        var s = (int)seconds;
        return (s / 60) + ":" + (s % 60).ToString("00");
    }
}
