using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace IPlay.Cornhole
{
    /// <summary>The phone's push system (Apple on iPhone, Firebase on Android). Implemented in the Unity layer.</summary>
    public interface IPushProvider
    {
        /// <summary>"ios" or "android".</summary>
        string Platform { get; }
        /// <summary>False when this build cannot get push tokens (the Editor, or Android without Firebase set up).</summary>
        bool IsSupported { get; }
        /// <summary>Shows the system "Allow notifications?" prompt if it has not been answered, then returns the push
        /// token, or null if the player said no. Asking again after an answer does not show the prompt again.</summary>
        Task<string> RequestTokenAsync();
    }

    /// <summary>
    /// When to ask for notifications, and keeping the server's copy of this phone's push token right.
    /// The player is asked once, after their first finished match (people say yes far more often once they know the
    /// game), never at first launch. After that the token is re-sent at every start (phones change it now and then),
    /// and removed from the server at sign-out so the next person on this phone does not get these notifications.
    /// </summary>
    public sealed class PushRegistration
    {
        public const string AskedKey = "iPlay.Cornhole.Push.Asked";
        public const string TokenKey = "iPlay.Cornhole.Push.Token";

        private readonly ApiClient api;
        private readonly IKeyValueStore store;
        private readonly IPushProvider provider;

        public PushRegistration(ApiClient api, IKeyValueStore store, IPushProvider provider)
        {
            this.api = api;
            this.store = store;
            this.provider = provider;
        }

        public bool HasAsked { get { return store.Get(AskedKey) == "1"; } }
        public string Token { get { return store.Get(TokenKey); } }

        /// <summary>Call when a match finishes. Asks for permission the first time only.</summary>
        public async Task<bool> OnMatchFinishedAsync()
        {
            if (provider == null || !provider.IsSupported || HasAsked) return false;
            store.Set(AskedKey, "1");
            return await RefreshAsync().ConfigureAwait(false);
        }

        /// <summary>Call once signed in at start-up: re-sends the token if the player already allowed notifications.</summary>
        public async Task<bool> OnSignedInAsync()
        {
            if (provider == null || !provider.IsSupported || !HasAsked) return false;
            return await RefreshAsync().ConfigureAwait(false);
        }

        private async Task<bool> RefreshAsync()
        {
            string token;
            try { token = await provider.RequestTokenAsync().ConfigureAwait(false); }
            catch (Exception) { return false; }
            if (string.IsNullOrEmpty(token)) return false;
            try
            {
                await api.SendAsync("POST", "/api/me/push", J.Make("token", token, "platform", provider.Platform)).ConfigureAwait(false);
                store.Set(TokenKey, token);
                return true;
            }
            catch (ApiException) { return false; }
        }

        /// <summary>Call before signing out or deleting the account.</summary>
        public async Task SignOutAsync()
        {
            var token = Token;
            if (string.IsNullOrEmpty(token)) return;
            try { await api.SendAsync("DELETE", "/api/me/push", J.Make("token", token)).ConfigureAwait(false); }
            catch (ApiException) { /* signing out anyway */ }
            store.Delete(TokenKey);
        }

        // -------------------------------------------------------------- which kinds the player wants

        public static readonly string[] Kinds = { "match", "ranked", "season" };

        public static string Describe(string kind)
        {
            switch (kind)
            {
                case "match": return "My match is still on (I left the app)";
                case "ranked": return "Ranked match found";
                case "season": return "Season results";
                default: return kind;
            }
        }

        public async Task<Dictionary<string, bool>> SettingsAsync()
        {
            var d = await api.SendAsync("GET", "/api/me/push-settings").ConfigureAwait(false);
            return Read(J.Obj(d, "settings"));
        }

        public async Task<Dictionary<string, bool>> SetAsync(string kind, bool on)
        {
            var d = await api.SendAsync("PUT", "/api/me/push-settings", J.Make(kind, on)).ConfigureAwait(false);
            return Read(J.Obj(d, "settings"));
        }

        private static Dictionary<string, bool> Read(Dictionary<string, object> s)
        {
            var result = new Dictionary<string, bool>();
            foreach (var k in Kinds) result[k] = !J.Has(s, k) || J.Bool(s, k, true);
            return result;
        }
    }
}
