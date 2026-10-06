using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading.Tasks;

namespace IPlay.Cornhole
{
    public sealed class HttpResult
    {
        public int Status;
        public string Body;
    }

    /// <summary>The one place that actually touches the network. Unity uses UnityWebRequest; tests use HttpClient.</summary>
    public interface IHttpTransport
    {
        Task<HttpResult> SendAsync(string method, string url, IDictionary<string, string> headers, string body);
    }

    /// <summary>Every failed call ends up as one of these. Switch on <see cref="Code"/>, never on the message.</summary>
    public sealed class ApiException : Exception
    {
        public readonly int Status;
        public readonly string Code;
        public readonly Dictionary<string, object> Details;

        public ApiException(int status, string code, string message, Dictionary<string, object> details = null) : base(message)
        {
            Status = status;
            Code = code;
            Details = details ?? new Dictionary<string, object>();
        }

        /// <summary>The phone could not reach the server at all (no signal, server down).</summary>
        public bool IsNetwork { get { return Status == 0; } }
        public bool IsAuth { get { return Status == 401; } }
        public bool IsOutdatedClient { get { return Status == 426; } }
        public bool IsMaintenance { get { return Code == "maintenance"; } }
        public bool IsBanned { get { return Code == "account_banned"; } }
    }

    public sealed class ClientInfo
    {
        /// <summary>Sent as X-Client-Version. Must look like 1.2.3.</summary>
        public string Version = "0.1.0";
        /// <summary>"ios" or "android".</summary>
        public string Platform = "ios";
    }

    /// <summary>
    /// Every REST call the game makes, in one place. Results are parsed JSON (see <see cref="J"/>).
    /// The server decides everything; this only sends what the player did.
    /// </summary>
    public sealed class ApiClient
    {
        private readonly IHttpTransport http;
        private readonly string baseUrl;
        private readonly ClientInfo info;

        /// <summary>The session token from sign-in. Sent as a Bearer token on every call.</summary>
        public string Token;

        public ApiClient(IHttpTransport http, string baseUrl, ClientInfo info)
        {
            if (http == null) throw new ArgumentNullException("http");
            if (string.IsNullOrEmpty(baseUrl)) throw new ArgumentException("baseUrl");
            this.http = http;
            this.baseUrl = baseUrl.TrimEnd('/');
            this.info = info ?? new ClientInfo();
        }

        public string BaseUrl { get { return baseUrl; } }
        public string WebSocketUrl(string matchId) { return baseUrl.Replace("https://", "wss://").Replace("http://", "ws://") + "/api/matches/" + Uri.EscapeDataString(matchId) + "/ws"; }
        public ClientInfo Client { get { return info; } }

        public async Task<Dictionary<string, object>> SendAsync(string method, string path, object body = null)
        {
            var headers = new Dictionary<string, string>
            {
                { "X-Client-Version", info.Version },
                { "X-Client-Platform", info.Platform },
                { "Accept", "application/json" },
            };
            if (!string.IsNullOrEmpty(Token)) headers["Authorization"] = "Bearer " + Token;
            string payload = null;
            if (body != null)
            {
                payload = MiniJson.Serialize(body);
                headers["Content-Type"] = "application/json";
            }
            HttpResult result;
            try
            {
                result = await http.SendAsync(method, baseUrl + path, headers, payload).ConfigureAwait(false);
            }
            catch (ApiException) { throw; }
            catch (Exception e)
            {
                throw new ApiException(0, "network", "Can't reach the server: " + e.Message);
            }
            Dictionary<string, object> json = null;
            if (!string.IsNullOrEmpty(result.Body))
            {
                try { json = MiniJson.Parse(result.Body) as Dictionary<string, object>; }
                catch (FormatException) { /* not JSON (a proxy error page): handled below */ }
            }
            if (result.Status >= 200 && result.Status < 300) return json ?? new Dictionary<string, object>();
            var error = J.Obj(json, "error");
            if (error != null) throw new ApiException(result.Status, J.Str(error, "code", "error"), J.Str(error, "message", "Something went wrong"), error);
            throw new ApiException(result.Status, result.Status >= 500 ? "server_error" : "bad_response", "Unexpected response from the server (" + result.Status + ")");
        }

        private static string Num(double v) { return v.ToString("R", CultureInfo.InvariantCulture); }

        // ---------------------------------------------------------------- start-up
        public Task<Dictionary<string, object>> Version() { return SendAsync("GET", "/api/version"); }
        public Task<Dictionary<string, object>> Meta() { return SendAsync("GET", "/api/meta"); }

