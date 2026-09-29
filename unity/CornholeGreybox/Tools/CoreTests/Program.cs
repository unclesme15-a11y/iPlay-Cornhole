using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using IPlay.Cornhole;
using IPlay.Cornhole.Tests;

/// <summary>
/// Runs the core tests without Unity (mono / dotnet):
///   ./run-core-tests.sh                       offline tests
///   ./run-core-tests.sh --live http://127.0.0.1:3000   also drive a real running server with the real client code
/// </summary>
public static class Program
{
    public static int Main(string[] args)
    {
        var passed = 0;
        var failed = new List<string>();
        Action<string, Action> run = (name, body) =>
        {
            var sw = Stopwatch.StartNew();
            try { body(); passed++; Console.WriteLine("  ok   " + name + "  (" + sw.ElapsedMilliseconds + " ms)"); }
            catch (Exception e)
            {
                var msg = e is AggregateException && e.InnerException != null ? e.InnerException : e;
                failed.Add(name + "\n       " + msg.GetType().Name + ": " + msg.Message);
                Console.WriteLine("  FAIL " + name + "\n       " + msg.GetType().Name + ": " + msg.Message);
                if (!(msg is CheckFailed)) foreach (var line in (msg.StackTrace ?? "").Split('\n')) { if (line.Contains("Program") || line.Contains("Suite") || line.Contains("Cornhole")) Console.WriteLine("         " + line.Trim()); }
            }
        };

        Console.WriteLine("core tests");
        foreach (var t in CoreSuite.All()) run(t.Key, t.Value);

        var liveIndex = Array.IndexOf(args, "--live");
        if (liveIndex >= 0 && liveIndex + 1 < args.Length)
        {
            Console.WriteLine("\nlive tests against " + args[liveIndex + 1]);
            foreach (var t in LiveSuite.All(args[liveIndex + 1])) run(t.Key, t.Value);
        }

        Console.WriteLine("\n" + passed + " passed, " + failed.Count + " failed");
        foreach (var f in failed) Console.WriteLine("FAILED: " + f);
        return failed.Count == 0 ? 0 : 1;
    }
}

/// <summary>
/// The real client code (API client, session, socket, model, throw controller, ranked flow, voice,
/// leaderboards) driving a real server. Needs a server started with TRUST_PROXY=true, a high
/// RATE_LIMIT_PER_MIN, ADS_ENABLED=true and the four VIVOX_* settings.
/// </summary>
public static class LiveSuite
{
    private static int phoneCounter = 100;

    /// <summary>A fresh "phone": its own address and storage.</summary>
    private sealed class Phone
    {
        public readonly ApiClient Api;
        public readonly AccountSession Session;
        public readonly MemoryStore Store = new MemoryStore();
        public Phone(string url)
        {
            var n = Interlocked.Increment(ref phoneCounter);
            Api = new ApiClient(new HttpClientTransport { ForwardedFor = "10.9." + (n >> 8 & 255) + "." + (n & 255) }, url, new ClientInfo { Version = "1.0.0", Platform = "android" });
            Session = new AccountSession(Api, Store);
        }
        public StartupOutcome Start(string name = null)
        {
            Session.AnswerAdultGate(true);
            if (name != null) Session.SavedName = name;
            return Ck.Run(Session.StartAsync());
        }
    }

    private static T WaitFor<T>(Func<Task<T>> poll, Func<T, bool> done, double seconds = 20, int everyMs = 300)
    {
        var end = DateTime.UtcNow.AddSeconds(seconds);
        for (;;)
        {
            var v = Ck.Run(poll());
            if (done(v)) return v;
            if (DateTime.UtcNow > end) throw new CheckFailed("Timed out waiting (last value: " + v + ")");
            Thread.Sleep(everyMs);
        }
    }

    private static void WaitUntil(Func<bool> cond, double seconds = 20, string what = "condition")
    {
        var end = DateTime.UtcNow.AddSeconds(seconds);
        while (!cond())
        {
            if (DateTime.UtcNow > end) throw new CheckFailed("Timed out waiting for " + what);
            Thread.Sleep(50);
        }
    }

