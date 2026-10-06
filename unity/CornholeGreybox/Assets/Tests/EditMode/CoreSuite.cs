using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using IPlay.Cornhole;

namespace IPlay.Cornhole.Tests
{
    /// <summary>A failed check. Carries a readable message.</summary>
    public sealed class CheckFailed : Exception { public CheckFailed(string m) : base(m) { } }

    /// <summary>Tiny assertions so the suite runs with no test framework (Unity's runner and the mono console both call it).</summary>
    public static class Ck
    {
        public static void True(bool cond, string what = "condition") { if (!cond) throw new CheckFailed("Expected true: " + what); }
        public static void False(bool cond, string what = "condition") { if (cond) throw new CheckFailed("Expected false: " + what); }
        public static void Eq<T>(T expected, T actual, string what = "value")
        {
            if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new CheckFailed(what + ": expected <" + expected + "> but was <" + actual + ">");
        }
        public static void Near(double expected, double actual, double tol, string what = "value")
        {
            if (Math.Abs(expected - actual) > tol) throw new CheckFailed(what + ": expected " + expected + " ± " + tol + " but was " + actual);
        }
        public static void NotNull(object o, string what = "value") { if (o == null) throw new CheckFailed(what + " was null"); }
        public static void Null(object o, string what = "value") { if (o != null) throw new CheckFailed(what + " should be null but was " + o); }
        public static T Throws<T>(Action a) where T : Exception
        {
            try { a(); } catch (T e) { return e; }
            catch (Exception e) { throw new CheckFailed("Expected " + typeof(T).Name + " but got " + e.GetType().Name + ": " + e.Message); }
            throw new CheckFailed("Expected " + typeof(T).Name + " but nothing was thrown");
        }
        public static T Run<T>(Task<T> t) { return t.GetAwaiter().GetResult(); }
        public static void Run(Task t) { t.GetAwaiter().GetResult(); }
    }

    // ================================================================================ fakes
    /// <summary>A stand-in server: register a handler per "METHOD /path" and read back what was sent.</summary>
    public sealed class FakeTransport : IHttpTransport
    {
        public readonly List<string> Log = new List<string>();
        public readonly List<Dictionary<string, string>> HeadersSeen = new List<Dictionary<string, string>>();
        public readonly List<string> BodiesSeen = new List<string>();
        private readonly Dictionary<string, Func<string, HttpResult>> routes = new Dictionary<string, Func<string, HttpResult>>();
        public Exception FailWith;

        public void On(string route, Func<string, HttpResult> handler) { routes[route] = handler; }
        public void On(string route, int status, string json) { routes[route] = b => new HttpResult { Status = status, Body = json }; }

        public Task<HttpResult> SendAsync(string method, string url, IDictionary<string, string> headers, string body)
        {
            if (FailWith != null) throw FailWith;
            var path = new Uri(url).PathAndQuery;
            var key = method + " " + path;
            Log.Add(key);
            HeadersSeen.Add(new Dictionary<string, string>(headers));
            BodiesSeen.Add(body);
            Func<string, HttpResult> h;
            if (!routes.TryGetValue(key, out h) && !routes.TryGetValue(method + " " + path.Split('?')[0], out h))
                return Task.FromResult(new HttpResult { Status = 404, Body = "{\"error\":{\"code\":\"not_found\",\"message\":\"no route " + key + "\"}}" });
            return Task.FromResult(h(body));
        }
    }

    /// <summary>A socket that plays back a script: messages, then a close.</summary>
    public sealed class FakeSocket : ISocket
    {
        public readonly List<string> Sent = new List<string>();
        public string Url;
        public readonly Queue<SocketMessage> Script = new Queue<SocketMessage>();
        public Func<Task> BeforeConnect;
        public void Dispose() { }
        public async Task ConnectAsync(string url, CancellationToken ct) { Url = url; if (BeforeConnect != null) await BeforeConnect(); }
        public Task SendAsync(string text, CancellationToken ct) { Sent.Add(text); return Task.FromResult(0); }
        public async Task<SocketMessage> ReceiveAsync(CancellationToken ct)
        {
            if (Script.Count > 0) return Script.Dequeue();
            await Task.Delay(Timeout.Infinite, ct); // nothing more to say: wait to be cancelled
            return null;
        }
        public Task CloseAsync() { return Task.FromResult(0); }
    }

    public sealed class FakeSocketFactory : ISocketFactory
    {
        public readonly List<FakeSocket> Made = new List<FakeSocket>();
        public readonly Queue<FakeSocket> Next = new Queue<FakeSocket>();
        public ISocket Create() { var s = Next.Count > 0 ? Next.Dequeue() : new FakeSocket(); Made.Add(s); return s; }
    }

