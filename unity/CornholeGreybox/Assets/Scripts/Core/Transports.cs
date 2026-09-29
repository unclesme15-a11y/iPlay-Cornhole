using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace IPlay.Cornhole
{
    /// <summary>
    /// The WebSocket used by the game (System.Net.WebSockets works on Android and iOS in Unity, and in
    /// plain .NET for tests). One text message per frame; the server never sends anything else.
    /// </summary>
    public sealed class ClientWebSocketAdapter : ISocket
    {
        private readonly ClientWebSocket ws = new ClientWebSocket();
        private readonly byte[] buffer = new byte[64 * 1024];

        public async Task ConnectAsync(string url, CancellationToken ct)
        {
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                timeout.CancelAfter(TimeSpan.FromSeconds(10));
                await ws.ConnectAsync(new Uri(url), timeout.Token).ConfigureAwait(false);
            }
        }

        public Task SendAsync(string text, CancellationToken ct)
        {
            var bytes = Encoding.UTF8.GetBytes(text);
            return ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
        }

        public async Task<SocketMessage> ReceiveAsync(CancellationToken ct)
        {
            var sb = new StringBuilder();
            for (;;)
            {
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    var code = result.CloseStatus.HasValue ? (int)result.CloseStatus.Value : 1005;
                    try { await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None).ConfigureAwait(false); } catch (Exception) { }
                    return new SocketMessage { Closed = true, CloseCode = code };
                }
                sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                if (result.EndOfMessage) return new SocketMessage { Text = sb.ToString() };
            }
        }

        public async Task CloseAsync()
        {
            try
            {
                if (ws.State == WebSocketState.Open) await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception) { }
        }

        public void Dispose() { ws.Dispose(); }
    }

    public sealed class ClientWebSocketFactory : ISocketFactory
    {
        public ISocket Create() { return new ClientWebSocketAdapter(); }
    }

    /// <summary>Plain .NET HTTP, for tests and tools. The Unity game uses UnityWebRequest instead.</summary>
    public sealed class HttpClientTransport : IHttpTransport
    {
        private readonly HttpClient client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        /// <summary>Sent on every request when set (the server must run with TRUST_PROXY=true). Lets tests act as different phones.</summary>
        public string ForwardedFor;

        public async Task<HttpResult> SendAsync(string method, string url, IDictionary<string, string> headers, string body)
        {
            var req = new HttpRequestMessage(new HttpMethod(method), url);
            string contentType = null;
            foreach (var kv in headers)
            {
                if (kv.Key == "Content-Type") contentType = kv.Value;
                else req.Headers.TryAddWithoutValidation(kv.Key, kv.Value);
            }
            if (ForwardedFor != null) req.Headers.TryAddWithoutValidation("X-Forwarded-For", ForwardedFor);
            if (body != null) req.Content = new StringContent(body, Encoding.UTF8, contentType ?? "application/json");
            var res = await client.SendAsync(req).ConfigureAwait(false);
            return new HttpResult { Status = (int)res.StatusCode, Body = await res.Content.ReadAsStringAsync().ConfigureAwait(false) };
        }
    }
}
