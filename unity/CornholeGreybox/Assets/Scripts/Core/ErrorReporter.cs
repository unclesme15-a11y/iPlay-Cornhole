using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace IPlay.Cornhole
{
    /// <summary>
    /// Collects the app's own errors (exceptions that did not crash it but probably broke a screen) and sends them to the
    /// server in small batches (POST /api/client-errors), so problems on real phones show up for the owner.
    /// The same error seen many times is sent once with a count. At most 50 different errors are sent per app session,
    /// and anything that fails to send is kept for the next try. Sending never throws and never reports itself.
    /// </summary>
    public sealed class ErrorReporter
    {
        public const int MaxPerSession = 50;
        public const int MaxBatch = 20;
        public const int MaxMessage = 500;
        public const int MaxStack = 4000;

        private sealed class Entry { public string Message, Stack; public int Count; }

        private readonly ApiClient api;
        private readonly List<string> order = new List<string>();
        private readonly Dictionary<string, Entry> pending = new Dictionary<string, Entry>();
        private readonly HashSet<string> seen = new HashSet<string>();
        private bool sending;

        public ErrorReporter(ApiClient api) { this.api = api; }

        /// <summary>How many different errors are waiting to be sent.</summary>
        public int Pending { get { lock (pending) return order.Count; } }
        /// <summary>How many different errors this session has collected (the cap is <see cref="MaxPerSession"/>).</summary>
        public int Seen { get { lock (pending) return seen.Count; } }

        public void Capture(string message, string stack)
        {
            if (string.IsNullOrEmpty(message)) return;
            message = Clip(message.Trim(), MaxMessage);
            stack = Clip(stack ?? "", MaxStack);
            var firstLine = stack.Split('\n')[0].Trim();
            var key = message + "|" + firstLine;
            lock (pending)
            {
                Entry e;
                if (pending.TryGetValue(key, out e)) { e.Count++; return; }
                if (seen.Contains(key)) { pending[key] = new Entry { Message = message, Stack = stack, Count = 1 }; order.Add(key); return; }
                if (seen.Count >= MaxPerSession) return;
                seen.Add(key);
                pending[key] = new Entry { Message = message, Stack = stack, Count = 1 };
                order.Add(key);
            }
        }

        /// <summary>Sends up to <see cref="MaxBatch"/> waiting errors. Returns how many were sent (0 if nothing to send or it failed).</summary>
        public async Task<int> FlushAsync()
        {
            List<string> keys;
            var batch = new List<object>();
            lock (pending)
            {
                if (sending || order.Count == 0) return 0;
                sending = true;
                keys = order.GetRange(0, Math.Min(MaxBatch, order.Count));
                foreach (var k in keys)
                {
                    var e = pending[k];
                    batch.Add(J.Make("message", e.Message, "stack", e.Stack.Length > 0 ? e.Stack : null, "count", (double)e.Count));
                }
            }
            try
            {
                await api.SendAsync("POST", "/api/client-errors", J.Make("errors", batch)).ConfigureAwait(false);
                lock (pending)
                {
                    foreach (var k in keys) { pending.Remove(k); order.Remove(k); }
                }
                return keys.Count;
            }
            catch (Exception)
            {
                return 0; // keep them for the next try; never report a reporting failure
            }
            finally
            {
                lock (pending) sending = false;
            }
        }

        private static string Clip(string s, int max) { return s.Length <= max ? s : s.Substring(0, max); }
    }
}
