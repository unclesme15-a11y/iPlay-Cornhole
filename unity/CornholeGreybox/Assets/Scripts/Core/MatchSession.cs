using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace IPlay.Cornhole
{
    /// <summary>Choices that live on the phone (not the account), remembered between launches.</summary>
    public sealed class LocalSettings
    {
        private readonly IKeyValueStore store;
        public LocalSettings(IKeyValueStore store) { this.store = store; }

        private bool GetBool(string key, bool fallback) { var v = store.Get("iPlay.Cornhole.Setting." + key); return v == null ? fallback : v == "1"; }
        private void SetBool(string key, bool value) { store.Set("iPlay.Cornhole.Setting." + key, value ? "1" : "0"); }

        public bool Sound { get { return GetBool("sound", true); } set { SetBool("sound", value); } }
        /// <summary>Talk to the table. Off means the app never joins voice.</summary>
        public bool Voice { get { return GetBool("voice", true); } set { SetBool("voice", value); } }
        /// <summary>Microphone starts muted (the player unmutes to talk).</summary>
        public bool StartMuted { get { return GetBool("startMuted", false); } set { SetBool("startMuted", value); } }
        public bool LeftHanded { get { return GetBool("leftHanded", false); } set { SetBool("leftHanded", value); } }
        /// <summary>Casual play only: draw the wind aim-off marks and the landing ring numbers. Ranked never shows them.</summary>
        public bool AimAssist { get { return GetBool("aimAssist", true); } set { SetBool("aimAssist", value); } }
        /// <summary>Soft glow instead of flashing lights (accessibility).</summary>
        public bool ReduceMotion { get { return GetBool("reduceMotion", false); } set { SetBool("reduceMotion", value); } }
        public bool Tutorial { get { return GetBool("tutorial", true); } set { SetBool("tutorial", value); } }
        public string LastShot { get { return store.Get("iPlay.Cornhole.Setting.shot") ?? "standard"; } set { store.Set("iPlay.Cornhole.Setting.shot", value); } }
    }

    /// <summary>
    /// One match from the phone's side: connects, keeps in step with the server, makes the picks, throws, votes on
    /// a rematch and leaves. The Unity screens only read <see cref="Model"/> and call these methods.
    /// </summary>
    public sealed class MatchSession
    {
        private readonly ApiClient api;
        private readonly ISocketFactory sockets;
        private CancellationTokenSource cts;
        private Task runTask;

        public readonly string Id;
        public readonly MatchModel Model = new MatchModel();
        public readonly ThrowController Throw;
        public MatchSocket Socket { get; private set; }
        /// <summary>The last problem worth telling the player (for example "not your turn" if a throw raced the clock).</summary>
        public string LastError { get; private set; }
        /// <summary>True from sending a throw until the server's answer arrives, so a double tap cannot throw twice.</summary>
        public bool ThrowInFlight { get; private set; }
        /// <summary>The socket stopped for good (signed out, banned, update needed, match gone). The code is the close code.</summary>
        public int FatalCode { get; private set; }
        public event Action<int> Fatal;

        public MatchSession(ApiClient api, ISocketFactory sockets, ThrowGuide guide, string matchId, string shotId)
        {
            this.api = api;
            this.sockets = sockets;
            Id = matchId;
            Throw = new ThrowController(guide, shotId);
        }

        public bool IsConnected { get { return Socket != null && Socket.State == SocketState.Live; } }

        /// <summary>Connect and stay connected. Call from the main thread (see <see cref="MatchSocket"/>).</summary>
        public void Connect(string myAccountId)
        {
            if (runTask != null) return;
            cts = new CancellationTokenSource();
            Socket = new MatchSocket(sockets, api, Model, Id);
            Socket.Fatal += code => { FatalCode = code; var h = Fatal; if (h != null) h(code); };
            Model.ThrowResultReceived += r => { ThrowInFlight = false; };
            Model.TurnStarted += t => { if (t.Seat == Model.YouSeat) Throw.Reset(); };
            runTask = Socket.RunAsync(myAccountId, cts.Token);
        }

        public void Disconnect()
        {
            if (cts == null) return;
            cts.Cancel();
            cts = null;
            runTask = null;
        }

        private async Task<bool> Try(Func<Task> action)
        {
            LastError = null;
            try { await action(); return true; }
            catch (ApiException e) { LastError = e.Code; return false; }
        }

        public Task<bool> StartAsync(bool fillOpenWithBots) { return Try(() => api.StartMatch(Id, fillOpenWithBots)); }
        public Task<bool> PickCharacterAsync(string characterId) { return Try(() => api.PickCharacter(Id, characterId)); }
        public Task<bool> PickColorAsync(string colorId) { return Try(() => api.PickColor(Id, colorId)); }
        public Task<bool> RematchAsync(bool accept) { return Try(() => api.Rematch(Id, accept)); }

        public async Task<bool> LeaveAsync()
        {
            var ok = await Try(() => api.LeaveMatch(Id));
            Disconnect();
            return ok;
        }

        /// <summary>Send the throw. Returns false (and sets <see cref="LastError"/>) if the server refused it.</summary>
        public async Task<bool> SendThrowAsync(ThrowCommand cmd)
        {
            if (cmd == null || ThrowInFlight || !Model.IsMyTurn) return false;
            ThrowInFlight = true;
            var ok = await Try(() => api.Throw(Id, cmd));
            if (!ok) ThrowInFlight = false; // refused: the player can try again if it is still their turn
            return ok;
        }

        /// <summary>Whether the throw controls should be live right now.</summary>
        public bool CanThrow { get { return Model.IsMyTurn && !ThrowInFlight; } }

        /// <summary>Seconds left on the throw clock for my turn (0 if none).</summary>
        public double ThrowSecondsLeft(double nowEpochMs)
        {
            var t = Model.Turn;
            if (t == null || t.DeadlineAt <= 0) return 0;
            return Math.Max(0, (t.DeadlineAt - nowEpochMs) / 1000.0);
        }

        /// <summary>Everyone I can report or block: the other people seated at this match.</summary>
        public List<SeatInfo> OtherHumans()
        {
            var list = new List<SeatInfo>();
            foreach (var s in Model.Seats)
                if (s.Kind == "human" && s.AccountId != null && s.AccountId != Model.YouId && !s.ControlledByBot) list.Add(s);
            return list;
        }
    }
}