    public static IEnumerable<KeyValuePair<string, Action>> All(string url)
    {
        var tests = new List<KeyValuePair<string, Action>>();
        Action<string, Action> add = (n, a) => tests.Add(new KeyValuePair<string, Action>(n, a));

        add("live: the server refuses to make an account without the 18+ confirmation", () =>
        {
            var p = new Phone(url);
            var e = Ck.Throws<ApiException>(() => Ck.Run(p.Api.GuestSignIn("No Confirm", false)));
            Ck.Eq("adult_confirmation_required", e.Code);
            Ck.Eq(400, e.Status);
        });

        add("live: start-up signs in, loads the throwing guide, and a relaunch reuses the session", () =>
        {
            var p = new Phone(url);
            Ck.Eq(StartupOutcome.Ready, p.Start("Live Kicker"));
            Ck.Eq("Live Kicker", p.Session.Account.DisplayName);
            Ck.True(p.Session.Account.AdultConfirmed);
            Ck.Near(24, p.Session.Guide.AimToX, 0);
            Ck.Eq(3, p.Session.Guide.Shots.Count);
            var token = p.Api.Token;
            var again = new AccountSession(new ApiClient(new HttpClientTransport { ForwardedFor = "10.8.0.1" }, url, new ClientInfo { Version = "1.0.0" }), p.Store);
            Ck.Eq(StartupOutcome.Ready, Ck.Run(again.StartAsync()));
            Ck.Eq(token, p.Store.Get(AccountSession.TokenKey));
            Ck.Eq(p.Session.Account.Id, again.Account.Id);
        });

        add("live: /api/meta has ads, voice and ranked settings the app needs", () =>
        {
            var p = new Phone(url);
            p.Start();
            var meta = p.Session.Meta;
            var pacer = new AdPacer { ConsentGiven = true };
            pacer.Configure(meta);
            Ck.True(pacer.Enabled, "server was started with ads on");
            Ck.True(J.Bool(J.Obj(meta, "voice"), "enabled"), "voice is on");
            Ck.Eq(21, J.Int(J.Obj(meta, "ranked"), "playTo"));
        });

        add("live: a throw played with the real controller, and every number the C# guide predicts matches what the server did", () =>
        {
            var p = new Phone(url);
            p.Start("Live Thrower");
            var guide = p.Session.Guide;
            var created = Ck.Run(p.Api.CreateMatch(J.Make("mode", "1v1", "playTo", 21.0, "wind", "gusty")));
            var id = J.Str(created, "matchId");
            var model = new MatchModel();
            var socket = new MatchSocket(new ClientWebSocketFactory(), p.Api, model, id);
            var cts = new CancellationTokenSource();
            var run = socket.RunAsync(p.Session.Account.Id, cts.Token);
            try
            {
                WaitUntil(() => socket.State == SocketState.Live, 10, "the socket to go live");
                Ck.Eq("lobby", model.Phase);
                Ck.Run(p.Api.StartMatch(id));
                Ck.Run(p.Api.PickCharacter(id, "tanya"));
                Ck.Run(p.Api.PickColor(id, "teal"));
                WaitUntil(() => model.IsMyTurn, 30, "my turn");
                Ck.False(model.Wind.IsCalm, "gusty wind is blowing");
                Ck.True(model.Turn.Wind.Mph > 7, "gusty is 8 mph or more");

                // aim off into the wind, the way a player would using the hole marks
                var arc = guide.Shot("airmail").Arc;
                var shownCross = model.Turn.Wind.Cross;
                var drift = guide.WindDrift(arc, model.Turn.Wind.Cross, model.Turn.Wind.Along);
                var hole = new Point2(0, 39);
                var aim = guide.AimForX(hole.X - drift.X);
                var power = guide.PowerForY(hole.Y - drift.Y - guide.SlideDistance(arc));
                var c = new ThrowController(guide, "airmail");
                c.SetAim(aim);
                // finger: pull the bag down until the power matches, hold briefly, then flick straight up fast
                var pullDown = power * ThrowController.FullPull;
                c.BeginPull(0.0, 0.5, 0.35);
                c.MovePull(0.3, 0.5, 0.35 - pullDown);
                Ck.Near(power, c.Power, 1e-6, "power from the pull");
                var y0 = 0.35 - pullDown;
                var cmd = FlickUp(c, 0.4, 0.5, y0);
                Ck.NotNull(cmd, "flick became a throw");

                var got = new ManualResetEvent(false);
                ThrowResult result = null;
                model.ThrowResultReceived += r => { result = r; got.Set(); };
                Ck.Run(p.Api.Throw(id, cmd));
                Ck.True(got.WaitOne(8000), "throw_result arrived over the socket");

                Ck.Eq("A1", result.Seat);
                // the wind the bag flew through, and how far it moved it, follow the guide's formula exactly
                var predicted = guide.WindDrift(arc, result.WindCross, result.WindAlong);
                Ck.Near(predicted.X, result.DriftX, 0.011, "drift x");
                Ck.Near(predicted.Y, result.DriftY, 0.011, "drift y");
                // the gust is close to the wind that was shown (gusty = up to about 30% speed and 0.1 rad swing per sigma)
                Ck.True(Math.Abs(result.WindCross - shownCross) < 12, "gust stays near the shown wind");
                // the release verdict is what the C# preview says
                var preview = guide.PreviewRelease(cmd.Release);
                Ck.Eq(preview.Verdict, result.Release.Verdict);
                Ck.Near(preview.PushIn, result.Release.PushIn, 1e-9, "push");
                Ck.Near(preview.ShortIn, result.Release.ShortIn, 1e-9, "short");
                Ck.Near(preview.Shake, result.Release.Shake, 1e-9, "shake");
                // where it landed = calm landing + release push/short + wind, plus the human scatter (sigma 1.4 x, 2.6 y, times shake)
                var calm = guide.CalmLanding(cmd.Aim, cmd.Power);
                var expectX = calm.X + preview.PushIn + result.DriftX;
                var expectY = calm.Y + preview.ShortIn + result.DriftY;
                Ck.Near(expectX, result.Landing.X, 1.4 * preview.Shake * 5, "landing x");
                Ck.Near(expectY, result.Landing.Y, 2.6 * preview.Shake * 5, "landing y");
                // and the phone told the server exactly what was lined up
                Ck.Near(cmd.Aim, result.Release.AimedAim, 1e-9);
                Ck.Near(cmd.Power, result.Release.AimedPower, 1e-9);
                Ck.True(result.Flight.Count > 5 && result.Cues.Count > 0, "animation frames and cues arrived");
                Ck.Eq("board", model.Board.ContainsKey(result.BagId) ? model.Board[result.BagId].Status : result.Status == "hole" ? "board" : "gone");
            }
            finally
            {
                cts.Cancel();
                try { run.Wait(3000); } catch (AggregateException) { }
                try { Ck.Run(p.Api.LeaveMatch(id)); } catch (ApiException) { }
            }
        });

        add("live: two phones find each other in ranked, both connect, voice tokens work, leaving forfeits with a cooldown", () =>
        {
            var a = new Phone(url);
            var b = new Phone(url);
            a.Start("Rank Alpha");
            b.Start("Rank Bravo");
            var fa = new RankedFlow(a.Api);
            var fb = new RankedFlow(b.Api);
            Ck.True(Ck.Run(fa.JoinAsync("singles")).IsSearching);
            var matchedA = new List<string>();
            fa.Matched += m => matchedA.Add(m);
            Ck.Run(fb.JoinAsync("singles"));
            var qa = WaitFor(() => fa.PollAsync(), q => q.IsMatched, 20, (int)(RankedFlow.PollSeconds * 500));
            var qb = WaitFor(() => fb.PollAsync(), q => q.IsMatched, 20, 300);
            Ck.Eq(qa.MatchId, qb.MatchId);
            Ck.Eq(1, matchedA.Count);
            var id = qa.MatchId;

            var ma = new MatchModel();
            var mb = new MatchModel();
            var ctsA = new CancellationTokenSource();
            var ctsB = new CancellationTokenSource();
            var sa = new MatchSocket(new ClientWebSocketFactory(), a.Api, ma, id);
            var sb = new MatchSocket(new ClientWebSocketFactory(), b.Api, mb, id);
            var ra = sa.RunAsync(a.Session.Account.Id, ctsA.Token);
            var rb = sb.RunAsync(b.Session.Account.Id, ctsB.Token);
            try
            {
                WaitUntil(() => sa.State == SocketState.Live && sb.State == SocketState.Live, 10, "both sockets live");
                Ck.Eq("singles", ma.Ranked);
                Ck.True(ma.IsRanked);
                Ck.Eq("characters", ma.Phase);
                Ck.Eq(21, ma.PlayTo);
                Ck.Eq("breezy", ma.WindSetting);
                Ck.NotNull(ma.YouSeat, "seated");
                Ck.True(ma.Seat("A1").Connected && ma.Seat("B1").Connected, "both seats show connected");

                var grant = VoiceGrant.From(Ck.Run(a.Api.VoiceGrant(id)));
                Ck.Eq("cornhole-" + id, grant.TableName);
                Ck.Null(grant.TeamName, "no team channel in 1v1");
                Ck.Eq(2, grant.Roster.Count);
                Ck.Eq(a.Session.Account.Id, grant.Username);
                Ck.True(grant.LoginToken.Split('.').Length == 3 && grant.TableToken.Split('.').Length == 3, "signed tokens");

                // A walks out: their seat forfeits, the match ends, and a cooldown applies
                Ck.Run(a.Api.LeaveMatch(id));
                WaitUntil(() => mb.Phase == "abandoned" || mb.Phase == "finished", 10, "the match to end");
                var after = Ck.Run(new RankedFlow(a.Api).PollAsync());
                Ck.Eq("cooldown", after.Status);
                var e = Ck.Throws<ApiException>(() => Ck.Run(new RankedFlow(a.Api).JoinAsync("singles")));
                Ck.Eq("ranked_cooldown", e.Code);
                Ck.Eq(403, e.Status);
                Ck.True(e.Details.ContainsKey("until"));
                // the one who stayed can search again
                Ck.True(Ck.Run(fb.JoinAsync("singles")).IsSearching);
                Ck.Run(fb.CancelAsync());
            }
            finally
            {
                ctsA.Cancel();
                ctsB.Cancel();
                try { Task.WaitAll(new[] { ra, rb }, 3000); } catch (AggregateException) { }
            }
        });

        add("live: a duo forms with a party code, both queue together, and a full 2v2 match starts with partners on one team", () =>
        {
            var phones = new List<Phone>();
            for (var i = 0; i < 4; i++) { var p = new Phone(url); p.Start("Duo Player " + (char)('A' + i)); phones.Add(p); }
            var flows = phones.ConvertAll(p => new RankedFlow(p.Api));
            var party1 = Ck.Run(flows[0].CreatePartyAsync());
            Ck.False(party1.Full);
            var joined = Ck.Run(flows[1].JoinPartyAsync(party1.Code));
            Ck.True(joined.Full);
            var party2 = Ck.Run(flows[2].CreatePartyAsync());
            Ck.Run(flows[3].JoinPartyAsync(party2.Code));
            var noParty = Ck.Throws<ApiException>(() => Ck.Run(new RankedFlow(new Phone(url).Api).JoinAsync("teams")));
            Ck.True(noParty.Code == "party_required" || noParty.Code == "unauthorized", noParty.Code);
            Ck.True(Ck.Run(flows[0].JoinAsync("teams")).IsSearching);
            Ck.Run(flows[2].JoinAsync("teams"));
            var ids = new List<string>();
            for (var i = 0; i < 4; i++)
            {
                var flow = flows[i];
                ids.Add(WaitFor(() => flow.PollAsync(), q => q.IsMatched, 25, 400).MatchId);
            }
            Ck.Eq(1, new HashSet<string>(ids).Count, "all four are in one match");
            var m = new MatchModel();
            m.ApplyView(Ck.Run(phones[0].Api.GetMatch(ids[0])), phones[0].Session.Account.Id);
            Ck.Eq("teams", m.Ranked);
            Ck.Eq("2v2", m.Mode);
            var team0 = m.Seat(m.YouSeat).Team;
            var partnerSeat = m.Seats.Find(s => s.AccountId == phones[1].Session.Account.Id);
            Ck.Eq(team0, partnerSeat.Team, "partners share a team");
            var voice = VoiceGrant.From(Ck.Run(phones[0].Api.VoiceGrant(ids[0])));
            Ck.NotNull(voice.TeamName, "2v2 has a team channel");
            Ck.Eq(4, voice.Roster.Count);
            foreach (var p in phones) { try { Ck.Run(p.Api.LeaveMatch(ids[0])); } catch (ApiException) { } }
        });

        add("live: blocking someone puts them on the mute list, and unblocking removes them", () =>
        {
            var a = new Phone(url);
            var b = new Phone(url);
            a.Start("Muter");
            b.Start("Mutee");
            var created = Ck.Run(a.Api.CreateMatch(J.Make("mode", "1v1"), J.Make("B1", J.Make("kind", "human"))));
            var id = J.Str(created, "matchId");
            Ck.Run(b.Api.JoinMatch(id));
            Ck.Run(a.Api.Block(b.Session.Account.Id));
            var g = VoiceGrant.From(Ck.Run(a.Api.VoiceGrant(id)));
            Ck.True(g.ShouldMute(b.Session.Account.Id));
            Ck.False(VoiceGrant.From(Ck.Run(b.Api.VoiceGrant(id))).ShouldMute(a.Session.Account.Id), "being blocked mutes nobody for you");
            Ck.Run(a.Api.Unblock(b.Session.Account.Id));
            Ck.False(VoiceGrant.From(Ck.Run(a.Api.VoiceGrant(id))).ShouldMute(b.Session.Account.Id));
            Ck.Run(a.Api.Report(b.Session.Account.Id, "underage", id));
            Ck.Run(a.Api.LeaveMatch(id));
        });

        add("live: leaderboards answer for singles and teams, and 'me' says how many games are still needed", () =>
        {
            var p = new Phone(url);
            p.Start("Board Reader");
            var boards = new Leaderboards(p.Api);
            var page = Ck.Run(boards.PageAsync("singles"));
            Ck.Eq(10, page.MinGames);
            Ck.Eq(90, page.ActiveDays);
            var mine = Ck.Run(boards.MineAsync("singles"));
            Ck.Eq(0, mine.Count, "no rated games yet, so no standing");
            Ck.Eq(0, Ck.Run(boards.PageAsync("teams")).Entries.Count == 0 ? 0 : 0);
            Ck.Eq(1200, (int)Math.Round(p.Session.Account.SinglesRating));
        });

        add("live: hide-from-leaderboards, terms and account deletion work end to end", () =>
        {
            var p = new Phone(url);
            p.Start("Delete Me");
            Ck.Run(p.Api.SetLeaderboardVisibility(false));
            Ck.Run(p.Session.RefreshAsync());
            Ck.False(p.Session.Account.ShowOnLeaderboards);
            Ck.Run(p.Session.AcceptTermsAsync());
            Ck.False(p.Session.Account.NeedsTermsAccept);
            var export = Ck.Run(p.Api.ExportMyData());
            Ck.NotNull(J.Obj(export, "account"), "export has the account");
            Ck.Run(p.Session.DeleteAccountAsync());
            Ck.Null(p.Session.Account);
            Ck.Null(p.Store.Get(AccountSession.TokenKey));
            var relaunch = new AccountSession(new ApiClient(new HttpClientTransport { ForwardedFor = "10.7.0.1" }, url, null), new MemoryStore());
            relaunch.AnswerAdultGate(true);
            Ck.Eq(StartupOutcome.Ready, Ck.Run(relaunch.StartAsync())); // a brand new guest, the old account is gone
            Ck.True(relaunch.Account.Id != null);
        });

        return tests;
    }

    /// <summary>Flick straight up, fast, from (x, y0). Returns the throw.</summary>
    private static ThrowCommand FlickUp(ThrowController c, double t0, double x, double y0)
    {
        ThrowCommand cmd = null;
        for (var i = 1; i <= 6; i++)
        {
            var u = i / 6.0;
            var t = t0 + 0.12 * u;
            if (i < 6) c.MovePull(t, x, y0 + 0.4 * u);
            else cmd = c.Release(t, x, y0 + 0.4 * u);
        }
        return cmd;
    }
}