    // ================================================================================ data
    public static class Canned
    {
        /// <summary>What the server sends in GET /api/meta -> throwing (the numbers from server/src/physics/guide.ts).</summary>
        public const string Meta = @"{""throwing"":{
            ""gesture"":{""aimToX"":24,""powerMinY"":-48,""powerMaxY"":96},
            ""shots"":[{""id"":""slide"",""name"":""Slider"",""arc"":0.25,""slideIn"":19.1,""note"":""low""},
                       {""id"":""standard"",""name"":""Standard"",""arc"":0.55,""slideIn"":9.2,""note"":""mid""},
                       {""id"":""airmail"",""name"":""Airmail"",""arc"":0.9,""slideIn"":2.1,""note"":""lob""}],
            ""slide"":{""flatSpeed"":110,""lobSpeed"":20,""decel"":200},
            ""holeMarkIn"":6,
            ""wind"":{""crossInPerMph"":0.6,""alongInPerMph"":0.35,""airtimeBase"":0.5,""airtimeSlope"":0.8},
            ""release"":{""straightDeg"":3,""pushInPerDeg"":0.55,""minFlickSpeed"":1.5,""shortInPerSpeed"":9,""steadyHoldMs"":2500,""shakePerMs"":4000,""maxShake"":2.5}},
          ""ads"":{""enabled"":true,""interstitialEveryNMatches"":3,""minSecondsBetweenInterstitials"":180,""menuBanner"":true,""duringMatch"":false}}";

        public static ThrowGuide Guide() { return ThrowGuide.FromMeta(MiniJson.ParseObject(Meta)); }

        public const string Me = @"{""account"":{""id"":""a1"",""displayName"":""Uncle Me"",""isGuest"":true,""adultConfirmed"":true,""termsVersion"":1,""currentTermsVersion"":1,""needsTermsAccept"":false,""showOnLeaderboards"":true},
            ""stats"":{},""ratings"":{""singles"":{""rating"":1234,""games"":7},""teams"":[]},""signInMethods"":[],""activeMatchId"":null}";
    }

    // ================================================================================ the suite
    public static class CoreSuite
    {
        public static IEnumerable<KeyValuePair<string, Action>> All()
        {
            var suites = new List<KeyValuePair<string, Action>>();
            Action<string, Action> add = (n, a) => suites.Add(new KeyValuePair<string, Action>(n, a));

            // ---- json
            add("json: parses objects, arrays, numbers, strings, escapes and unicode", () =>
            {
                var o = MiniJson.ParseObject(@"{""a"":1.5,""b"":[1,2,{""c"":null}],""s"":""x\nyé\""q"",""t"":true,""n"":-3e2}");
                Ck.Near(1.5, J.Num(o, "a"), 1e-9);
                Ck.Eq(3, J.Arr(o, "b").Count);
                Ck.Eq("x\nyé\"q", J.Str(o, "s"));
                Ck.True(J.Bool(o, "t"));
                Ck.Near(-300, J.Num(o, "n"), 1e-9);
                Ck.False(J.Has(J.Arr(o, "b")[2], "c"), "null is not 'has'");
            });
            add("json: writes and reads back the same thing", () =>
            {
                var src = J.Make("a", 1, "b", "he said \"hi\"\n", "c", new List<object> { 1.25, true, null, "x" }, "d", J.Make("e", (double)5));
                var back = MiniJson.ParseObject(MiniJson.Serialize(src));
                Ck.Near(1, J.Num(back, "a"), 0);
                Ck.Eq("he said \"hi\"\n", J.Str(back, "b"));
                Ck.Eq(4, J.Arr(back, "c").Count);
                Ck.Near(5, J.Num(J.Obj(back, "d"), "e"), 0);
            });
            add("json: bad input is a FormatException, never a crash or a hang", () =>
            {
                foreach (var bad in new[] { "", "{", "[1,", "{\"a\"}", "{\"a\":}", "tru", "\"unterminated", "{\"a\":1} extra", "[1 2]" })
                    Ck.Throws<FormatException>(() => MiniJson.Parse(bad));
            });
            add("json: missing fields give the default, wrong types too", () =>
            {
                var o = MiniJson.ParseObject(@"{""s"":5,""n"":""x""}");
                Ck.Eq("d", J.Str(o, "s", "d"));
                Ck.Near(7, J.Num(o, "n", 7), 0);
                Ck.False(J.Bool(o, "nothing"));
                Ck.Null(J.Obj(o, "nothing"));
                Ck.Eq("z", J.Str(null, "x", "z"));
            });
            add("json: cannot write NaN or unknown types", () =>
            {
                Ck.Throws<ArgumentException>(() => MiniJson.Serialize(double.NaN));
                Ck.Throws<ArgumentException>(() => MiniJson.Serialize(new object()));
            });

            // ---- guide maths (must equal the server's)
            add("guide: reads the server's numbers and refuses an incomplete answer", () =>
            {
                var g = Canned.Guide();
                Ck.Eq(3, g.Shots.Count);
                Ck.Near(24, g.AimToX, 0);
                Ck.Throws<FormatException>(() => ThrowGuide.FromMeta(MiniJson.ParseObject("{}")));
                Ck.Throws<FormatException>(() => ThrowGuide.FromMeta(MiniJson.ParseObject(@"{""throwing"":{""gesture"":{}}}")));
            });
            add("guide: calm landing, slide distance and rest point match the server's physics", () =>
            {
                var g = Canned.Guide();
                var l = g.CalmLanding(0.5, 0.5);
                Ck.Near(12, l.X, 1e-9);
                Ck.Near(24, l.Y, 1e-9);
                Ck.Near(19.1, g.SlideDistance(0.25), 0.05, "slider slide");
                Ck.Near(2.1, g.SlideDistance(0.9), 0.05, "airmail slide");
                Ck.Near(g.Shot("standard").SlideIn, g.SlideDistance(0.55), 0.06, "standard slide");
                Ck.Near(39, g.CalmRest(0, g.PowerForY(39 - g.SlideDistance(0.9)), 0.9).Y, 1e-6, "aiming at the hole rests there");
            });
            add("guide: wind drift is 0.6 in per mph across, scaled by hang time (10 mph on a standard toss is about one hole)", () =>
            {
                var g = Canned.Guide();
                var d = g.WindDrift(0.55, 10, 0);
                Ck.Near(10 * 0.6 * (0.5 + 0.8 * 0.55), d.X, 1e-9);
                Ck.Near(0.94, g.WindInHoleMarks(0.55, 10, 0).X, 0.001);
                Ck.True(g.WindDrift(0.9, 10, 0).X > g.WindDrift(0.25, 10, 0).X * 1.5, "airmail moves most");
                Ck.True(g.WindDrift(0.55, 0, 10).Y > 0 && g.WindDrift(0.55, 0, -10).Y < 0, "tail carries, head holds up");
            });
            add("guide: aim and power inverses round-trip and clamp", () =>
            {
                var g = Canned.Guide();
                Ck.Near(-0.25, g.AimForX(-6), 1e-9);
                Ck.Near(1, g.AimForX(999), 0);
                Ck.Near(0.604, g.PowerForY(g.CalmLanding(0, 0.604).Y), 1e-9);
                Ck.Near(0, g.PowerForY(-999), 0);
            });
            add("guide: release preview matches the server (push, short-arm, shake, verdicts)", () =>
            {
                var g = Canned.Guide();
                Func<double, double, double, double, ReleaseEffect> p = (a, s, h, c) => g.PreviewRelease(new ReleaseInfo { AngleDeg = a, Speed = s, HoldMs = h, Curve = c });
                var clean = p(0, 3, 800, 0);
                Ck.Eq("pure", clean.Verdict);
                Ck.Near(0, clean.PushIn, 0);
                Ck.Near(0, p(2.5, 3, 800, 0).PushIn, 0, "inside the forgiving 3 degrees");
                Ck.Near(3.9, p(10, 3, 800, 0).PushIn, 1e-9);
                Ck.Eq("pushed", p(10, 3, 800, 0).Verdict);
                Ck.Near(-3.9, p(-10, 3, 800, 0).PushIn, 1e-9);
                Ck.Eq("pulled", p(-10, 3, 800, 0).Verdict);
                Ck.Eq("short-armed", p(0, 0.5, 800, 0).Verdict);
                Ck.Near(-9, p(0, 0.5, 800, 0).ShortIn, 1e-9);
                Ck.Near(2, p(0, 3, 6500, 0).Shake, 1e-9);
                Ck.Eq("shaky", p(0, 3, 6500, 0).Verdict);
                Ck.Near(2.5, p(0, 3, 60000, 0).Shake, 0, "capped");
                Ck.Near(-0.6, p(0, 3, 800, -0.6).Spin, 1e-9);
            });

            // ---- flick analysis and the throw controller
            Func<double, double, double, double, double, List<TouchSample>> flickPath = (pullFrom, pullTo, pullSecs, flickSecs, lean) =>
            {
                var s = new List<TouchSample>();
                // pull down (slowly), pause, then flick up
                for (var i = 0; i <= 10; i++) s.Add(new TouchSample(i * pullSecs / 10.0, 0.5, pullFrom + (pullTo - pullFrom) * i / 10.0));
                var t0 = pullSecs + 0.05;
                for (var i = 0; i <= 6; i++)
                {
                    var u = i / 6.0;
                    s.Add(new TouchSample(t0 + flickSecs * u, 0.5 + lean * u, pullTo + 0.4 * u));
                }
                return s;
            };
            add("flick: a straight, brisk flick is pure and fast", () =>
            {
                var r = FlickAnalyzer.Analyze(flickPath(0.3, 0.1, 0.6, 0.12, 0));
                Ck.True(r.IsFlick);
                Ck.Near(0, r.AngleDeg, 0.5);
                Ck.True(r.Speed > 3 && r.Speed < 4, "speed " + r.Speed);
                Ck.Near(0, r.Curve, 0.05);
            });
            add("flick: leaning right gives a positive angle, left a negative one", () =>
            {
                var right = FlickAnalyzer.Analyze(flickPath(0.3, 0.1, 0.6, 0.12, 0.1));
                var left = FlickAnalyzer.Analyze(flickPath(0.3, 0.1, 0.6, 0.12, -0.1));
                Ck.True(right.AngleDeg > 10 && right.AngleDeg < 20, "right " + right.AngleDeg);
                Ck.Near(-right.AngleDeg, left.AngleDeg, 0.001);
            });
            add("flick: a slow lazy flick is slow", () =>
            {
                var r = FlickAnalyzer.Analyze(flickPath(0.3, 0.1, 0.6, 0.6, 0));
                Ck.True(r.IsFlick);
                Ck.True(r.Speed < 1.5, "speed " + r.Speed);
            });
            add("flick: downward, tiny or single-point gestures are not throws", () =>
            {
                Ck.False(FlickAnalyzer.Analyze(null).IsFlick);
                Ck.False(FlickAnalyzer.Analyze(new List<TouchSample> { new TouchSample(0, 0.5, 0.5) }).IsFlick);
                Ck.False(FlickAnalyzer.Analyze(new List<TouchSample> { new TouchSample(0, 0.5, 0.5), new TouchSample(0.1, 0.5, 0.51) }).IsFlick, "tiny");
                Ck.False(FlickAnalyzer.Analyze(new List<TouchSample> { new TouchSample(0, 0.5, 0.5), new TouchSample(0.1, 0.5, 0.3) }).IsFlick, "downward");
                Ck.False(FlickAnalyzer.Analyze(new List<TouchSample> { new TouchSample(0, 0.5, 0.5), new TouchSample(0, 0.5, 0.9) }).IsFlick, "zero time");
            });
            add("flick: a bowed path curves, and the side follows the bow", () =>
            {
                Func<double, List<TouchSample>> bowed = side =>
                {
                    var s = new List<TouchSample>();
                    for (var i = 0; i <= 8; i++)
                    {
                        var u = i / 8.0;
                        s.Add(new TouchSample(u * 0.12, 0.5 + side * Math.Sin(u * Math.PI) * 0.05, 0.1 + 0.4 * u));
                    }
                    return s;
                };
                var right = FlickAnalyzer.Analyze(bowed(1));
                var left = FlickAnalyzer.Analyze(bowed(-1));
                Ck.True(Math.Abs(right.Curve) > 0.2, "curve " + right.Curve);
                Ck.Near(-right.Curve, left.Curve, 1e-9);
            });
            add("throw: pull sets power, aim drags, and the flick becomes the release the server wants", () =>
            {
                var g = Canned.Guide();
                var c = new ThrowController(g, "airmail");
                c.DragAim(0.15); // a quarter of the sideways range
                Ck.Near(0.5, c.Aim, 1e-9);
                var path = flickPath(0.3, 0.06, 0.8, 0.12, 0);
                c.BeginPull(path[0].T, path[0].X, path[0].Y);
                for (var i = 1; i < path.Count - 1; i++) c.MovePull(path[i].T, path[i].X, path[i].Y);
                var last = path[path.Count - 1];
                var cmd = c.Release(last.T, last.X, last.Y);
                Ck.NotNull(cmd, "command");
                Ck.Near(0.9, cmd.Arc, 1e-9);
                Ck.Near(0.5, cmd.Aim, 1e-9);
                Ck.True(cmd.Power > 0.6 && cmd.Power <= 1, "power " + cmd.Power);
                Ck.Near(0, cmd.Release.AngleDeg, 0.6);
                Ck.True(cmd.Release.Speed > 3);
                Ck.Near((last.T - path[0].T) * 1000, cmd.Release.HoldMs, 1);
                Ck.Eq(ThrowPhase.Released, c.Phase);
                Ck.Null(c.Release(last.T, last.X, last.Y), "cannot throw twice");
            });
            add("throw: the pull-back ring moves up the board as you pull; releasing without a flick throws nothing", () =>
            {
                var g = Canned.Guide();
                var c = new ThrowController(g);
                c.BeginPull(0, 0.5, 0.4);
                c.MovePull(0.1, 0.5, 0.35);
                var a = c.RingCenter.Y;
                c.MovePull(0.2, 0.5, 0.20);
                Ck.True(c.RingCenter.Y > a, "ring moves up as the bag is pulled back");
                Ck.Near(g.CalmLanding(c.Aim, c.Power).Y, c.RingCenter.Y, 1e-9);
                Ck.Null(c.Release(0.3, 0.5, 0.2), "a release with no flick is not a throw");
                Ck.Eq(ThrowPhase.Aiming, c.Phase);
            });
            add("throw: easing off the pull lowers the power, but once the flick starts the power is locked", () =>
            {
                var c = new ThrowController(Canned.Guide());
                c.BeginPull(0, 0.5, 0.40);
                c.MovePull(0.2, 0.5, 0.25);            // pulled half way
                Ck.Near(0.5, c.Power, 1e-9);
                c.MovePull(0.6, 0.5, 0.30);            // slowly eased back up a little
                Ck.Near(0.333, c.Power, 0.001, "slow movement up adjusts the power");
                c.MovePull(0.62, 0.5, 0.36);           // now shoots up fast: the flick has begun
                c.MovePull(0.64, 0.5, 0.45);
                Ck.Near(0.333, c.Power, 0.001, "power frozen when the flick began");
                var cmd = c.Release(0.66, 0.5, 0.55);
                Ck.NotNull(cmd);
                Ck.Near(0.333, cmd.Power, 0.001);
            });
            add("throw: holding too long makes the hand shake, like the server's rule", () =>
            {
                var g = Canned.Guide();
                var c = new ThrowController(g);
                c.BeginPull(0, 0.5, 0.4);
                Ck.Near(1, c.ShakeAt(2.0), 0);
                Ck.Near(2, c.ShakeAt(6.5), 1e-9);
                Ck.Near(2.5, c.ShakeAt(60), 0);
            });
            add("throw: aim and shot are remembered between throws, power resets", () =>
            {
                var c = new ThrowController(Canned.Guide());
                c.SelectShot("slide");
                c.SetAim(0.3);
                c.BeginPull(0, 0.5, 0.4);
                c.MovePull(0.1, 0.5, 0.1);
                c.Reset();
                Ck.Eq("slide", c.Shot);
                Ck.Near(0.3, c.Aim, 1e-9);
                Ck.Near(0.5, c.Power, 0);
                Ck.Eq(ThrowPhase.Idle, c.Phase);
                Ck.Near(0.25, c.Arc, 0);
            });
            add("throw: aim cannot leave the board and an unknown shot falls back to the middle one", () =>
            {
                var c = new ThrowController(Canned.Guide(), "nonsense");
                Ck.Eq("standard", c.Shot);
                c.DragAim(10);
                Ck.Near(ThrowController.MaxAim, c.Aim, 1e-9);
                c.DragAim(-100);
                Ck.Near(-ThrowController.MaxAim, c.Aim, 1e-9);
            });

            // ---- api client
            add("api: sends version, platform and the bearer token, and JSON bodies", () =>
            {
                var t = new FakeTransport();
                t.On("POST /api/matches", 201, @"{""matchId"":""ABCD2345""}");
                var api = new ApiClient(t, "https://play.example.com/", new ClientInfo { Version = "1.2.3", Platform = "android" }) { Token = "tok" };
                var r = Ck.Run(api.CreateMatch(J.Make("mode", "1v1", "wind", "gusty")));
                Ck.Eq("ABCD2345", J.Str(r, "matchId"));
                Ck.Eq("1.2.3", t.HeadersSeen[0]["X-Client-Version"]);
                Ck.Eq("android", t.HeadersSeen[0]["X-Client-Platform"]);
                Ck.Eq("Bearer tok", t.HeadersSeen[0]["Authorization"]);
                Ck.Eq("application/json", t.HeadersSeen[0]["Content-Type"]);
                Ck.True(t.BodiesSeen[0].Contains("\"wind\":\"gusty\""), t.BodiesSeen[0]);
            });
            add("api: server errors carry their code, details and status", () =>
            {
                var t = new FakeTransport();
                t.On("POST /api/ranked/queue", 403, @"{""error"":{""code"":""ranked_cooldown"",""message"":""wait"",""until"":""2026-01-01T00:00:00Z""}}");
                var api = new ApiClient(t, "http://x", null);
                var e = Ck.Throws<ApiException>(() => Ck.Run(api.RankedJoin("singles")));
                Ck.Eq("ranked_cooldown", e.Code);
                Ck.Eq(403, e.Status);
                Ck.Eq("2026-01-01T00:00:00Z", J.Str(e.Details, "until"));
            });
            add("api: no connection, proxy pages and outdated apps map to clear errors", () =>
            {
                var t = new FakeTransport { FailWith = new Exception("no route to host") };
                var api = new ApiClient(t, "http://x", null);
                var net = Ck.Throws<ApiException>(() => Ck.Run(api.Me()));
                Ck.True(net.IsNetwork, "network");
                var t2 = new FakeTransport();
                t2.On("GET /api/me", 502, "<html>Bad gateway</html>");
                var bad = Ck.Throws<ApiException>(() => Ck.Run(new ApiClient(t2, "http://x", null).Me()));
                Ck.Eq("server_error", bad.Code);
                var t3 = new FakeTransport();
                t3.On("GET /api/me", 426, @"{""error"":{""code"":""client_outdated"",""message"":""update"",""minVersion"":""1.2.0""}}");
                Ck.True(Ck.Throws<ApiException>(() => Ck.Run(new ApiClient(t3, "http://x", null).Me())).IsOutdatedClient);
            });
            add("api: sign-in keeps the token; adult confirmation is only sent when true; websocket url follows the base url", () =>
            {
                var t = new FakeTransport();
                t.On("POST /api/auth/guest", 201, @"{""token"":""T0K"",""account"":{""id"":""a1"",""displayName"":""x""}}");
                var api = new ApiClient(t, "https://play.example.com", null);
                Ck.Run(api.GuestSignIn(null, true));
                Ck.Eq("T0K", api.Token);
                Ck.True(t.BodiesSeen[0].Contains("\"confirmAdult\":true"));
                Ck.False(t.BodiesSeen[0].Contains("displayName"), "no name sent when none chosen");
                Ck.Eq("wss://play.example.com/api/matches/AB%20CD/ws", api.WebSocketUrl("AB CD"));
                Ck.Eq("ws://10.0.0.1:3000/api/matches/X/ws", new ApiClient(t, "http://10.0.0.1:3000", null).WebSocketUrl("X"));
            });
            add("api: throw sends what was lined up plus the release, and nothing extra", () =>
            {
                var t = new FakeTransport();
                t.On("POST /api/matches/M1/throw", 200, @"{""accepted"":true}");
                var api = new ApiClient(t, "http://x", null);
                Ck.Run(api.Throw("M1", new ThrowCommand { Power = 0.6, Aim = -0.1, Arc = 0.9, Release = new ReleaseInfo { AngleDeg = 4, Speed = 3, HoldMs = 900, Curve = 0.1 } }));
                var sent = MiniJson.ParseObject(t.BodiesSeen[0]);
                Ck.Near(0.6, J.Num(sent, "power"), 1e-9);
                Ck.Near(4, J.Num(J.Obj(sent, "release"), "angleDeg"), 1e-9);
                Ck.False(sent.ContainsKey("leftHanded"), "not sent unless left-handed");
            });

            // ---- account and start-up
            add("start: nothing happens on the network until the player has answered the 18+ screen", () =>
            {
                var t = new FakeTransport();
                var s = new AccountSession(new ApiClient(t, "http://x", null), new MemoryStore());
                Ck.Eq(StartupOutcome.NeedAdultGate, Ck.Run(s.StartAsync()));
                Ck.Eq(0, t.Log.Count);
            });
            add("start: under 18 is remembered and stays blocked on the next launch", () =>
            {
                var t = new FakeTransport();
                var store = new MemoryStore();
                var s = new AccountSession(new ApiClient(t, "http://x", null), store);
                s.AnswerAdultGate(false);
                Ck.Eq(StartupOutcome.AdultDenied, Ck.Run(s.StartAsync()));
                var again = new AccountSession(new ApiClient(t, "http://x", null), store);
                Ck.Eq(StartupOutcome.AdultDenied, Ck.Run(again.StartAsync()));
                Ck.Eq(0, t.Log.Count);
            });
            Func<FakeTransport> okServer = () =>
            {
                var t = new FakeTransport();
                t.On("GET /api/version", 200, @"{""maintenance"":false}");
                t.On("GET /api/meta", 200, Canned.Meta);
                t.On("POST /api/auth/guest", 201, @"{""token"":""NEWTOKEN"",""account"":{""id"":""a1"",""displayName"":""Player4821""}}");
                t.On("GET /api/me", 200, Canned.Me);
                return t;
            };
            add("start: a first launch signs in as a guest, saves the session, and is ready", () =>
            {
                var t = okServer();
                var store = new MemoryStore();
                var s = new AccountSession(new ApiClient(t, "http://x", null), store);
                s.AnswerAdultGate(true);
                Ck.Eq(StartupOutcome.Ready, Ck.Run(s.StartAsync()));
                Ck.Eq("NEWTOKEN", store.Get(AccountSession.TokenKey));
                Ck.Eq("Uncle Me", s.Account.DisplayName);
                Ck.Near(1234, s.Account.SinglesRating, 0);
                Ck.NotNull(s.Guide, "throwing guide loaded from the server");
                Ck.True(t.BodiesSeen[t.Log.IndexOf("POST /api/auth/guest")].Contains("\"confirmAdult\":true"));
            });
            add("start: a saved session is reused (no new sign-in), an expired one is replaced", () =>
            {
                var t = okServer();
                var store = new MemoryStore();
                store.Set(AccountSession.AdultKey, "1");
                store.Set(AccountSession.TokenKey, "SAVED");
                var s = new AccountSession(new ApiClient(t, "http://x", null), store);
                Ck.Eq(StartupOutcome.Ready, Ck.Run(s.StartAsync()));
                Ck.False(t.Log.Contains("POST /api/auth/guest"), "did not sign in again");

                var t2 = okServer();
                var calls = 0;
                t2.On("GET /api/me", b => calls++ == 0
                    ? new HttpResult { Status = 401, Body = @"{""error"":{""code"":""unauthorized"",""message"":""expired""}}" }
                    : new HttpResult { Status = 200, Body = Canned.Me });
                var store2 = new MemoryStore();
                store2.Set(AccountSession.AdultKey, "1");
                store2.Set(AccountSession.TokenKey, "OLD");
                var s2 = new AccountSession(new ApiClient(t2, "http://x", null), store2);
                Ck.Eq(StartupOutcome.Ready, Ck.Run(s2.StartAsync()));
                Ck.Eq("NEWTOKEN", store2.Get(AccountSession.TokenKey));
            });
            add("start: rejoin a running match, accept new terms, update required, banned, maintenance and offline are all told apart", () =>
            {
                Func<string, StartupOutcome> outcome = me =>
                {
                    var t = okServer();
                    t.On("GET /api/me", 200, me);
                    var store = new MemoryStore();
                    store.Set(AccountSession.AdultKey, "1");
                    store.Set(AccountSession.TokenKey, "SAVED");
                    return Ck.Run(new AccountSession(new ApiClient(t, "http://x", null), store).StartAsync());
                };
                Ck.Eq(StartupOutcome.RejoinMatch, outcome(Canned.Me.Replace("\"activeMatchId\":null", "\"activeMatchId\":\"ABCD2345\"")));
                Ck.Eq(StartupOutcome.NeedTerms, outcome(Canned.Me.Replace("\"needsTermsAccept\":false", "\"needsTermsAccept\":true")));

                Func<int, string, StartupOutcome> failing = (status, body) =>
                {
                    var t = new FakeTransport();
                    t.On("GET /api/version", status, body);
                    var store = new MemoryStore();
                    store.Set(AccountSession.AdultKey, "1");
                    return Ck.Run(new AccountSession(new ApiClient(t, "http://x", null), store).StartAsync());
                };
                Ck.Eq(StartupOutcome.UpdateRequired, failing(426, @"{""error"":{""code"":""client_outdated"",""message"":""x""}}"));
                Ck.Eq(StartupOutcome.Banned, failing(403, @"{""error"":{""code"":""account_banned"",""message"":""x""}}"));
                Ck.Eq(StartupOutcome.Maintenance, failing(503, @"{""error"":{""code"":""maintenance"",""message"":""x""}}"));
                var off = new FakeTransport { FailWith = new Exception("offline") };
                var st = new MemoryStore();
                st.Set(AccountSession.AdultKey, "1");
                Ck.Eq(StartupOutcome.Offline, Ck.Run(new AccountSession(new ApiClient(off, "http://x", null), st).StartAsync()));
            });
            add("start: a linked (Apple/Google) account whose login expired asks to sign in again, and never quietly makes a new guest", () =>
            {
                var t = okServer();
                t.On("GET /api/me", 401, @"{""error"":{""code"":""unauthorized"",""message"":""expired""}}");
                var store = new MemoryStore();
                store.Set(AccountSession.AdultKey, "1");
                store.Set(AccountSession.TokenKey, "OLD");
                store.Set(AccountSession.LinkedKey, "1");
                var s = new AccountSession(new ApiClient(t, "http://x", null), store);
                Ck.Eq(StartupOutcome.SignInRequired, Ck.Run(s.StartAsync()));
                Ck.False(t.Log.Contains("POST /api/auth/guest"), "no new guest was made");
                // choosing to carry on as a new guest is an explicit step
                s.ForgetLinkedAccount();
                t.On("GET /api/me", 200, Canned.Me);
                Ck.Eq(StartupOutcome.Ready, Ck.Run(s.StartAsync()));
                Ck.True(t.Log.Contains("POST /api/auth/guest"));
            });
            add("start: becoming a linked account is remembered; guests are not marked", () =>
            {
                var t = okServer();
                var store = new MemoryStore();
                var s = new AccountSession(new ApiClient(t, "http://x", null), store);
                s.AnswerAdultGate(true);
                Ck.Run(s.StartAsync());
                Ck.Null(store.Get(AccountSession.LinkedKey));
                t.On("GET /api/me", 200, Canned.Me.Replace("\"isGuest\":true", "\"isGuest\":false"));
                Ck.Run(s.RefreshAsync());
                Ck.Eq("1", store.Get(AccountSession.LinkedKey));
            });
            add("start: the throw clock follows the server's clock, not the phone's", () =>
            {
                var t = okServer();
                var serverNow = DateTimeOffset.UtcNow.AddMinutes(7);
                t.On("GET /api/version", 200, "{\"maintenance\":false,\"serverTime\":\"" + serverNow.ToString("o") + "\"}");
                var store = new MemoryStore();
                var s = new AccountSession(new ApiClient(t, "http://x", null), store);
                s.AnswerAdultGate(true);
                Ck.Run(s.StartAsync());
                Ck.Near(7 * 60 * 1000, s.ServerClockOffsetMs, 2000, "phone is 7 minutes behind");
            });
            add("account: deleting clears the token, the name and the account on the phone", () =>
            {
                var t = okServer();
                t.On("DELETE /api/me", 200, @"{""deleted"":true}");
                var store = new MemoryStore();
                var s = new AccountSession(new ApiClient(t, "http://x", null), store);
                s.AnswerAdultGate(true);
                Ck.Run(s.StartAsync());
                Ck.Run(s.DeleteAccountAsync());
                Ck.Null(store.Get(AccountSession.TokenKey));
                Ck.Null(s.Account);
                Ck.True(t.Log.Contains("DELETE /api/me"));
            });

            // ---- ranked
            add("ranked: joins, polls, and announces the match exactly once", () =>
            {
                var t = new FakeTransport();
                t.On("POST /api/ranked/queue", 202, @"{""status"":""searching"",""mode"":""singles"",""waitedSec"":0,""ratingWindow"":100,""playersSearching"":1}");
                var polls = 0;
                t.On("GET /api/ranked/queue", b => ++polls < 3
                    ? new HttpResult { Status = 200, Body = @"{""status"":""searching"",""mode"":""singles"",""waitedSec"":2,""ratingWindow"":100,""playersSearching"":2,""party"":null}" }
                    : new HttpResult { Status = 200, Body = @"{""status"":""matched"",""mode"":""singles"",""matchId"":""M9"",""party"":null}" });
                var flow = new RankedFlow(new ApiClient(t, "http://x", null));
                var announced = new List<string>();
                flow.Matched += id => announced.Add(id);
                Ck.True(Ck.Run(flow.JoinAsync("singles")).IsSearching);
                Ck.True(Ck.Run(flow.PollAsync()).IsSearching);
                Ck.True(Ck.Run(flow.PollAsync()).IsSearching);
                Ck.True(Ck.Run(flow.PollAsync()).IsMatched);
                Ck.Run(flow.PollAsync());
                Ck.Eq(1, announced.Count);
                Ck.Eq("M9", announced[0]);
            });
            add("ranked: parties give a code, list members, and leaving clears it", () =>
            {
                var t = new FakeTransport();
                t.On("POST /api/parties", 201, @"{""party"":{""code"":""K7MQ2X"",""members"":[{""accountId"":""a1"",""displayName"":""Uncle Me""}],""full"":false}}");
                t.On("POST /api/parties/join", 200, @"{""party"":{""code"":""K7MQ2X"",""members"":[{""accountId"":""a1"",""displayName"":""Uncle Me""},{""accountId"":""a2"",""displayName"":""Dre""}],""full"":true}}");
                t.On("DELETE /api/parties/me", 200, @"{""left"":true}");
                var flow = new RankedFlow(new ApiClient(t, "http://x", null));
                var p = Ck.Run(flow.CreatePartyAsync());
                Ck.Eq("K7MQ2X", p.Code);
                Ck.False(p.Full);
                var j = Ck.Run(flow.JoinPartyAsync(" k7mq2x "));
                Ck.True(j.Full);
                Ck.Eq(2, j.Members.Count);
                Ck.True(t.BodiesSeen[1].Contains("k7mq2x"), "code is trimmed before sending");
                Ck.Run(flow.LeavePartyAsync());
                Ck.Null(flow.Party);
            });
            add("ranked: a cooldown shows when it ends", () =>
            {
                var t = new FakeTransport();
                t.On("GET /api/ranked/queue", 200, @"{""status"":""cooldown"",""until"":""2026-09-29T04:27:13.645Z"",""party"":null}");
                var q = Ck.Run(new RankedFlow(new ApiClient(t, "http://x", null)).PollAsync());
                Ck.Eq("cooldown", q.Status);
                Ck.Eq("2026-09-29T04:27:13.645Z", q.CooldownUntil);
            });

            // ---- leaderboards
            add("leaderboards: reads pages, duos with both names, and where I stand", () =>
            {
                var t = new FakeTransport();
                t.On("GET /api/leaderboards/teams", 200, @"{""mode"":""teams"",""total"":2,""minGames"":10,""activeDays"":90,""next"":50,""entries"":[
                    {""rank"":1,""rating"":1500,""peak"":1510,""games"":15,""wins"":14,""losses"":1,""streak"":6,""members"":[{""accountId"":""a"",""displayName"":""Keisha""},{""accountId"":""b"",""displayName"":""Mike""}]}]}");
                t.On("GET /api/leaderboards/singles/me", 200, @"{""standings"":[{""rating"":1180,""games"":4,""rank"":null,""gamesNeeded"":6,""hiddenReason"":null,""neighbours"":[],""members"":[{""accountId"":""a"",""displayName"":""Me""}]}]}");
                var boards = new Leaderboards(new ApiClient(t, "http://x", null));
                var page = Ck.Run(boards.PageAsync("teams"));
                Ck.Eq("Keisha & Mike", page.Entries[0].Names);
                Ck.Eq(50, page.Next.Value);
                var mine = Ck.Run(boards.MineAsync("singles"));
                Ck.False(mine[0].Rank.HasValue, "not ranked yet");
                Ck.Eq(6, mine[0].GamesNeeded);
            });

            // ---- ads
            add("ads: off until the server says so, never in a match, only after enough matches and time, only with consent", () =>
            {
                var meta = MiniJson.ParseObject(Canned.Meta);
                var p = new AdPacer();
                p.ConsentGiven = true;
                Ck.False(p.ShouldShowInterstitial(1000), "not configured yet");
                p.Configure(meta);
                for (var i = 0; i < 2; i++) p.MatchFinished();
                Ck.False(p.ShouldShowInterstitial(1000), "only 2 matches");
                p.MatchFinished();
                Ck.True(p.ShouldShowInterstitial(1000), "3 matches finished");
                p.InMatch = true;
                Ck.False(p.ShouldShowInterstitial(1000), "never during a match");
                Ck.False(p.ShouldShowMenuBanner, "no banner in a match");
                p.InMatch = false;
                p.ConsentGiven = false;
                Ck.False(p.ShouldShowInterstitial(1000), "no consent");
                p.ConsentGiven = true;
                p.InterstitialShown(1000);
                Ck.Eq(0, p.MatchesSinceLastAd);
                for (var i = 0; i < 3; i++) p.MatchFinished();
                Ck.False(p.ShouldShowInterstitial(1100), "too soon (180 s)");
                Ck.True(p.ShouldShowInterstitial(1181), "long enough");
                var off = new AdPacer { ConsentGiven = true };
                off.Configure(MiniJson.ParseObject(@"{""ads"":{""enabled"":false}}"));
                for (var i = 0; i < 9; i++) off.MatchFinished();
                Ck.False(off.ShouldShowInterstitial(9999), "server has ads off");
                Ck.False(off.ShouldShowMenuBanner);
            });

            // ---- seasons
            add("seasons: the board says which season and how long is left; past boards and my history parse", () =>
            {
                var t = new FakeTransport();
                t.On("GET /api/leaderboards/singles", 200, @"{""entries"":[],""total"":0,""minGames"":10,""activeDays"":90,""next"":null,
                    ""season"":{""number"":3,""name"":""Season 3"",""startsAt"":""2027-04-01T00:00:00.000Z"",""endsAt"":""2027-07-01T00:00:00.000Z"",""current"":true}}");
                t.On("GET /api/seasons", 200, @"{""current"":{""number"":3,""name"":""Season 3"",""startsAt"":""2027-04-01T00:00:00.000Z"",""endsAt"":""2027-07-01T00:00:00.000Z""},
                    ""past"":[{""number"":2,""name"":""Season 2"",""startsAt"":""2027-01-01T00:00:00.000Z"",""endsAt"":""2027-04-01T00:00:00.000Z""},{""number"":1,""name"":""Season 1"",""startsAt"":""2026-10-01T00:00:00.000Z"",""endsAt"":""2027-01-01T00:00:00.000Z""}]}");
                t.On("GET /api/me/seasons", 200, @"{""results"":[{""season"":2,""name"":""Season 2"",""mode"":""teams"",""rank"":4,""rating"":1450,""games"":20,""wins"":13,""losses"":7,""partner"":{""accountId"":""b"",""displayName"":""Dre""}},
                    {""season"":2,""name"":""Season 2"",""mode"":""singles"",""rank"":null,""rating"":1310,""games"":6,""wins"":3,""losses"":3,""partner"":null}]}");
                var boards = new Leaderboards(new ApiClient(t, "http://x", null));
                var page = Ck.Run(boards.PageAsync("singles"));
                Ck.Eq(3, page.Season.Number);
                Ck.True(page.Season.Current, "live board");
                Ck.Eq(30, page.Season.DaysLeft(new DateTime(2027, 5, 31, 23, 0, 0, DateTimeKind.Utc)));
                Ck.Eq(0, page.Season.DaysLeft(new DateTime(2027, 6, 30, 12, 0, 0, DateTimeKind.Utc)), "last day");
                Ck.Eq(0, page.Season.DaysLeft(new DateTime(2027, 8, 1, 0, 0, 0, DateTimeKind.Utc)), "never negative");
                Ck.Run(boards.PageAsync("singles", 0, 25, 2));
                Ck.Eq("GET /api/leaderboards/singles?limit=25&offset=0&season=2", t.Log[t.Log.Count - 1]);
                var seasons = Ck.Run(boards.SeasonsAsync());
                Ck.Eq(3, seasons.Key.Number);
                Ck.Eq(2, seasons.Value.Count);
                Ck.Eq(2, seasons.Value[0].Number, "newest finished first");
                Ck.False(seasons.Value[0].Current);
                var mine = Ck.Run(boards.MySeasonsAsync());
                Ck.Eq(4, mine[0].Rank.Value);
                Ck.Eq("Dre", mine[0].PartnerName);
                Ck.False(mine[1].Rank.HasValue, "played but did not qualify");
            });

            // ---- app error reports
            add("error reports: repeats become one entry with a count, sent in one batch; failures are kept for later", () =>
            {
                var t = new FakeTransport();
                t.On("POST /api/client-errors", 202, "{\"received\":2}");
                var r = new ErrorReporter(new ApiClient(t, "http://x", new ClientInfo { Version = "1.0.0", Platform = "ios" }));
                Ck.Eq(0, Ck.Run(r.FlushAsync()), "nothing to send");
                for (var i = 0; i < 3; i++) r.Capture("NullReferenceException: boom", "CornholeApp.DrawResults ()\nUnityEngine.GUI.CallWindowDelegate ()");
                r.Capture("KeyNotFoundException", null);
                r.Capture("", "ignored");
                Ck.Eq(2, r.Pending);
                Ck.Eq(2, Ck.Run(r.FlushAsync()));
                Ck.Eq(0, r.Pending);
                var sent = MiniJson.ParseObject(t.BodiesSeen[0]);
                var errors = (List<object>)sent["errors"];
                Ck.Eq(2, errors.Count);
                var first = (Dictionary<string, object>)errors[0];
                Ck.Eq("NullReferenceException: boom", J.Str(first, "message"));
                Ck.Eq(3, (int)J.Num(first, "count"));
                Ck.Eq("1.0.0", t.HeadersSeen[0]["X-Client-Version"]);

                t.FailWith = new Exception("offline");
                r.Capture("Again", "X");
                Ck.Eq(0, Ck.Run(r.FlushAsync()), "offline: nothing sent, nothing thrown");
                Ck.Eq(1, r.Pending, "kept for later");
                t.FailWith = null;
                Ck.Eq(1, Ck.Run(r.FlushAsync()));
            });

            add("error reports: long text is clipped, at most 20 per batch and 50 different errors per session", () =>
            {
                var t = new FakeTransport();
                t.On("POST /api/client-errors", 202, "{}");
                var r = new ErrorReporter(new ApiClient(t, "http://x", null));
                r.Capture(new string('m', 900), new string('s', 9000));
                for (var i = 0; i < 80; i++) r.Capture("Error " + i, "at line " + i);
                Ck.Eq(ErrorReporter.MaxPerSession, r.Seen, "capped per session");
                Ck.Eq(20, Ck.Run(r.FlushAsync()), "one batch");
                var e0 = (Dictionary<string, object>)((List<object>)MiniJson.ParseObject(t.BodiesSeen[0])["errors"])[0];
                Ck.Eq(ErrorReporter.MaxMessage, J.Str(e0, "message").Length);
                Ck.Eq(ErrorReporter.MaxStack, J.Str(e0, "stack").Length);
                Ck.Eq(20, Ck.Run(r.FlushAsync()));
                Ck.Eq(10, Ck.Run(r.FlushAsync()));
                Ck.Eq(0, r.Pending);
                r.Capture("Error 3", "at line 3"); // seen before: still reported again if it happens again
                Ck.Eq(1, r.Pending);
            });

            // ---- reconnect
            add("reconnect: waits 0.5, 1, 2, 4, then 8 seconds (with a little jitter) and resets", () =>
            {
                var p = new ReconnectPolicy(new Random(1));
                var expected = new[] { 500, 1000, 2000, 4000, 8000, 8000 };
                foreach (var e in expected) Ck.Near(e, p.Next().TotalMilliseconds, e * 0.16, "delay");
                p.Reset();
                Ck.Near(500, p.Next().TotalMilliseconds, 80);
            });
            add("reconnect: signed-out, banned, unknown match and outdated app are final; a restart is not", () =>
            {
                Ck.True(ReconnectPolicy.IsFinal(CloseCodes.Unauthorized));
                Ck.True(ReconnectPolicy.IsFinal(CloseCodes.Banned));
                Ck.True(ReconnectPolicy.IsFinal(CloseCodes.NotFound));
                Ck.True(ReconnectPolicy.IsFinal(CloseCodes.UpdateRequired));
                Ck.False(ReconnectPolicy.IsFinal(CloseCodes.ServerRestart));
                Ck.False(ReconnectPolicy.IsFinal(CloseCodes.HelloTimeout));
                Ck.False(ReconnectPolicy.IsFinal(1006));
            });

            // ---- match model
            var view = @"{""id"":""M1"",""seq"":10,""phase"":""playing"",""config"":{""mode"":""1v1"",""playTo"":21,""wind"":""breezy""},
                ""seats"":[{""id"":""A1"",""team"":""A"",""kind"":""human"",""name"":""Me"",""accountId"":""a1"",""claimed"":true,""connected"":true},{""id"":""B1"",""team"":""B"",""kind"":""bot"",""name"":""Tanya"",""claimed"":true}],
                ""scores"":{""A"":3,""B"":1},""inning"":2,""firstTeam"":""A"",""colors"":{""A"":""royal-blue"",""B"":""hot-pink""},
                ""wind"":{""mph"":8,""towardDeg"":90,""gustiness"":0.15},
                ""turn"":{""seat"":""A1"",""team"":""A"",""bagId"":""A1-3"",""controlledBy"":""human"",""deadlineAt"":1000,""fromEnd"":0,""targetEnd"":1,""throwNumber"":3,""bagsLeft"":{""A"":3,""B"":4},""wind"":{""mph"":8,""towardDeg"":90,""cross"":8,""along"":0}},
                ""board"":[{""id"":""B1-1"",""team"":""B"",""status"":""board"",""x"":2.5,""y"":20}],
                ""ranked"":null,""you"":{""playerId"":""a1"",""seat"":""A1"",""team"":""A"",""host"":true}}";
            add("match: loads a full view: seats, wind, my turn, the board", () =>
            {
                var m = new MatchModel();
                m.ApplyView(MiniJson.ParseObject(view), "a1");
                Ck.Eq("playing", m.Phase);
                Ck.True(m.IsMyTurn);
                Ck.Near(8, m.Turn.Wind.Cross, 0);
                Ck.Near(3, m.ScoreA, 0);
                Ck.Eq(2, m.Seats.Count);
                Ck.Eq("royal-blue", m.Colors["A"]);
                Ck.Near(2.5, m.Board["B1-1"].X, 0);
                Ck.False(m.IsRanked);
            });
            add("match: events keep it in step (turn, throw result, score, end), and each fires its hook once", () =>
            {
                var m = new MatchModel();
                m.ApplyView(MiniJson.ParseObject(view), "a1");
                var throws = 0; string ended = null; var turns = 0; var scored = 0;
                m.ThrowResultReceived += t => throws++;
                m.MatchEnded += (w, r) => ended = w + ":" + r;
                m.TurnStarted += t => turns++;
                m.Scored += (team, pts) => scored++;
                Func<int, string, string, Dictionary<string, object>> ev = (seq, type, data) => MiniJson.ParseObject("{\"seq\":" + seq + ",\"type\":\"" + type + "\",\"data\":" + data + "}");

                m.ApplyEvent(ev(11, "throw_result", @"{""seat"":""A1"",""team"":""A"",""bagId"":""A1-3"",""status"":""board"",""updates"":{""B1-1"":""ground""},""landing"":{""x"":1,""y"":30},
                    ""resting"":{""A1-3"":{""x"":1.5,""y"":36}},""flight"":[{""t"":0,""x"":28,""y"":-324,""z"":40},{""t"":600,""x"":1,""y"":30,""z"":10}],
                    ""slide"":[{""t"":0,""bags"":{""A1-3"":[1,30]}},{""t"":100,""bags"":{""A1-3"":[1.5,36]}}],""holeEvents"":[],
                    ""flightMs"":600,""durationMs"":900,""wind"":{""cross"":8.2,""along"":0.1,""driftX"":4.6,""driftY"":0},
                    ""release"":{""pushIn"":0,""shortIn"":0,""shake"":1,""spin"":0,""verdict"":""pure"",""aimed"":{""aim"":0,""power"":0.6,""arc"":0.55}},
                    ""cues"":[{""atMs"":600,""reason"":""landing"",""sound"":""thud""}]}"));
                Ck.Eq(1, throws);
                Ck.Null(m.Turn, "turn closes when the bag is thrown");
                Ck.False(m.Board.ContainsKey("B1-1"), "knocked-off bag is gone");
                Ck.Near(36, m.Board["A1-3"].Y, 0);
                Ck.Near(2.5, m.BoardBeforeLastThrow["B1-1"].X, 0);
                Ck.False(m.BoardBeforeLastThrow.ContainsKey("A1-3"), "the board before the throw does not have the new bag");
                Ck.Eq("pure", m.LastThrow.Release.Verdict);
                Ck.Near(4.6, m.LastThrow.DriftX, 1e-9);
                Ck.Eq(2, m.LastThrow.Flight.Count);
                Ck.Eq("thud", m.LastThrow.Cues[0].Sound);

                m.ApplyEvent(ev(12, "score", @"{""team"":""A"",""points"":2,""scores"":{""A"":5,""B"":1}}"));
                Ck.Near(5, m.ScoreA, 0);
                Ck.Eq(1, scored);
                m.ApplyEvent(ev(13, "turn_start", @"{""seat"":""B1"",""team"":""B"",""bagId"":""B1-4"",""inning"":2,""controlledBy"":""bot"",""fromEnd"":0,""targetEnd"":1,""throwNumber"":4,""bagsLeft"":{""A"":2,""B"":4},""wind"":{""mph"":8,""towardDeg"":90,""cross"":8,""along"":0}}"));
                Ck.Eq(1, turns);
                Ck.False(m.IsMyTurn, "bot's turn");
                m.ApplyEvent(ev(14, "match_end", @"{""winner"":""A"",""reason"":""score"",""scores"":{""A"":21,""B"":9}}"));
                Ck.Eq("A:score", ended);
                m.ApplyEvent(ev(14, "match_end", @"{""winner"":""B"",""reason"":""score"",""scores"":{""A"":0,""B"":21}}")); // repeat of an event we already had
                Ck.Eq("A:score", ended);
                Ck.False(m.NeedsRefresh, "no gaps");
            });
            add("match: a gap in event numbers asks for a fresh view; a view clears it", () =>
            {
                var m = new MatchModel();
                m.ApplyView(MiniJson.ParseObject(view), "a1");
                m.ApplyEvent(MiniJson.ParseObject(@"{""seq"":15,""type"":""phase"",""data"":{""phase"":""finished"",""deadlineAt"":null}}"));
                Ck.True(m.NeedsRefresh);
                m.ApplyView(MiniJson.ParseObject(view), "a1");
                Ck.False(m.NeedsRefresh);
            });
            add("match: ranked results show my before/after, and a void match says so", () =>
            {
                var m = new MatchModel();
                m.ApplyView(MiniJson.ParseObject(view.Replace("\"ranked\":null", "\"ranked\":\"singles\"")), "a1");
                Ck.True(m.IsRanked);
                var fired = 0;
                m.RatingsUpdated += () => fired++;
                m.ApplyEvent(MiniJson.ParseObject(@"{""seq"":11,""type"":""ratings_updated"",""data"":{""voided"":false,""updates"":[
                    {""accountId"":""a1"",""mode"":""singles"",""before"":1200,""after"":1220,""change"":20,""games"":1,""farmingLimited"":false},
                    {""accountId"":""a2"",""mode"":""singles"",""before"":1200,""after"":1180,""change"":-20,""games"":1,""farmingLimited"":false}]}}"));
                Ck.Eq(1, fired);
                Ck.Eq(1220, m.MyRating.After);
                Ck.Eq(20, m.MyRating.Change);
                m.ApplyEvent(MiniJson.ParseObject(@"{""seq"":12,""type"":""ratings_updated"",""data"":{""voided"":true,""updates"":[]}}"));
                Ck.True(m.RatingsVoided);
                Ck.Null(m.MyRating);
            });

            // ---- socket
            Func<Dictionary<string, object>> viewObj = () => MiniJson.ParseObject(view);
            add("socket: says hello with the token and last event number, loads the welcome, and streams events", () =>
            {
                var f = new FakeSocketFactory();
                var s1 = new FakeSocket();
                s1.Script.Enqueue(new SocketMessage { Text = "{\"type\":\"welcome\",\"view\":" + view + ",\"missed\":[],\"resync\":false}" });
                s1.Script.Enqueue(new SocketMessage { Text = "{\"type\":\"event\",\"event\":{\"seq\":11,\"type\":\"score\",\"data\":{\"team\":\"A\",\"points\":1,\"scores\":{\"A\":4,\"B\":1}}}}" });
                f.Next.Enqueue(s1);
                var api = new ApiClient(new FakeTransport(), "http://x", new ClientInfo { Version = "1.0.0" }) { Token = "TOK" };
                var model = new MatchModel();
                var sock = new MatchSocket(f, api, model, "M1");
                using (var cts = new CancellationTokenSource())
                {
                    var run = sock.RunAsync("a1", cts.Token);
                    Wait(() => model.Seq == 11);
                    Ck.Eq(SocketState.Live, sock.State);
                    Ck.Near(4, model.ScoreA, 0);
                    var hello = MiniJson.ParseObject(s1.Sent[0]);
                    Ck.Eq("hello", J.Str(hello, "type"));
                    Ck.Eq("TOK", J.Str(hello, "bearer"));
                    Ck.Eq("1.0.0", J.Str(hello, "clientVersion"));
                    Ck.Eq("ws://x/api/matches/M1/ws", s1.Url);
                    cts.Cancel();
                    try { run.Wait(2000); } catch (AggregateException) { }
                }
            });
            add("socket: a server restart (1012) reconnects by itself and asks only for what was missed", () =>
            {
                var f = new FakeSocketFactory();
                var s1 = new FakeSocket();
                s1.Script.Enqueue(new SocketMessage { Text = "{\"type\":\"welcome\",\"view\":" + view + ",\"missed\":[],\"resync\":false}" });
                s1.Script.Enqueue(new SocketMessage { Closed = true, CloseCode = CloseCodes.ServerRestart });
                var s2 = new FakeSocket();
                s2.Script.Enqueue(new SocketMessage { Text = "{\"type\":\"welcome\",\"view\":" + view + ",\"missed\":[{\"seq\":11,\"type\":\"score\",\"data\":{\"team\":\"A\",\"points\":2,\"scores\":{\"A\":5,\"B\":1}}}],\"resync\":false}" });
                f.Next.Enqueue(s1);
                f.Next.Enqueue(s2);
                var model = new MatchModel();
                var waits = new List<TimeSpan>();
                var sock = new MatchSocket(f, new ApiClient(new FakeTransport(), "http://x", null) { Token = "TOK" }, model, "M1", new ReconnectPolicy(new Random(3)),
                    (t, ct) => { waits.Add(t); return Task.FromResult(0); });
                using (var cts = new CancellationTokenSource())
                {
                    var run = sock.RunAsync("a1", cts.Token);
                    Wait(() => model.Seq == 11 && f.Made.Count == 2);
                    Ck.Near(5, model.ScoreA, 0, "the missed score was applied");
                    Ck.Near(10, J.Num(MiniJson.ParseObject(s2.Sent[0]), "since"), 0, "second hello resumes from the last event");
                    Ck.Eq(1, waits.Count);
                    Ck.Eq(SocketState.Live, sock.State);
                    cts.Cancel();
                    try { run.Wait(2000); } catch (AggregateException) { }
                }
            });
            add("socket: signed out, banned or unknown match stops for good and says why", () =>
            {
                foreach (var code in new[] { CloseCodes.Unauthorized, CloseCodes.Banned, CloseCodes.NotFound, CloseCodes.UpdateRequired })
                {
                    var f = new FakeSocketFactory();
                    var s1 = new FakeSocket();
                    s1.Script.Enqueue(new SocketMessage { Closed = true, CloseCode = code });
                    f.Next.Enqueue(s1);
                    var sock = new MatchSocket(f, new ApiClient(new FakeTransport(), "http://x", null), new MatchModel(), "M1", null, (t, ct) => Task.FromResult(0));
                    var fatal = -1;
                    sock.Fatal += c => fatal = c;
                    using (var cts = new CancellationTokenSource())
                    {
                        Ck.Run(sock.RunAsync("a1", cts.Token));
                    }
                    Ck.Eq(code, fatal, "fatal code");
                    Ck.Eq(SocketState.Stopped, sock.State);
                    Ck.Eq(1, f.Made.Count, "did not retry");
                }
            });
            add("socket: when the server says it lost events (resync), the model is reloaded from the welcome view", () =>
            {
                var f = new FakeSocketFactory();
                var s1 = new FakeSocket();
                s1.Script.Enqueue(new SocketMessage { Text = "{\"type\":\"welcome\",\"view\":" + view.Replace("\"seq\":10", "\"seq\":4") + ",\"missed\":[],\"resync\":true}" });
                f.Next.Enqueue(s1);
                var model = new MatchModel { Id = "M1", Seq = 50 }; // we thought we were ahead of the restarted server
                var resynced = 0;
                var sock = new MatchSocket(f, new ApiClient(new FakeTransport(), "http://x", null), model, "M1");
                sock.Resynced += () => resynced++;
                using (var cts = new CancellationTokenSource())
                {
                    var run = sock.RunAsync("a1", cts.Token);
                    Wait(() => resynced == 1);
                    Ck.Eq(4, model.Seq);
                    cts.Cancel();
                    try { run.Wait(2000); } catch (AggregateException) { }
                }
            });

            // ---- voice
            add("voice: reads the channels, the team channel (or none), the roster and who to mute", () =>
            {
                var d = MiniJson.ParseObject(@"{""displayName"":""a1"",
                    ""table"":{""name"":""cornhole-M1"",""uri"":""sip:t""},
                    ""team"":{""name"":""cornhole-M1-team-A"",""uri"":""sip:tm""},
                    ""roster"":[{""seat"":""A1"",""team"":""A"",""username"":""a1"",""displayName"":""Me""},{""seat"":""B1"",""team"":""B"",""username"":""a2"",""displayName"":""Dre""}],
                    ""mute"":[""a2""]}");
                var g = VoiceGrant.From(d);
                Ck.Eq("a1", g.DisplayName);
                Ck.Eq("sip:tm", g.TeamUri);
                Ck.True(g.ShouldMute("a2"));
                Ck.False(g.ShouldMute("a1"));
                Ck.Eq("Dre", g.NameOf("a2"));
                Ck.Eq("zzz", g.NameOf("zzz"));
                Ck.Null(VoiceGrant.From(MiniJson.ParseObject(@"{""table"":{}}")).TeamName);
            });
            add("voice: token requests carry the identity and channel the SDK asked for", () =>
            {
                var t = new FakeTransport();
                t.On("POST /api/matches/M1/voice/token", 200, @"{""accessToken"":""TKN"",""expiresAt"":""2026-01-01T00:00:00Z""}");
                var api = new ApiClient(t, "http://x", null);
                var r = Ck.Run(api.VoiceToken("M1", "join", "sip:chan", "sip:.i.me.e.@d"));
                Ck.Eq("TKN", J.Str(r, "accessToken"));
                var sent = MiniJson.ParseObject(t.BodiesSeen[0]);
                Ck.Eq("join", J.Str(sent, "action"));
                Ck.Eq("sip:chan", J.Str(sent, "channelUri"));
                Ck.Eq("sip:.i.me.e.@d", J.Str(sent, "fromUserUri"));
                Ck.Run(api.VoiceToken("M1", "login"));
                Ck.False(MiniJson.ParseObject(t.BodiesSeen[1]).ContainsKey("channelUri"), "no channel for login");
            });

            // ---- replay
            Func<ThrowResult> sampleThrow = () =>
            {
                var r = new ThrowResult { BagId = "A1-1", Status = "hole", FlightMs = 600, DurationMs = 1000, Landing = new Point2(1, 30) };
                r.Flight.Add(new FlightSample { T = 0, X = 28, Y = -324, Z = 40 });
                r.Flight.Add(new FlightSample { T = 300, X = 14, Y = -150, Z = 60 });
                r.Flight.Add(new FlightSample { T = 600, X = 1, Y = 30, Z = 10 });
                var f1 = new SlideFrame { T = 0 }; f1.Bags["A1-1"] = new Point2(1, 30);
                var f2 = new SlideFrame { T = 200 }; f2.Bags["A1-1"] = new Point2(0.5, 36); f2.Bags["B1-1"] = new Point2(3, 25);
                r.Slide.Add(f1); r.Slide.Add(f2);
                r.HoleEvents.Add(new HoleEvent { BagId = "A1-1", Cause = "slide", TMs = 900 });
                r.Resting["B1-1"] = new Point2(3, 25);
                r.Cues.Add(new Cue { AtMs = 600, Reason = "landing", Sound = "thud" });
                r.Cues.Add(new Cue { AtMs = 900, Reason = "hole", Sound = "cornhole_hit", Led = new LedCue { Pattern = "flash_burst" } });
                return r;
            };
            add("replay: the bag flies along the samples, then slides, then rests, and drops in the hole at the server's moment", () =>
            {
                var r = sampleThrow();
                var before = new Dictionary<string, BoardBag> { { "B1-1", new BoardBag { Id = "B1-1", Status = "board", X = 2, Y = 20, HasPosition = true } } };
                var start = ThrowReplay.At(r, 0, before);
                Ck.Eq("flight", start.Phase);
                Ck.Near(28, start.Bag.X, 1e-9);
                Ck.Near(40, start.Height, 1e-9);
                var mid = ThrowReplay.At(r, 150, before);
                Ck.Near(21, mid.Bag.X, 1e-9, "halfway between the first two samples");
                Ck.Near(50, mid.Height, 1e-9);
                Ck.Near(2, mid.Board["B1-1"].X, 0, "bags already on the board stay put while the bag is in the air");
                var landed = ThrowReplay.At(r, 650, before);
                Ck.Eq("slide", landed.Phase);
                Ck.Near(30, landed.Bag.Y, 1e-9);
                Ck.Near(20, landed.Board["B1-1"].Y, 0, "not knocked yet");
                var knocked = ThrowReplay.At(r, 850, before);
                Ck.Near(25, knocked.Board["B1-1"].Y, 1e-9, "knocked bag moved");
                Ck.Near(36, knocked.Bag.Y, 1e-9);
                Ck.False(knocked.InHole.Contains("A1-1"));
                var end = ThrowReplay.At(r, 1000, before);
                Ck.Eq("rest", end.Phase);
                Ck.True(end.InHole.Contains("A1-1"), "in the hole");
                Ck.False(end.Board.ContainsKey("A1-1"), "gone from the board");
                Ck.Near(25, end.Board["B1-1"].Y, 1e-9);
            });
            add("replay: cues are due exactly once as time passes, and the first hole moment is known", () =>
            {
                var r = sampleThrow();
                Ck.Eq(0, ThrowReplay.CuesBetween(r, 0, 599).Count);
                Ck.Eq("thud", ThrowReplay.CuesBetween(r, 599, 600)[0].Sound);
                Ck.Eq(0, ThrowReplay.CuesBetween(r, 600, 899).Count, "already played");
                var hole = ThrowReplay.CuesBetween(r, 899, 1000);
                Ck.Eq(1, hole.Count);
                Ck.Eq("flash_burst", hole[0].Led.Pattern);
                Ck.Near(900, ThrowReplay.FirstHoleMs(r), 0);
                Ck.Near(-1, ThrowReplay.FirstHoleMs(new ThrowResult()), 0);
            });
            add("replay: a throw with no frames (a long-ago event) still gives a sensible frame", () =>
            {
                var r = new ThrowResult { BagId = "X", FlightMs = 600, DurationMs = 900, Landing = new Point2(4, 12) };
                Ck.Eq("flight", ThrowReplay.At(r, 100, null).Phase);
                var end = ThrowReplay.At(r, 900, null);
                Ck.Eq("rest", end.Phase);
                Ck.Near(4, end.Bag.X, 0);
            });

            add("settings: remembered on the phone with sensible defaults", () =>
            {
                var store = new MemoryStore();
                var s = new LocalSettings(store);
                Ck.True(s.Sound && s.Voice && s.AimAssist && s.Tutorial);
                Ck.False(s.StartMuted || s.LeftHanded || s.ReduceMotion);
                Ck.Eq("standard", s.LastShot);
                s.Voice = false;
                s.LastShot = "airmail";
                s.LeftHanded = true;
                var again = new LocalSettings(store);
                Ck.False(again.Voice);
                Ck.Eq("airmail", again.LastShot);
                Ck.True(again.LeftHanded);
            });

            // ---- theme
            add("theme: the iPlay palette and the streak rule (hot red only for a big streak)", () =>
            {
                Ck.Near(0.05, Theme.Cyan.R, 1e-6);
                Ck.Near(0.8, Theme.Cyan.G, 1e-6);
                Ck.Eq(Theme.Hot.R, Theme.StreakColor(5).R);
                Ck.True(Theme.StreakColor(4).R != Theme.Hot.R, "not hot before 5");
                var c = Rgba.Hex("#1D4ED8");
                Ck.Near(29 / 255.0, c.R, 1e-6);
                Ck.Near(1, Rgba.Hex("bogus").R, 0, "bad hex falls back to white");
            });

            return suites;
        }

        /// <summary>Waits (up to 5 s) for something that happens on a background thread.</summary>
        public static void Wait(Func<bool> done)
        {
            var end = DateTime.UtcNow.AddSeconds(5);
            while (!done())
            {
                if (DateTime.UtcNow > end) throw new CheckFailed("Timed out waiting for the condition");
                Thread.Sleep(5);
            }
        }
    }
}
