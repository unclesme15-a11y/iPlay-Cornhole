using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace IPlay.Cornhole
{
    // ====================================================================== storage
    /// <summary>Tiny key/value storage. Unity uses PlayerPrefs; tests use a dictionary.</summary>
    public interface IKeyValueStore
    {
        string Get(string key);
        void Set(string key, string value);
        void Delete(string key);
    }

    public sealed class MemoryStore : IKeyValueStore
    {
        private readonly Dictionary<string, string> data = new Dictionary<string, string>();
        public string Get(string key) { string v; return data.TryGetValue(key, out v) ? v : null; }
        public void Set(string key, string value) { data[key] = value; }
        public void Delete(string key) { data.Remove(key); }
    }

    // ====================================================================== account
    public sealed class AccountState
    {
        public string Id, DisplayName;
        public bool IsGuest, AdultConfirmed, NeedsTermsAccept, ShowOnLeaderboards;
        public int CurrentTermsVersion;
        public string ActiveMatchId;
        public double SinglesRating = 1200;
        public int SinglesGames;

        public static AccountState FromMe(Dictionary<string, object> me)
        {
            var a = J.Obj(me, "account");
            var singles = J.Obj(J.Obj(me, "ratings"), "singles");
            return new AccountState
            {
                Id = J.Str(a, "id"),
                DisplayName = J.Str(a, "displayName"),
                IsGuest = J.Bool(a, "isGuest"),
                AdultConfirmed = J.Bool(a, "adultConfirmed"),
                NeedsTermsAccept = J.Bool(a, "needsTermsAccept"),
                ShowOnLeaderboards = J.Bool(a, "showOnLeaderboards", true),
                CurrentTermsVersion = J.Int(a, "currentTermsVersion", 1),
                ActiveMatchId = J.Str(me, "activeMatchId"),
                SinglesRating = J.Num(singles, "rating", 1200),
                SinglesGames = J.Int(singles, "games"),
            };
        }
    }

    /// <summary>What the app should do next after start-up checks.</summary>
    public enum StartupOutcome
    {
        /// <summary>Show the 18+ screen. Nothing else until they confirm.</summary>
        NeedAdultGate,
        /// <summary>They said they are under 18. Show the "this game is for adults" screen.</summary>
        AdultDenied,
        /// <summary>Signed in and ready: go to the main menu.</summary>
        Ready,
        /// <summary>Ready, but the terms changed: ask them to accept before ranked or voice.</summary>
        NeedTerms,
        /// <summary>They were in a match when the app closed: offer to rejoin.</summary>
        RejoinMatch,
        /// <summary>This version of the app is too old.</summary>
        UpdateRequired,
        /// <summary>The server is being updated.</summary>
        Maintenance,
        /// <summary>The account is banned (details in the error).</summary>
        Banned,
        /// <summary>No connection to the server.</summary>
        Offline,
    }

    /// <summary>
    /// Start-up and sign-in: remembers the 18+ answer and the session token, checks the server, and says
    /// what screen comes next. Guests sign in without a password; Apple/Google can be attached later.
    /// </summary>
    public sealed class AccountSession
    {
        public const string AdultKey = "iPlay.Cornhole.AdultConfirmed";
        public const string TokenKey = "iPlay.Cornhole.Session";
        public const string NameKey = "iPlay.Cornhole.DisplayName";

        private readonly ApiClient api;
        private readonly IKeyValueStore store;

        public AccountSession(ApiClient api, IKeyValueStore store)
        {
            this.api = api;
            this.store = store;
        }

        public AccountState Account { get; private set; }
        public Dictionary<string, object> Meta { get; private set; }
        public ThrowGuide Guide { get; private set; }
        public ApiException LastError { get; private set; }

        public bool AdultConfirmedLocally { get { return store.Get(AdultKey) == "1"; } }
        public bool AdultDeniedLocally { get { return store.Get(AdultKey) == "0"; } }

        /// <summary>The player answered the 18+ screen. Under 18 is remembered too, so they cannot just relaunch.</summary>
        public void AnswerAdultGate(bool adult) { store.Set(AdultKey, adult ? "1" : "0"); }

        public string SavedName { get { return store.Get(NameKey); } set { store.Set(NameKey, value); } }

        /// <summary>Call once at launch, after the logo.</summary>
        public async Task<StartupOutcome> StartAsync()
        {
            LastError = null;
            if (AdultDeniedLocally) return StartupOutcome.AdultDenied;
            if (!AdultConfirmedLocally) return StartupOutcome.NeedAdultGate;
            try
            {
                var version = await api.Version().ConfigureAwait(false);
                if (J.Bool(version, "maintenance")) { /* still allowed to look around; new matches will say so */ }
                Meta = await api.Meta().ConfigureAwait(false);
                Guide = ThrowGuide.FromMeta(Meta);

                api.Token = store.Get(TokenKey);
                if (string.IsNullOrEmpty(api.Token) || !await TryLoadMe().ConfigureAwait(false))
                {
                    var r = await api.GuestSignIn(SavedName, true).ConfigureAwait(false);
                    store.Set(TokenKey, api.Token);
                    var a = J.Obj(r, "account");
                    if (SavedName == null) SavedName = J.Str(a, "displayName");
                    await TryLoadMe().ConfigureAwait(false);
                }
            }
            catch (ApiException e)
            {
                LastError = e;
                if (e.IsOutdatedClient) return StartupOutcome.UpdateRequired;
                if (e.IsBanned) return StartupOutcome.Banned;
                if (e.IsMaintenance) return StartupOutcome.Maintenance;
                if (e.IsNetwork) return StartupOutcome.Offline;
                throw;
            }
            if (Account == null) return StartupOutcome.Offline;
            if (Account.ActiveMatchId != null) return StartupOutcome.RejoinMatch;
            if (Account.NeedsTermsAccept) return StartupOutcome.NeedTerms;
            return StartupOutcome.Ready;
        }

        /// <summary>Loads /api/me. False (and the saved token is dropped) if the session has expired.</summary>
        private async Task<bool> TryLoadMe()
        {
            try
            {
                Account = AccountState.FromMe(await api.Me().ConfigureAwait(false));
                return true;
            }
            catch (ApiException e) when (e.IsAuth)
            {
                store.Delete(TokenKey);
                api.Token = null;
                return false;
            }
        }

        public async Task RefreshAsync()
        {
            Account = AccountState.FromMe(await api.Me().ConfigureAwait(false));
        }

        /// <summary>Accept the current terms (after the app showed them).</summary>
        public async Task AcceptTermsAsync()
        {
            await api.AcceptTerms(Account.CurrentTermsVersion).ConfigureAwait(false);
            await RefreshAsync().ConfigureAwait(false);
        }

        /// <summary>For accounts from before adults-only: confirm after the 18+ tick.</summary>
        public async Task ConfirmAdultOnServerAsync()
        {
            await api.ConfirmAdult().ConfigureAwait(false);
            await RefreshAsync().ConfigureAwait(false);
        }

        /// <summary>Attach an Apple or Google sign-in to the guest account (keeps stats and rating).</summary>
        public async Task LinkAppleAsync(string identityToken, string nonce)
        {
            await api.AppleSignIn(identityToken, nonce, null, true).ConfigureAwait(false);
            store.Set(TokenKey, api.Token);
            await RefreshAsync().ConfigureAwait(false);
        }

        public async Task LinkGoogleAsync(string idToken, string nonce)
        {
            await api.GoogleSignIn(idToken, nonce, null, true).ConfigureAwait(false);
            store.Set(TokenKey, api.Token);
            await RefreshAsync().ConfigureAwait(false);
        }

        public async Task SignOutAsync()
        {
            try { await api.Logout().ConfigureAwait(false); } catch (ApiException) { }
            store.Delete(TokenKey);
            api.Token = null;
            Account = null;
        }

        /// <summary>Erase the account on the server and forget everything on the phone (required by the app stores).</summary>
        public async Task DeleteAccountAsync()
        {
            await api.DeleteAccount().ConfigureAwait(false);
            store.Delete(TokenKey);
            store.Delete(NameKey);
            api.Token = null;
            Account = null;
        }
    }

    // ====================================================================== ranked
    public sealed class QueueStatus
    {
        /// <summary>idle, searching, matched, expired or cooldown.</summary>
        public string Status = "idle";
        public string Mode, MatchId, CooldownUntil;
        public int WaitedSec, RatingWindow, PlayersSearching;
        public PartyInfo Party;

        public bool IsSearching { get { return Status == "searching"; } }
        public bool IsMatched { get { return Status == "matched"; } }

        public static QueueStatus From(Dictionary<string, object> d)
        {
            var q = new QueueStatus
            {
                Status = J.Str(d, "status", "idle"), Mode = J.Str(d, "mode"), MatchId = J.Str(d, "matchId"),
                CooldownUntil = J.Str(d, "until"),
                WaitedSec = J.Int(d, "waitedSec"), RatingWindow = J.Int(d, "ratingWindow"), PlayersSearching = J.Int(d, "playersSearching"),
            };
            var party = J.Obj(d, "party");
            if (party != null) q.Party = PartyInfo.From(party);
            return q;
        }
    }

    public sealed class PartyInfo
    {
        public string Code;
        public bool Full;
        public List<KeyValuePair<string, string>> Members = new List<KeyValuePair<string, string>>(); // accountId, name

        public static PartyInfo From(Dictionary<string, object> p)
        {
            var info = new PartyInfo { Code = J.Str(p, "code"), Full = J.Bool(p, "full") };
            var members = J.Arr(p, "members");
            if (members != null) foreach (var m in members) info.Members.Add(new KeyValuePair<string, string>(J.Str(m, "accountId"), J.Str(m, "displayName")));
            return info;
        }
    }

    /// <summary>
    /// "Finding opponents": join the queue, ask for the answer every couple of seconds, and hand back the
    /// match to connect to. Also owns the duo party (make one, share the code, a friend joins).
    /// </summary>
    public sealed class RankedFlow
    {
        /// <summary>How often the app should call <see cref="PollAsync"/> while it shows "Finding opponents".</summary>
        public const double PollSeconds = 2.0;

        private readonly ApiClient api;
        public RankedFlow(ApiClient api) { this.api = api; }

        public QueueStatus Current { get; private set; } = new QueueStatus();
        public PartyInfo Party { get; private set; }

        public event Action<string> Matched;

        /// <summary>Forget everything (after signing out or deleting the account).</summary>
        public void Reset() { Current = new QueueStatus(); Party = null; }

        public async Task<QueueStatus> JoinAsync(string mode)
        {
            Current = QueueStatus.From(await api.RankedJoin(mode).ConfigureAwait(false));
            return Current;
        }

        public async Task<QueueStatus> PollAsync()
        {
            var before = Current.Status;
            Current = QueueStatus.From(await api.RankedStatus().ConfigureAwait(false));
            Party = Current.Party;
            if (Current.IsMatched && before != "matched")
            {
                var h = Matched;
                if (h != null) h(Current.MatchId);
            }
            return Current;
        }

        public async Task CancelAsync()
        {
            await api.RankedLeave().ConfigureAwait(false);
            Current = new QueueStatus();
        }

        public async Task<PartyInfo> CreatePartyAsync()
        {
            Party = PartyInfo.From(J.Obj(await api.PartyCreate().ConfigureAwait(false), "party"));
            return Party;
        }

        public async Task<PartyInfo> JoinPartyAsync(string code)
        {
            Party = PartyInfo.From(J.Obj(await api.PartyJoin(code.Trim()).ConfigureAwait(false), "party"));
            return Party;
        }

        public async Task LeavePartyAsync()
        {
            await api.PartyLeave().ConfigureAwait(false);
            Party = null;
        }
    }

    // ====================================================================== leaderboards
    public sealed class BoardEntry
    {
        public int Rank, Rating, Peak, Games, Wins, Losses, Streak;
        public List<KeyValuePair<string, string>> Members = new List<KeyValuePair<string, string>>();
        public string Names { get { var n = new List<string>(); foreach (var m in Members) n.Add(m.Value); return string.Join(" & ", n.ToArray()); } }
        public static BoardEntry From(object o)
        {
            var e = new BoardEntry
            {
                Rank = J.Int(o, "rank"), Rating = J.Int(o, "rating"), Peak = J.Int(o, "peak"), Games = J.Int(o, "games"),
                Wins = J.Int(o, "wins"), Losses = J.Int(o, "losses"), Streak = J.Int(o, "streak"),
            };
            var members = J.Arr(o, "members");
            if (members != null) foreach (var m in members) e.Members.Add(new KeyValuePair<string, string>(J.Str(m, "accountId"), J.Str(m, "displayName")));
            return e;
        }
    }

    public sealed class BoardPage
    {
        public string Mode;
        public int Total, MinGames, ActiveDays;
        public int? Next;
        public List<BoardEntry> Entries = new List<BoardEntry>();
    }

    public sealed class MyStanding
    {
        public int Rating, Games, GamesNeeded;
        public int? Rank;
        public string HiddenReason; // opted_out, inactive or null
        public List<BoardEntry> Neighbours = new List<BoardEntry>();
        public List<KeyValuePair<string, string>> Members = new List<KeyValuePair<string, string>>();
    }

    public sealed class Leaderboards
    {
        private readonly ApiClient api;
        public Leaderboards(ApiClient api) { this.api = api; }

        public async Task<BoardPage> PageAsync(string mode, int offset = 0, int limit = 50)
        {
            var d = await api.Leaderboard(mode, limit, offset).ConfigureAwait(false);
            var page = new BoardPage { Mode = mode, Total = J.Int(d, "total"), MinGames = J.Int(d, "minGames"), ActiveDays = J.Int(d, "activeDays") };
            if (J.Has(d, "next")) page.Next = J.Int(d, "next");
            var entries = J.Arr(d, "entries");
            if (entries != null) foreach (var e in entries) page.Entries.Add(BoardEntry.From(e));
            return page;
        }

        public async Task<List<MyStanding>> MineAsync(string mode)
        {
            var d = await api.LeaderboardMe(mode).ConfigureAwait(false);
            var list = new List<MyStanding>();
            var standings = J.Arr(d, "standings");
            if (standings != null)
                foreach (var s in standings)
                {
                    var m = new MyStanding { Rating = J.Int(s, "rating"), Games = J.Int(s, "games"), GamesNeeded = J.Int(s, "gamesNeeded"), HiddenReason = J.Str(s, "hiddenReason") };
                    if (J.Has(s, "rank")) m.Rank = J.Int(s, "rank");
                    var near = J.Arr(s, "neighbours");
                    if (near != null) foreach (var e in near) m.Neighbours.Add(BoardEntry.From(e));
                    var members = J.Arr(s, "members");
                    if (members != null) foreach (var mm in members) m.Members.Add(new KeyValuePair<string, string>(J.Str(mm, "accountId"), J.Str(mm, "displayName")));
                    list.Add(m);
                }
            return list;
        }
    }

    // ====================================================================== ads
    /// <summary>
    /// Ad pacing, from the server's rules (GET /api/meta -> ads). Ads never show during a match, only after
    /// enough finished matches and enough time, only with consent, and never when the server has them off.
    /// The actual ad SDK (AppLovin MAX) is asked only when <see cref="ShouldShowInterstitial"/> says yes.
    /// </summary>
    public sealed class AdPacer
    {
        private bool enabled;
        private int everyN = 3;
        private double minSeconds = 180;
        private bool menuBanner = true;
        private int matchesSince;
        private double lastShown = double.NegativeInfinity;

        /// <summary>True from the coin toss to the results screen. Set by the match screen.</summary>
        public bool InMatch;
        /// <summary>The player has answered the consent (EU/UK) and tracking (Apple) prompts.</summary>
        public bool ConsentGiven;

        public void Configure(Dictionary<string, object> meta)
        {
            var ads = J.Obj(meta, "ads");
            enabled = J.Bool(ads, "enabled");
            everyN = Math.Max(1, J.Int(ads, "interstitialEveryNMatches", 3));
            minSeconds = Math.Max(30, J.Num(ads, "minSecondsBetweenInterstitials", 180));
            menuBanner = J.Bool(ads, "menuBanner", true);
        }

        public bool Enabled { get { return enabled; } }
        public int MatchesSinceLastAd { get { return matchesSince; } }

        public void MatchFinished() { matchesSince++; }

        /// <summary>A banner is allowed on menu screens only, never in a match.</summary>
        public bool ShouldShowMenuBanner { get { return enabled && menuBanner && ConsentGiven && !InMatch; } }

        public bool ShouldShowInterstitial(double nowSeconds)
        {
            return enabled && ConsentGiven && !InMatch && matchesSince >= everyN && nowSeconds - lastShown >= minSeconds;
        }

        public void InterstitialShown(double nowSeconds)
        {
            lastShown = nowSeconds;
            matchesSince = 0;
        }
    }

    // ====================================================================== voice
    /// <summary>
    /// Which voice channels the player may use (POST /api/matches/:id/voice). Tokens are fetched separately, for the
    /// Vivox identity the SDK picks, with <see cref="ApiClient.VoiceToken"/>.
    /// </summary>
    public sealed class VoiceGrant
    {
        /// <summary>Log in to Vivox with this display name (it is the account id, so phones can match speakers to players).</summary>
        public string DisplayName;
        public string TableName, TableUri;
        public string TeamName, TeamUri; // null in 1v1
        public List<string> Mute = new List<string>();
        public List<VoicePlayer> Roster = new List<VoicePlayer>();

        public static VoiceGrant From(Dictionary<string, object> d)
        {
            var table = J.Obj(d, "table");
            var team = J.Obj(d, "team");
            var g = new VoiceGrant { DisplayName = J.Str(d, "displayName"), TableName = J.Str(table, "name"), TableUri = J.Str(table, "uri") };
            if (team != null) { g.TeamName = J.Str(team, "name"); g.TeamUri = J.Str(team, "uri"); }
            var mute = J.Arr(d, "mute");
            if (mute != null) foreach (var m in mute) g.Mute.Add(m as string);
            var roster = J.Arr(d, "roster");
            if (roster != null) foreach (var r in roster) g.Roster.Add(new VoicePlayer { Seat = J.Str(r, "seat"), Team = J.Str(r, "team"), Username = J.Str(r, "username"), DisplayName = J.Str(r, "displayName") });
            return g;
        }

        public string NameOf(string username)
        {
            foreach (var r in Roster) if (r.Username == username) return r.DisplayName;
            return username;
        }

        public bool ShouldMute(string username) { return Mute.Contains(username); }
    }

    public sealed class VoicePlayer { public string Seat, Team, Username, DisplayName; }
}