        // ---------------------------------------------------------------- sign in
        /// <summary>confirmAdult must be true, and only after the player ticked "I am 18 or older".</summary>
        public async Task<Dictionary<string, object>> GuestSignIn(string displayName, bool confirmAdult)
        {
            var r = await SendAsync("POST", "/api/auth/guest", J.Make("displayName", displayName, "confirmAdult", confirmAdult ? (object)true : null)).ConfigureAwait(false);
            Token = J.Str(r, "token");
            return r;
        }

        public async Task<Dictionary<string, object>> AppleSignIn(string identityToken, string nonce, string displayName, bool confirmAdult)
        {
            var r = await SendAsync("POST", "/api/auth/apple", J.Make("identityToken", identityToken, "nonce", nonce, "displayName", displayName, "confirmAdult", confirmAdult ? (object)true : null)).ConfigureAwait(false);
            Token = J.Str(r, "token");
            return r;
        }

        public async Task<Dictionary<string, object>> GoogleSignIn(string idToken, string nonce, string displayName, bool confirmAdult)
        {
            var r = await SendAsync("POST", "/api/auth/google", J.Make("idToken", idToken, "nonce", nonce, "displayName", displayName, "confirmAdult", confirmAdult ? (object)true : null)).ConfigureAwait(false);
            Token = J.Str(r, "token");
            return r;
        }

        public async Task<Dictionary<string, object>> Logout()
        {
            var r = await SendAsync("POST", "/api/auth/logout").ConfigureAwait(false);
            Token = null;
            return r;
        }

        // ---------------------------------------------------------------- me
        public Task<Dictionary<string, object>> Me() { return SendAsync("GET", "/api/me"); }
        public Task<Dictionary<string, object>> Rename(string displayName) { return SendAsync("PATCH", "/api/me", J.Make("displayName", displayName)); }
        public Task<Dictionary<string, object>> SetLeaderboardVisibility(bool visible) { return SendAsync("PATCH", "/api/me", J.Make("showOnLeaderboards", visible)); }
        public Task<Dictionary<string, object>> AcceptTerms(int version) { return SendAsync("POST", "/api/me/accept-terms", J.Make("version", (double)version)); }
        public Task<Dictionary<string, object>> ConfirmAdult() { return SendAsync("POST", "/api/me/confirm-adult"); }
        public Task<Dictionary<string, object>> DeleteAccount() { return SendAsync("DELETE", "/api/me"); }
        public Task<Dictionary<string, object>> ExportMyData() { return SendAsync("GET", "/api/me/export"); }
        public Task<Dictionary<string, object>> MyMatches(int limit = 20, string before = null)
        {
            return SendAsync("GET", "/api/me/matches?limit=" + limit + (before != null ? "&before=" + Uri.EscapeDataString(before) : ""));
        }

        // ---------------------------------------------------------------- blocks and reports
        public Task<Dictionary<string, object>> Blocks() { return SendAsync("GET", "/api/blocks"); }
        public Task<Dictionary<string, object>> Block(string accountId) { return SendAsync("PUT", "/api/blocks/" + Uri.EscapeDataString(accountId)); }
        public Task<Dictionary<string, object>> Unblock(string accountId) { return SendAsync("DELETE", "/api/blocks/" + Uri.EscapeDataString(accountId)); }
        /// <summary>reason: harassment, cheating, inappropriate_name, underage or other.</summary>
        public Task<Dictionary<string, object>> Report(string accountId, string reason, string matchId = null, string note = null)
        {
            return SendAsync("POST", "/api/reports", J.Make("accountId", accountId, "reason", reason, "matchId", matchId, "note", note));
        }

