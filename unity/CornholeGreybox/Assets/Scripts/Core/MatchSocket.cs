using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace IPlay.Cornhole
{
    /// <summary>One message (or the close) from the socket.</summary>
    public sealed class SocketMessage
    {
        public string Text;
        public bool Closed;
        public int CloseCode;
    }

    public interface ISocket : IDisposable
    {
        Task ConnectAsync(string url, CancellationToken ct);
        Task SendAsync(string text, CancellationToken ct);
        Task<SocketMessage> ReceiveAsync(CancellationToken ct);
        Task CloseAsync();
    }

    public interface ISocketFactory
    {
        ISocket Create();
    }

    /// <summary>WebSocket close codes the server uses (see docs/api-contract.md).</summary>
    public static class CloseCodes
    {
        public const int ServerRestart = 1012;
        public const int BadHello = 4400;
        public const int Unauthorized = 4401;
        public const int Banned = 4403;
        public const int NotFound = 4404;
        public const int HelloTimeout = 4408;
        public const int UpdateRequired = 4426;
    }

    /// <summary>How long to wait before trying again: 0.5 s, 1 s, 2 s, 4 s, then 8 s, with a little jitter.</summary>
    public sealed class ReconnectPolicy
    {
        private readonly Random rng;
        private int attempt;
        public ReconnectPolicy(Random rng = null) { this.rng = rng ?? new Random(); }
        public void Reset() { attempt = 0; }
        public int Attempts { get { return attempt; } }
        public TimeSpan Next()
        {
            var baseMs = Math.Min(8000, 500 * (1 << Math.Min(attempt, 4)));
            attempt++;
            return TimeSpan.FromMilliseconds(baseMs * (0.85 + rng.NextDouble() * 0.3));
        }

        /// <summary>Codes that mean "stop and tell the player", not "try again".</summary>
        public static bool IsFinal(int closeCode)
        {
            return closeCode == CloseCodes.Unauthorized || closeCode == CloseCodes.Banned || closeCode == CloseCodes.NotFound ||
                   closeCode == CloseCodes.UpdateRequired || closeCode == CloseCodes.BadHello;
        }
    }

    public enum SocketState { Idle, Connecting, Live, Reconnecting, Stopped }

    /// <summary>
    /// Keeps a match's realtime connection alive: connects, says hello with the last event number, feeds the
    /// <see cref="MatchModel"/>, and reconnects by itself when the connection drops or the server restarts
    /// (close code 1012). Stops, and says why, on codes that reconnecting cannot fix.
    /// </summary>
    public sealed class MatchSocket
    {
        private readonly ISocketFactory factory;
        private readonly ApiClient api;
        private readonly MatchModel model;
        private readonly string matchId;
        private readonly ReconnectPolicy policy;
        private readonly Func<TimeSpan, CancellationToken, Task> delay;

        public SocketState State { get; private set; }
        /// <summary>Why it stopped, when it stopped for good (a close code or 0).</summary>
        public int StoppedCode { get; private set; }
        public event Action<SocketState> StateChanged;
        /// <summary>The server said reconnecting will not help (banned, signed out, outdated app, unknown match).</summary>
        public event Action<int> Fatal;
        /// <summary>The model missed events (or the server restarted): a fresh view was loaded.</summary>
        public event Action Resynced;

        public MatchSocket(ISocketFactory factory, ApiClient api, MatchModel model, string matchId, ReconnectPolicy policy = null, Func<TimeSpan, CancellationToken, Task> delay = null)
        {
            this.factory = factory;
            this.api = api;
            this.model = model;
            this.matchId = matchId;
            this.policy = policy ?? new ReconnectPolicy();
            this.delay = delay ?? ((t, ct) => Task.Delay(t, ct));
        }

        private void Set(SocketState s)
        {
            if (State == s) return;
            State = s;
            var h = StateChanged;
            if (h != null) h(s);
        }

        /// <summary>Run until cancelled or stopped for good. Call once per match screen.</summary>
        public async Task RunAsync(string youAccountId, CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                Set(policy.Attempts == 0 ? SocketState.Connecting : SocketState.Reconnecting);
                int closeCode = 0;
                try
                {
                    closeCode = await RunOnce(youAccountId, ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception) { closeCode = 0; }

                if (ct.IsCancellationRequested) break;
                if (ReconnectPolicy.IsFinal(closeCode))
                {
                    StoppedCode = closeCode;
                    Set(SocketState.Stopped);
                    var h = Fatal;
                    if (h != null) h(closeCode);
                    return;
                }
                if (model.IsOver && closeCode == 1000) break;
                Set(SocketState.Reconnecting);
                try { await delay(policy.Next(), ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { break; }
            }
            Set(SocketState.Stopped);
        }

        private async Task<int> RunOnce(string youAccountId, CancellationToken ct)
        {
            using (var socket = factory.Create())
            {
                await socket.ConnectAsync(api.WebSocketUrl(matchId), ct).ConfigureAwait(false);
                var hello = J.Make("type", "hello", "bearer", api.Token, "since", (double)model.Seq, "clientVersion", api.Client.Version);
                await socket.SendAsync(MiniJson.Serialize(hello), ct).ConfigureAwait(false);

                using (var heartbeat = CancellationTokenSource.CreateLinkedTokenSource(ct))
                {
                    var ping = Task.Run(() => PingLoop(socket, heartbeat.Token));
                    try
                    {
                        for (;;)
                        {
                            var m = await socket.ReceiveAsync(ct).ConfigureAwait(false);
                            if (m.Closed) return m.CloseCode;
                            if (m.Text == null) continue;
                            Dictionary<string, object> msg;
                            try { msg = MiniJson.ParseObject(m.Text); }
                            catch (FormatException) { continue; }
                            await Handle(msg, youAccountId).ConfigureAwait(false);
                        }
                    }
                    finally { heartbeat.Cancel(); try { await ping.ConfigureAwait(false); } catch (Exception) { } }
                }
            }
        }

        private static async Task PingLoop(ISocket socket, CancellationToken ct)
        {
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    await Task.Delay(20000, ct).ConfigureAwait(false);
                    await socket.SendAsync("{\"type\":\"ping\"}", ct).ConfigureAwait(false);
                }
            }
            catch (Exception) { /* the receive loop notices a dead connection */ }
        }

        private async Task Handle(Dictionary<string, object> msg, string youAccountId)
        {
            switch (J.Str(msg, "type"))
            {
                case "welcome":
                    var resync = J.Bool(msg, "resync");
                    var view = J.Obj(msg, "view");
                    // Take the view when we have nothing yet, or the server says we missed too much.
                    if (model.Id == null || resync || J.Int(view, "seq") > model.Seq + 200)
                    {
                        model.ApplyView(view, youAccountId);
                        if (resync) { var h = Resynced; if (h != null) h(); }
                    }
                    else
                    {
                        var missed = J.Arr(msg, "missed");
                        if (missed != null) foreach (var e in missed) model.ApplyEvent((Dictionary<string, object>)e);
                        if (model.NeedsRefresh) await Refresh(youAccountId).ConfigureAwait(false);
                    }
                    policy.Reset();
                    Set(SocketState.Live);
                    break;
                case "event":
                    model.ApplyEvent(J.Obj(msg, "event"));
                    if (model.NeedsRefresh) await Refresh(youAccountId).ConfigureAwait(false);
                    break;
                case "error":
                    break; // the close that follows carries the code
            }
        }

        private async Task Refresh(string youAccountId)
        {
            var view = await api.GetMatch(matchId).ConfigureAwait(false);
            model.ApplyView(view, youAccountId);
            var h = Resynced;
            if (h != null) h();
        }
    }
}
