using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;
using IPlay.Cornhole;

/// <summary>A sign-in method the app can offer (Sign in with Apple, Google). These need a native plugin on the phone, so they are registered by whoever adds the plugin.</summary>
public abstract class IdentityProvider
{
    public abstract string Name { get; } // "apple" or "google"
    /// <summary>Show the system sign-in and return the token and nonce, or null if cancelled.</summary>
    public abstract Task<IdentityResult> SignInAsync();
}

public sealed class IdentityResult { public string Token, Nonce; }

// The menus: main menu, ranked, parties, friends, leaderboards, profile and settings.
public sealed partial class CornholeApp
{
    /// <summary>Add your Apple / Google sign-in plugin adapters here at start-up.</summary>
    public static readonly List<IdentityProvider> IdentityProviders = new List<IdentityProvider>();

    private string joinCode = "", partyCode = "", nameDraft;
    private string pendingInviteCode;
    private bool deleteConfirm, signOutConfirm;

    private double NowMs { get { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); } }

    // ---------------------------------------------------------------- main menu
    private void DrawMenu()
    {
        if (pendingInviteCode != null && !busy) { var code = pendingInviteCode; pendingInviteCode = null; _ = Do(() => JoinFriend(code)); }
        UiKit.Title("CORNHOLE", UiKit.Portrait ? 60f : 30f);
        var a = account.Account;
        UiKit.Text(new Rect(0, UiKit.Portrait ? 122f : 92f, UiKit.W, 36f), a.DisplayName + "   " + Mathf.RoundToInt((float)a.SinglesRating) + (a.SinglesGames < 10 ? "  (placement " + a.SinglesGames + "/10)" : ""), Theme.BodySize, TextAnchor.MiddleCenter, Theme.SoftCyan);

        var w = Mathf.Min(UiKit.W - 60f, 520f);
        var x = (UiKit.W - w) / 2f;
        var y = UiKit.Portrait ? 200f : 150f;
        const float h = 70f, gap = 16f;
        if (UiKit.Button(new Rect(x, y, w, h), "RANKED", !busy, true)) Go(Page.Ranked);
        y += h + gap;
        if (UiKit.Button(new Rect(x, y, w, h), "PLAY WITH FRIENDS", !busy)) Go(Page.Friends);
        y += h + gap;
        if (UiKit.Button(new Rect(x, y, w, h), "PRACTICE VS BOT", !busy)) _ = Do(StartPractice);
        y += h + gap;
        var half = (w - gap) / 2f;
        if (UiKit.Button(new Rect(x, y, half, h), "LEADERBOARDS", !busy, false, Theme.BodySize)) { OpenLeaderboards(); }
        if (UiKit.Button(new Rect(x + half + gap, y, half, h), "PROFILE", !busy, false, Theme.BodySize)) { nameDraft = a.DisplayName; Go(Page.Profile); }
        y += h + gap;
        if (UiKit.Button(new Rect(x, y, w, 56f), "SETTINGS", !busy, false, Theme.BodySize)) Go(Page.Settings);
    }

    private async Task StartPractice()
    {
        var config = J.Make("mode", "1v1", "playTo", 11.0, "tutorial", settings.Tutorial ? (object)true : null);
        var r = await api.CreateMatch(config);
        var id = J.Str(r, "matchId");
        await api.StartMatch(id);
        OpenMatch(id);
    }

    // ---------------------------------------------------------------- ranked
    private void DrawRanked()
    {
        UiKit.Title("RANKED");
        var a = account.Account;
        UiKit.Text(new Rect(0, 100f, UiKit.W, 60f), "Singles rating " + Mathf.RoundToInt((float)a.SinglesRating) + (a.SinglesGames < 10 ? "  ·  " + (10 - a.SinglesGames) + " placement games to go" : ""), Theme.BodySize, TextAnchor.MiddleCenter, Theme.SoftCyan);
        UiKit.Text(new Rect(30f, 150f, UiKit.W - 60f, 90f), "Play to 21, no bots, the same rules for everybody. Walking out counts as a loss and you wait 10 minutes.", Theme.SmallSize + 2, TextAnchor.MiddleCenter, Theme.TextDim);
        var w = Mathf.Min(UiKit.W - 60f, 520f);
        var x = (UiKit.W - w) / 2f;
        if (UiKit.Button(new Rect(x, 260f, w, 80f), "SINGLES  (1 v 1)", !busy, true)) _ = Do(async () => { await ranked.JoinAsync("singles"); Go(Page.Searching); nextPoll = 0; });
        if (UiKit.Button(new Rect(x, 356f, w, 80f), "TEAMS  (duo)", !busy))
        {
            _ = Do(async () =>
            {
                var current = await api.PartyMine();
                var party = J.Obj(current, "party");
                if (party != null && J.Bool(party, "full")) { await ranked.JoinAsync("teams"); Go(Page.Searching); nextPoll = 0; }
                else Go(Page.Party);
            });
        }
        if (UiKit.Back()) Go(Page.Menu);
    }

    private double nextPoll;

    private void UpdateSearching()
    {
        if (busy || Time.unscaledTime < nextPoll) return;
        nextPoll = Time.unscaledTime + (float)RankedFlow.PollSeconds;
        _ = Do(async () =>
        {
            var q = await ranked.PollAsync();
            if (q.IsMatched) OpenMatch(q.MatchId);
            else if (q.Status == "expired") { Say("Nobody was found. Try again."); Go(Page.Ranked); }
            else if (q.Status == "cooldown") { Say("You left a ranked match. Wait a little before searching again."); Go(Page.Ranked); }
            else if (q.Status == "idle") Go(Page.Ranked); // the party was broken up, or we were removed
        });
    }

    private void DrawSearching()
    {
        var q = ranked.Current;
        UiKit.Title("FINDING OPPONENTS");
        var panel = UiKit.Center(Mathf.Min(UiKit.W - 40f, 640f), 260f);
        UiKit.Panel(panel, true);
        var dots = new string('.', (int)(Time.unscaledTime * 2f) % 4);
        UiKit.Text(new Rect(panel.x, panel.y + 24f, panel.width, 50f), (q.Mode == "teams" ? "Duo" : "Singles") + " match" + dots, Theme.HeadingSize, TextAnchor.MiddleCenter, Theme.Cyan);
        UiKit.Text(new Rect(panel.x, panel.y + 84f, panel.width, 44f), "Waiting " + Ago(q.WaitedSec), Theme.BodySize);
        UiKit.Text(new Rect(panel.x, panel.y + 128f, panel.width, 44f), "Looking within ±" + q.RatingWindow + " rating  ·  " + q.PlayersSearching + " searching", Theme.SmallSize + 2, TextAnchor.MiddleCenter, Theme.TextDim);
        if (UiKit.Button(new Rect(panel.x + 60f, panel.y + 186f, panel.width - 120f, 56f), "CANCEL", !busy))
            _ = Do(async () => { await ranked.CancelAsync(); Go(Page.Ranked); });
    }

    // ---------------------------------------------------------------- party (ranked duo)
    private void DrawParty()
    {
        UiKit.Title("DUO PARTY");
        var w = Mathf.Min(UiKit.W - 60f, 560f);
        var x = (UiKit.W - w) / 2f;
        var party = ranked.Party;
        if (party == null)
        {
            _ = RefreshParty();
            UiKit.Text(new Rect(x, 120f, w, 80f), "Ranked teams are two friends who chose each other. Make a party and share the code, or type a friend's code.", Theme.BodySize);
            if (UiKit.Button(new Rect(x, 220f, w, 70f), "MAKE A PARTY", !busy, true)) _ = Do(async () => { await ranked.CreatePartyAsync(); });
            UiKit.Text(new Rect(x, 320f, w, 40f), "or join a friend's", Theme.SmallSize + 2, TextAnchor.MiddleCenter, Theme.TextDim);
            partyCode = UiKit.TextField(new Rect(x, 366f, w * 0.55f, 60f), partyCode.ToUpperInvariant(), 8);
            if (UiKit.Button(new Rect(x + w * 0.6f, 366f, w * 0.4f, 60f), "JOIN", !busy && partyCode.Length >= 4, false, Theme.BodySize))
                _ = Do(async () => { await ranked.JoinPartyAsync(partyCode); partyCode = ""; });
        }
        else
        {
            UiKit.Text(new Rect(x, 110f, w, 30f), "Share this code", Theme.SmallSize + 2, TextAnchor.MiddleCenter, Theme.TextDim);
            UiKit.Text(new Rect(x, 140f, w, 90f), party.Code, 72, TextAnchor.MiddleCenter, Theme.Cyan);
            var y = 250f;
            foreach (var m in party.Members)
            {
                UiKit.Text(new Rect(x, y, w, 40f), m.Value + (m.Key == account.Account.Id ? "  (you)" : ""), Theme.HeadingSize);
                y += 44f;
            }
            if (!party.Full) UiKit.Text(new Rect(x, y, w, 40f), "Waiting for your partner…", Theme.BodySize, TextAnchor.MiddleCenter, Theme.TextDim);
            y = Mathf.Max(y + 20f, 400f);
            if (UiKit.Button(new Rect(x, y, w, 76f), "FIND A MATCH", !busy && party.Full, true))
                _ = Do(async () => { await ranked.JoinAsync("teams"); Go(Page.Searching); nextPoll = 0; });
            if (UiKit.Link(new Rect(x, y + 90f, w, 44f), "Leave party", Theme.BodySize, Theme.TextDim)) _ = Do(async () => { await ranked.LeavePartyAsync(); });
            GUIUtility.systemCopyBuffer = party.Code;
        }
        if (UiKit.Back()) Go(Page.Ranked);
    }

    private float nextPartyRefresh;
    private async Task RefreshParty()
    {
        if (busy || Time.unscaledTime < nextPartyRefresh) return;
        nextPartyRefresh = Time.unscaledTime + 2f;
        try
        {
            var q = await ranked.PollAsync();
            if (q.IsMatched) OpenMatch(q.MatchId);
        }
        catch (ApiException) { }
    }

    // ---------------------------------------------------------------- friends
    private string friendMode = "1v1", friendWind = "breezy";
    private int friendPlayTo = 21;
    private readonly Dictionary<string, string> friendSeats = new Dictionary<string, string> { { "B1", "human" }, { "A2", "human" }, { "B2", "bot" } };

    private void DrawFriends()
    {
        UiKit.Title("PLAY WITH FRIENDS");
        var w = Mathf.Min(UiKit.W - 60f, 620f);
        var x = (UiKit.W - w) / 2f;
        var y = 110f;
        UiKit.Text(new Rect(x, y, w, 30f), "Match setup", Theme.SmallSize + 2, TextAnchor.MiddleLeft, Theme.TextDim);
        y += 34f;
        var third = (w - 20f) / 3f;
        if (UiKit.Button(new Rect(x, y, third * 1.5f, 52f), "1 v 1", !busy, friendMode == "1v1", Theme.BodySize)) friendMode = "1v1";
        if (UiKit.Button(new Rect(x + third * 1.5f + 20f, y, third * 1.5f, 52f), "2 v 2", !busy, friendMode == "2v2", Theme.BodySize)) friendMode = "2v2";
        y += 68f;
        var q = (w - 30f) / 3f;
        foreach (var target in new[] { 11, 15, 21 })
        {
            if (UiKit.Button(new Rect(x + Array.IndexOf(new[] { 11, 15, 21 }, target) * (q + 15f), y, q, 52f), "to " + target, !busy, friendPlayTo == target, Theme.BodySize)) friendPlayTo = target;
        }
        y += 68f;
        var winds = new[] { "off", "light", "breezy", "gusty" };
        var wq = (w - 45f) / 4f;
        for (var i = 0; i < winds.Length; i++)
            if (UiKit.Button(new Rect(x + i * (wq + 15f), y, wq, 52f), winds[i].ToUpperInvariant(), !busy, friendWind == winds[i], Theme.SmallSize + 2)) friendWind = winds[i];
        UiKit.Text(new Rect(x, y + 54f, w, 28f), "Wind", Theme.SmallSize, TextAnchor.MiddleCenter, Theme.TextDim);
        y += 96f;
        if (friendMode == "2v2")
        {
            foreach (var seat in new[] { "A2", "B1", "B2" })
            {
                var label = seat == "A2" ? "Your partner" : (seat == "B1" ? "Opponent 1" : "Opponent 2");
                UiKit.Text(new Rect(x, y, w * 0.4f, 46f), label, Theme.BodySize, TextAnchor.MiddleLeft);
                if (UiKit.Button(new Rect(x + w * 0.45f, y, w * 0.55f, 46f), friendSeats[seat] == "human" ? "FRIEND" : "BOT", !busy, friendSeats[seat] == "human", Theme.SmallSize + 2))
                    friendSeats[seat] = friendSeats[seat] == "human" ? "bot" : "human";
                y += 54f;
            }
        }
        if (UiKit.Button(new Rect(x, y + 10f, w, 70f), "CREATE MATCH", !busy, true))
            _ = Do(async () =>
            {
                var seats = new Dictionary<string, object>();
                if (friendMode == "1v1") seats["B1"] = J.Make("kind", "human");
                else foreach (var s in friendSeats) seats[s.Key] = s.Value == "human" ? J.Make("kind", "human") : J.Make("kind", "bot", "level", "regular");
                var r = await api.CreateMatch(J.Make("mode", friendMode, "playTo", (double)friendPlayTo, "wind", friendWind), seats);
                OpenMatch(J.Str(r, "matchId"));
            });
        y += 100f;
        UiKit.Text(new Rect(x, y, w, 30f), "or join a friend's match", Theme.SmallSize + 2, TextAnchor.MiddleCenter, Theme.TextDim);
        joinCode = UiKit.TextField(new Rect(x, y + 34f, w * 0.6f, 56f), joinCode.ToUpperInvariant(), 8);
        if (UiKit.Button(new Rect(x + w * 0.65f, y + 34f, w * 0.35f, 56f), "JOIN", !busy && joinCode.Length >= 6, false, Theme.BodySize)) { var c = joinCode; _ = Do(() => JoinFriend(c)); }
        if (UiKit.Back()) Go(Page.Menu);
    }

    private async Task JoinFriend(string code)
    {
        var r = await api.JoinMatch(code.Trim().ToUpperInvariant());
        joinCode = "";
        OpenMatch(J.Str(r, "matchId"));
    }

    /// <summary>iplaycornhole://join/CODE (or the https invite link) opens straight into the match.</summary>
    private void OnDeepLink(string url)
    {
        if (string.IsNullOrEmpty(url)) return;
        var i = url.LastIndexOf("/join/", StringComparison.Ordinal);
        if (i < 0) return;
        var code = url.Substring(i + 6).Split('?', '#', '/')[0].Trim().ToUpperInvariant();
        if (code.Length >= 6 && code.Length <= 12) pendingInviteCode = code;
    }

    // ---------------------------------------------------------------- leaderboards
    private string boardMode = "singles";
    private int boardOffset;
    private BoardPage boardPage;
    private List<MyStanding> boardMine;

    private void OpenLeaderboards() { boardOffset = 0; boardPage = null; boardMine = null; Go(Page.Leaderboards); _ = Do(LoadBoard); }

    private async Task LoadBoard()
    {
        boardPage = await boards.PageAsync(boardMode, boardOffset, 25);
        boardMine = await boards.MineAsync(boardMode);
    }

    private void DrawLeaderboards()
    {
        UiKit.Title("LEADERBOARDS", 24f);
        var w = Mathf.Min(UiKit.W - 40f, 700f);
        var x = (UiKit.W - w) / 2f;
        if (UiKit.Button(new Rect(x, 90f, w / 2f - 8f, 50f), "SINGLES", !busy, boardMode == "singles", Theme.BodySize)) { boardMode = "singles"; boardOffset = 0; _ = Do(LoadBoard); }
        if (UiKit.Button(new Rect(x + w / 2f + 8f, 90f, w / 2f - 8f, 50f), "TEAMS", !busy, boardMode == "teams", Theme.BodySize)) { boardMode = "teams"; boardOffset = 0; _ = Do(LoadBoard); }

        var y = 150f;
        if (boardMine != null)
        {
            var mineText = boardMine.Count == 0
                ? "Play " + (boardPage != null ? boardPage.MinGames : 10) + " ranked games to get a rank."
                : DescribeStanding(boardMine[0]);
            UiKit.Text(new Rect(x, y, w, 40f), mineText, Theme.SmallSize + 4, TextAnchor.MiddleCenter, Theme.SoftCyan);
        }
        y += 48f;
        if (boardPage == null) { UiKit.Text(new Rect(x, y + 40f, w, 40f), "Loading…", Theme.BodySize, TextAnchor.MiddleCenter, Theme.TextDim); }
        else if (boardPage.Entries.Count == 0) { UiKit.Text(new Rect(x, y + 40f, w, 80f), "Nobody is ranked yet. Be the first.", Theme.BodySize, TextAnchor.MiddleCenter, Theme.TextDim); }
        else
        {
            var rowH = UiKit.Portrait ? 52f : 44f;
            foreach (var e in boardPage.Entries)
            {
                var me = false;
                foreach (var m in e.Members) if (m.Key == account.Account.Id) me = true;
                var row = new Rect(x, y, w, rowH - 4f);
                if (me) UiKit.Fill(row, new Rgba(0.05f, 0.16f, 0.2f));
                UiKit.Text(new Rect(x + 8f, y, 60f, rowH - 4f), e.Rank.ToString(), Theme.BodySize, TextAnchor.MiddleLeft, Theme.RankColor(e.Rank));
                UiKit.Text(new Rect(x + 70f, y, w - 250f, rowH - 4f), e.Names, Theme.BodySize, TextAnchor.MiddleLeft, me ? Theme.SoftCyan : Theme.Text);
                UiKit.Text(new Rect(x + w - 180f, y, 90f, rowH - 4f), e.Rating.ToString(), Theme.BodySize, TextAnchor.MiddleRight, Theme.GoldLight);
                UiKit.Text(new Rect(x + w - 88f, y, 84f, rowH - 4f), e.Wins + "-" + e.Losses, Theme.SmallSize, TextAnchor.MiddleRight, Theme.StreakColor(e.Streak));
                y += rowH;
                if (y > UiKit.H - 130f) break;
            }
            if (boardOffset > 0 && UiKit.Link(new Rect(x, UiKit.H - 78f, 120f, 48f), "< Prev", Theme.BodySize)) { boardOffset = Math.Max(0, boardOffset - 25); _ = Do(LoadBoard); }
            if (boardPage.Next.HasValue && UiKit.Link(new Rect(x + w - 120f, UiKit.H - 78f, 120f, 48f), "Next >", Theme.BodySize)) { boardOffset = boardPage.Next.Value; _ = Do(LoadBoard); }
        }
        if (UiKit.Back()) Go(Page.Menu);
    }

    private static string DescribeStanding(MyStanding s)
    {
        if (s.Rank.HasValue) return "You're #" + s.Rank.Value + "  ·  " + s.Rating;
        if (s.HiddenReason == "opted_out") return "You're hidden from the board (Profile: Show me on the leaderboards)";
        if (s.HiddenReason == "inactive") return "Play a ranked game to get back on the board";
        return s.GamesNeeded + " more ranked games to get a rank  ·  " + s.Rating;
    }

    // ---------------------------------------------------------------- profile
    private void DrawProfile()
    {
        UiKit.Title("PROFILE", 24f);
        var w = Mathf.Min(UiKit.W - 60f, 560f);
        var x = (UiKit.W - w) / 2f;
        var a = account.Account;
        var y = 100f;
        UiKit.Text(new Rect(x, y, w, 30f), "Name", Theme.SmallSize + 2, TextAnchor.MiddleLeft, Theme.TextDim);
        nameDraft = UiKit.TextField(new Rect(x, y + 32f, w * 0.68f, 56f), nameDraft ?? a.DisplayName, 20);
        if (UiKit.Button(new Rect(x + w * 0.72f, y + 32f, w * 0.28f, 56f), "SAVE", !busy && nameDraft != a.DisplayName && nameDraft.Length >= 3, false, Theme.BodySize))
            _ = Do(async () => { await api.Rename(nameDraft); await account.RefreshAsync(); account.SavedName = account.Account.DisplayName; Say("Name saved"); });
        y += 108f;
        var show = UiKit.Toggle(new Rect(x, y, w, 50f), "Show me on the leaderboards", a.ShowOnLeaderboards);
        if (show != a.ShowOnLeaderboards) _ = Do(async () => { await api.SetLeaderboardVisibility(show); await account.RefreshAsync(); });
        y += 62f;

        if (a.IsGuest)
        {
            UiKit.Text(new Rect(x, y, w, 60f), "You're playing as a guest. Add a sign-in so you never lose your rating if you change phones.", Theme.SmallSize + 2, TextAnchor.MiddleCenter, Theme.Gold);
            y += 66f;
            foreach (var provider in IdentityProviders)
            {
                var name = provider.Name;
                var on = J.Bool(J.Obj(account.Meta, "signIn"), name);
                if (!on) continue;
                var p = provider;
                if (UiKit.Button(new Rect(x, y, w, 56f), "Sign in with " + (name == "apple" ? "Apple" : "Google"), !busy, false, Theme.BodySize))
                    _ = Do(async () =>
                    {
                        var res = await p.SignInAsync();
                        if (res == null) return;
                        if (name == "apple") await account.LinkAppleAsync(res.Token, res.Nonce); else await account.LinkGoogleAsync(res.Token, res.Nonce);
                        Say("Signed in");
                    });
                y += 64f;
            }
        }

        if (UiKit.Link(new Rect(x, y, w / 2f, 44f), "Terms")) OpenUrl(server.TermsUrl);
        if (UiKit.Link(new Rect(x + w / 2f, y, w / 2f, 44f), "Privacy")) OpenUrl(server.PrivacyUrl);
        y += 50f;
        if (UiKit.Link(new Rect(x, y, w / 2f, 44f), "Help & support")) OpenUrl(server.SupportUrl);
        if (UiKit.Link(new Rect(x + w / 2f, y, w / 2f, 44f), "Download my data")) _ = Do(ExportData);
        y += 60f;

        if (!deleteConfirm)
        {
            if (UiKit.Link(new Rect(x, y, w / 2f, 44f), "Sign out", Theme.BodySize, Theme.TextDim)) { if (a.IsGuest) signOutConfirm = true; else _ = Do(SignOut); }
            if (UiKit.Link(new Rect(x + w / 2f, y, w / 2f, 44f), "Delete my account", Theme.BodySize, Theme.Hot)) deleteConfirm = true;
        }
        else
        {
            UiKit.Text(new Rect(x, y, w, 60f), "This erases your account, rating and stats for good.", Theme.BodySize, TextAnchor.MiddleCenter, Theme.Hot);
            if (UiKit.Button(new Rect(x, y + 64f, w / 2f - 8f, 54f), "KEEP IT", !busy, false, Theme.BodySize)) deleteConfirm = false;
            if (UiKit.Button(new Rect(x + w / 2f + 8f, y + 64f, w / 2f - 8f, 54f), "DELETE", !busy, false, Theme.BodySize)) _ = Do(async () => { await account.DeleteAccountAsync(); deleteConfirm = false; ranked.Reset(); introStarted = Time.unscaledTime - IntroSeconds; screen = Page.Intro; });
        }
        if (signOutConfirm)
        {
            var r = UiKit.Center(560f, 230f);
            UiKit.Panel(r, true);
            UiKit.Text(new Rect(r.x + 20f, r.y + 16f, r.width - 40f, 100f), "Guests who sign out lose their account for good. Sign out anyway?", Theme.BodySize);
            if (UiKit.Button(new Rect(r.x + 20f, r.y + 140f, r.width / 2f - 30f, 60f), "STAY", !busy, false, Theme.BodySize)) signOutConfirm = false;
            if (UiKit.Button(new Rect(r.x + r.width / 2f + 10f, r.y + 140f, r.width / 2f - 30f, 60f), "SIGN OUT", !busy, false, Theme.BodySize)) { signOutConfirm = false; _ = Do(SignOut); }
        }
        if (UiKit.Back()) Go(Page.Menu);
    }

    private async Task SignOut()
    {
        await account.SignOutAsync();
        introStarted = Time.unscaledTime - IntroSeconds;
        screen = Page.Intro;
    }

    private async Task ExportData()
    {
        var data = await api.ExportMyData();
        var path = Path.Combine(Application.persistentDataPath, "iplay-cornhole-my-data.json");
        File.WriteAllText(path, MiniJson.Serialize(data));
        Say("Saved to " + path, 6f);
    }

    // ---------------------------------------------------------------- settings
    private void DrawSettings()
    {
        UiKit.Title("SETTINGS", 24f);
        var w = Mathf.Min(UiKit.W - 60f, 560f);
        var x = (UiKit.W - w) / 2f;
        var y = 110f;
        Func<string, bool, bool> row = (label, value) => { var v = UiKit.Toggle(new Rect(x, y, w, 52f), label, value); y += 60f; return v; };
        var sound = row("Sound", settings.Sound);
        if (sound != settings.Sound) { settings.Sound = sound; sounds.Enabled = sound; }
        settings.Voice = row("Voice chat", settings.Voice);
        settings.StartMuted = row("Start with my mic muted", settings.StartMuted);
        settings.LeftHanded = row("Left-handed", settings.LeftHanded);
        settings.AimAssist = row("Aim helper in casual games", settings.AimAssist);
        settings.ReduceMotion = row("Softer lights (no flashing)", settings.ReduceMotion);
        settings.Tutorial = row("Tutorial tips", settings.Tutorial);
        UiKit.Text(new Rect(x, y, w, 60f), "Ranked never shows the aim helper.", Theme.SmallSize, TextAnchor.MiddleCenter, Theme.TextDim);
        if (UiKit.Back()) Go(Page.Menu);
    }
}