        // ---------------------------------------------------------------- friendly matches
        /// <param name="config">Match Setup choices (mode, playTo, wind, ...). Null for the defaults.</param>
        /// <param name="seats">e.g. { "B1": { "kind": "human" } }. Null for the defaults.</param>
        public Task<Dictionary<string, object>> CreateMatch(Dictionary<string, object> config = null, Dictionary<string, object> seats = null)
        {
            return SendAsync("POST", "/api/matches", J.Make("config", config, "seats", seats));
        }
        public Task<Dictionary<string, object>> JoinMatch(string matchId, string seat = null) { return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/join", J.Make("seat", seat)); }
        public Task<Dictionary<string, object>> GetMatch(string matchId) { return SendAsync("GET", "/api/matches/" + Uri.EscapeDataString(matchId)); }
        public Task<Dictionary<string, object>> InvitePreview(string code) { return SendAsync("GET", "/api/invites/" + Uri.EscapeDataString(code)); }
        public Task<Dictionary<string, object>> Invite(string matchId) { return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/invite"); }
        public Task<Dictionary<string, object>> StartMatch(string matchId, bool fillOpenWithBots = false)
        {
            return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/start", fillOpenWithBots ? J.Make("fillOpenWithBots", true) : null);
        }
        public Task<Dictionary<string, object>> SetSeat(string matchId, string seat, string kind, string level = null) { return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/seats", J.Make("seat", seat, "kind", kind, "level", level)); }
        public Task<Dictionary<string, object>> Kick(string matchId, string seat) { return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/kick", J.Make("seat", seat)); }
        public Task<Dictionary<string, object>> PickCharacter(string matchId, string characterId) { return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/character", J.Make("characterId", characterId)); }
        public Task<Dictionary<string, object>> PickColor(string matchId, string colorId) { return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/color", J.Make("colorId", colorId)); }
        public Task<Dictionary<string, object>> LeaveMatch(string matchId) { return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/leave"); }
        public Task<Dictionary<string, object>> Rematch(string matchId, bool accept) { return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/rematch", J.Make("accept", accept)); }
        public Task<Dictionary<string, object>> Events(string matchId, int since) { return SendAsync("GET", "/api/matches/" + Uri.EscapeDataString(matchId) + "/events?since=" + since); }

        /// <summary>Send the throw. Aim, power and arc are what the player lined up (never corrected for wind).</summary>
        public Task<Dictionary<string, object>> Throw(string matchId, ThrowCommand t)
        {
            var body = J.Make("power", t.Power, "aim", t.Aim, "arc", t.Arc, "spin", t.Spin, "leftHanded", t.LeftHanded ? (object)true : null);
            if (t.Release != null)
                body["release"] = J.Make("angleDeg", t.Release.AngleDeg, "speed", t.Release.Speed, "holdMs", t.Release.HoldMs, "curve", t.Release.Curve);
            return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/throw", body);
        }

        // ---------------------------------------------------------------- ranked
        /// <summary>mode: "singles" or "teams" (teams needs a full party).</summary>
        public Task<Dictionary<string, object>> RankedJoin(string mode) { return SendAsync("POST", "/api/ranked/queue", J.Make("mode", mode)); }
        public Task<Dictionary<string, object>> RankedStatus() { return SendAsync("GET", "/api/ranked/queue"); }
        public Task<Dictionary<string, object>> RankedLeave() { return SendAsync("DELETE", "/api/ranked/queue"); }
        public Task<Dictionary<string, object>> PartyCreate() { return SendAsync("POST", "/api/parties"); }
        public Task<Dictionary<string, object>> PartyJoin(string code) { return SendAsync("POST", "/api/parties/join", J.Make("code", code)); }
        public Task<Dictionary<string, object>> PartyMine() { return SendAsync("GET", "/api/parties/me"); }
        public Task<Dictionary<string, object>> PartyLeave() { return SendAsync("DELETE", "/api/parties/me"); }

        // ---------------------------------------------------------------- leaderboards
        /// <summary>season: a finished season's final board; null for the current season.</summary>
        public Task<Dictionary<string, object>> Leaderboard(string mode, int limit = 50, int offset = 0, int? season = null)
        {
            return SendAsync("GET", "/api/leaderboards/" + mode + "?limit=" + limit + "&offset=" + offset + (season.HasValue ? "&season=" + season.Value : ""));
        }
        public Task<Dictionary<string, object>> Seasons() { return SendAsync("GET", "/api/seasons"); }
        public Task<Dictionary<string, object>> MySeasons() { return SendAsync("GET", "/api/me/seasons"); }
        public Task<Dictionary<string, object>> LeaderboardMe(string mode) { return SendAsync("GET", "/api/leaderboards/" + mode + "/me"); }

        // ---------------------------------------------------------------- voice
        public Task<Dictionary<string, object>> VoiceGrant(string matchId) { return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/voice"); }

        /// <summary>
        /// A 5-minute Vivox token. action: login, join or join_muted. Pass the identity and channel the Vivox SDK asks for.
        /// Returns { accessToken, expiresAt }.
        /// </summary>
        public Task<Dictionary<string, object>> VoiceToken(string matchId, string action, string channelUri = null, string fromUserUri = null)
        {
            return SendAsync("POST", "/api/matches/" + Uri.EscapeDataString(matchId) + "/voice/token", J.Make("action", action, "channelUri", channelUri, "fromUserUri", fromUserUri));
        }
    }
}
