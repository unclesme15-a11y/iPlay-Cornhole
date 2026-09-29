using System;
using System.Collections.Generic;

namespace IPlay.Cornhole
{
    public sealed class SeatInfo
    {
        public string Id, Team, Name, CharacterId, AccountId, Kind, BotLevel;
        public bool Claimed, Connected, ControlledByBot;
        public int StartEnd;
    }

    /// <summary>The wind. <see cref="Cross"/> is + to the thrower's right, <see cref="Along"/> is + toward the board.</summary>
    public sealed class WindInfo
    {
        public double Mph, TowardDeg, Cross, Along, Gustiness;
        public bool IsCalm { get { return Mph < 0.05; } }
    }

    public sealed class TurnInfo
    {
        public string Seat, Team, BagId, ControlledBy;
        public double DeadlineAt;
        public int FromEnd, TargetEnd, ThrowNumber;
        public int BagsLeftA, BagsLeftB;
        public WindInfo Wind = new WindInfo();
        public bool IsHuman { get { return ControlledBy == "human"; } }
    }

    public sealed class BoardBag
    {
        public string Id, Team, Status; // status: board or hole
        public double X, Y;
        public bool HasPosition;
    }

    public sealed class FlightSample { public double T, X, Y, Z; }
    public sealed class SlideFrame { public double T; public Dictionary<string, Point2> Bags = new Dictionary<string, Point2>(); }
    public sealed class HoleEvent { public string BagId, Cause; public double TMs; }

    public sealed class LedCue { public string Pattern; public double DurationMs; public int BoardEnd; public List<string> Colors = new List<string>(); }
    public sealed class Cue { public double AtMs; public string Reason, BagId, Sound; public LedCue Led; }

    public sealed class RatingChange
    {
        public string AccountId, Mode;
        public int Before, After, Change, Games;
        public bool FarmingLimited;
    }

    /// <summary>Everything the presentation needs to replay one throw. The server already decided the result.</summary>
    public sealed class ThrowResult
    {
        public string Seat, Team, BagId, Status, Foul;
        public int Inning, FromEnd, TargetEnd;
        public double FlightMs, DurationMs;
        public Point2 Landing;
        /// <summary>Resting spots of every bag still on the board after this throw.</summary>
        public Dictionary<string, Point2> Resting = new Dictionary<string, Point2>();
        /// <summary>Bags that were on the board and are now in the hole / off the board.</summary>
        public Dictionary<string, string> Updates = new Dictionary<string, string>();
        public List<FlightSample> Flight = new List<FlightSample>();
        public List<SlideFrame> Slide = new List<SlideFrame>();
        public List<HoleEvent> HoleEvents = new List<HoleEvent>();
        public List<Cue> Cues = new List<Cue>();
        /// <summary>What the wind did to this bag (mph as the thrower felt it, and inches moved).</summary>
        public double WindCross, WindAlong, DriftX, DriftY;
        /// <summary>Null for bots and for phones that sent no release.</summary>
        public ReleaseVerdict Release;
        public bool FramesOmitted;
    }

    public sealed class ReleaseVerdict
    {
        public double PushIn, ShortIn, Shake, Spin;
        public string Verdict;
        public double AimedAim, AimedPower, AimedArc;
    }

    /// <summary>
    /// The phone's picture of one match, kept in step with the server from the welcome and the events.
    /// It never decides anything: it only records what the server said. If it ever misses an event it
    /// asks to be refreshed from a full view.
    /// </summary>
    public sealed class MatchModel
    {
        public string Id;
        public int Seq;
        public string Phase = "lobby";
        public string Mode = "1v1";
        public int PlayTo = 21;
        public string WindSetting = "breezy";
        public string Ranked; // null, singles or teams
        public double DeadlineAt;
        public int Inning;
        public double ScoreA, ScoreB;
        public string FirstTeam;
        public string Winner, WinReason;
        public string YouSeat, YouTeam, YouId;
        public bool YouAreHost;
        public WindInfo Wind = new WindInfo();
        public TurnInfo Turn;
        public List<SeatInfo> Seats = new List<SeatInfo>();
        public Dictionary<string, string> Colors = new Dictionary<string, string>();
        public Dictionary<string, BoardBag> Board = new Dictionary<string, BoardBag>();
        public List<RatingChange> Ratings = new List<RatingChange>();
        public bool RatingsVoided;
        public bool RatingsReady;
        public Dictionary<string, object> Rematch;
        public ThrowResult LastThrow;

        /// <summary>Set when a gap in event numbers means the model may be wrong: reload the full view.</summary>
        public bool NeedsRefresh { get; private set; }

        public event Action<ThrowResult> ThrowResultReceived;
        public event Action<string> PhaseChanged;
        public event Action<string, double> Scored; // team, points
        public event Action<string, string> MatchEnded; // winner, reason
        public event Action<WindInfo> WindChanged;
        public event Action<TurnInfo> TurnStarted;
        public event Action<string, string> SeatForfeited; // seat, reason
        public event Action RatingsUpdated;
        public event Action Changed;
        public event Action<string> RematchReady; // new match id

        public bool IsMyTurn { get { return Turn != null && Turn.IsHuman && Turn.Seat == YouSeat && Phase == "playing"; } }
        public bool IsOver { get { return Phase == "finished" || Phase == "abandoned"; } }
        public bool IsRanked { get { return Ranked != null; } }
        public RatingChange MyRating
        {
            get
            {
                foreach (var r in Ratings) if (r.AccountId == YouId) return r;
                return null;
            }
        }

        public SeatInfo Seat(string id)
        {
            foreach (var s in Seats) if (s.Id == id) return s;
            return null;
        }

        /// <summary>Load a full view (from GET /api/matches/:id, or the WebSocket welcome).</summary>
        public void ApplyView(Dictionary<string, object> v, string youAccountId)
        {
            Id = J.Str(v, "id", Id);
            Seq = J.Int(v, "seq", Seq);
            Phase = J.Str(v, "phase", Phase);
            DeadlineAt = J.Num(v, "deadlineAt", 0);
            var cfg = J.Obj(v, "config");
            if (cfg != null)
            {
                Mode = J.Str(cfg, "mode", Mode);
                PlayTo = J.Int(cfg, "playTo", PlayTo);
                WindSetting = J.Str(cfg, "wind", WindSetting);
            }
            Ranked = J.Str(v, "ranked");
            var scores = J.Obj(v, "scores");
            ScoreA = J.Num(scores, "A");
            ScoreB = J.Num(scores, "B");
            Inning = J.Int(v, "inning");
            FirstTeam = J.Str(v, "firstTeam");
            Winner = J.Str(v, "winner");
            WinReason = J.Str(v, "winReason");
            YouId = youAccountId;
            var you = J.Obj(v, "you");
            YouSeat = J.Str(you, "seat");
            YouTeam = J.Str(you, "team");
            YouAreHost = J.Bool(you, "host");
            var wind = J.Obj(v, "wind");
            if (wind != null) Wind = ParseFieldWind(wind);
            Seats = ParseSeats(J.Arr(v, "seats"));
            Colors.Clear();
            var colors = J.Obj(v, "colors");
            if (colors != null) foreach (var kv in colors) Colors[kv.Key] = kv.Value as string;
            var turn = J.Obj(v, "turn");
            Turn = turn == null ? null : ParseTurn(turn);
            Board.Clear();
            var board = J.Arr(v, "board");
            if (board != null)
                foreach (var b in board)
                {
                    var bag = new BoardBag { Id = J.Str(b, "id"), Team = J.Str(b, "team"), Status = J.Str(b, "status") };
                    if (J.Has(b, "x")) { bag.X = J.Num(b, "x"); bag.Y = J.Num(b, "y"); bag.HasPosition = true; }
                    Board[bag.Id] = bag;
                }
            Rematch = J.Obj(v, "rematch");
            var ratings = J.Obj(v, "ratings");
            Ratings.Clear();
            RatingsReady = ratings != null;
            if (ratings != null)
            {
                RatingsVoided = J.Bool(ratings, "voided");
                var players = J.Arr(ratings, "players");
                if (players != null) foreach (var p in players) Ratings.Add(ParseRating(p));
            }
            NeedsRefresh = false;
            Raise(Changed);
        }

        /// <summary>Apply one event from the socket: { seq, at, type, data }.</summary>
        public void ApplyEvent(Dictionary<string, object> e)
        {
            var seq = J.Int(e, "seq");
            if (seq <= Seq) return; // already have it
            if (seq != Seq + 1) NeedsRefresh = true; // missed something
            Seq = seq;
            var type = J.Str(e, "type");
            var data = J.Obj(e, "data");
            switch (type)
            {
                case "phase":
                    Phase = J.Str(data, "phase", Phase);
                    DeadlineAt = J.Num(data, "deadlineAt", 0);
                    if (Phase != "playing") Turn = null;
                    Raise(PhaseChanged, Phase);
                    break;
                case "seats":
                    Seats = ParseSeats(J.Arr(data, "seats"));
                    break;
                case "coin_toss":
                    FirstTeam = J.Str(data, "firstTeam");
                    break;
                case "color_picked":
                    Colors[J.Str(data, "team")] = J.Str(data, "colorId");
                    break;
                case "wind":
                    Wind = ParseFieldWind(J.Obj(data, "wind"));
                    Raise(WindChanged, Wind);
                    break;
                case "turn_start":
                    Turn = ParseTurn(data);
                    Inning = J.Int(data, "inning", Inning);
                    if (Phase != "playing") Phase = "playing";
                    if (TurnStarted != null) TurnStarted(Turn);
                    break;
                case "turn_control":
                    if (Turn != null && Turn.Seat == J.Str(data, "seat")) Turn.ControlledBy = J.Str(data, "controlledBy", Turn.ControlledBy);
                    break;
                case "throw_result":
                    LastThrow = ParseThrow(data);
                    Turn = null;
                    ApplyBoard(LastThrow);
                    Raise(ThrowResultReceived, LastThrow);
                    break;
                case "throw_timeout":
                    Turn = null;
                    break;
                case "inning_complete":
                    var result = J.Obj(data, "result");
                    var after = J.Obj(result, "scoreAfter");
                    if (after != null) { ScoreA = J.Num(after, "A", ScoreA); ScoreB = J.Num(after, "B", ScoreB); }
                    Board.Clear();
                    break;
                case "score":
                    var scores = J.Obj(data, "scores");
                    if (scores != null) { ScoreA = J.Num(scores, "A", ScoreA); ScoreB = J.Num(scores, "B", ScoreB); }
                    if (Scored != null) Scored(J.Str(data, "team"), J.Num(data, "points"));
                    break;
                case "match_end":
                    Winner = J.Str(data, "winner");
                    WinReason = J.Str(data, "reason");
                    var end = J.Obj(data, "scores");
                    if (end != null) { ScoreA = J.Num(end, "A", ScoreA); ScoreB = J.Num(end, "B", ScoreB); }
                    Turn = null;
                    if (MatchEnded != null) MatchEnded(Winner, WinReason);
                    break;
                case "match_abandoned":
                    WinReason = "abandoned";
                    break;
                case "seat_forfeit":
                    if (SeatForfeited != null) SeatForfeited(J.Str(data, "seat"), J.Str(data, "reason"));
                    break;
                case "ratings_updated":
                    Ratings.Clear();
                    RatingsVoided = J.Bool(data, "voided");
                    RatingsReady = true;
                    var updates = J.Arr(data, "updates");
                    if (updates != null) foreach (var u in updates) Ratings.Add(ParseRating(u));
                    Raise(RatingsUpdated);
                    break;
                case "rematch_update":
                    Rematch = data;
                    break;
                case "rematch_ready":
                    var next = J.Str(data, "matchId");
                    if (Rematch == null) Rematch = new Dictionary<string, object>();
                    Rematch["matchId"] = next;
                    if (RematchReady != null) RematchReady(next);
                    break;
                case "rematch_cancelled":
                    if (Rematch == null) Rematch = new Dictionary<string, object>();
                    Rematch["cancelled"] = true;
                    break;
                case "resumed":
                case "kicked":
                case "character_picked":
                case "seat_takeover":
                case "seat_reclaimed":
                    break;
            }
            Raise(Changed);
        }

        private void ApplyBoard(ThrowResult t)
        {
            // bags that were knocked off or fell in
            foreach (var kv in t.Updates)
            {
                if (kv.Value == "ground") Board.Remove(kv.Key);
                else if (Board.ContainsKey(kv.Key)) Board[kv.Key].Status = kv.Value;
            }
            // the thrown bag
            if (t.Status == "ground") Board.Remove(t.BagId);
            else
            {
                BoardBag b;
                if (!Board.TryGetValue(t.BagId, out b)) { b = new BoardBag { Id = t.BagId, Team = t.Team }; Board[t.BagId] = b; }
                b.Status = t.Status;
            }
            foreach (var kv in t.Resting)
            {
                BoardBag b;
                if (Board.TryGetValue(kv.Key, out b)) { b.X = kv.Value.X; b.Y = kv.Value.Y; b.HasPosition = true; b.Status = "board"; }
            }
        }

        private static void Raise(Action a) { if (a != null) a(); }
        private static void Raise<T>(Action<T> a, T v) { if (a != null) a(v); }

        // ---------------------------------------------------------------- parsing
        public static WindInfo ParseFieldWind(Dictionary<string, object> w)
        {
            return new WindInfo { Mph = J.Num(w, "mph"), TowardDeg = J.Num(w, "towardDeg"), Gustiness = J.Num(w, "gustiness") };
        }

        private static TurnInfo ParseTurn(Dictionary<string, object> t)
        {
            var bags = J.Obj(t, "bagsLeft");
            var wind = J.Obj(t, "wind");
            var turn = new TurnInfo
            {
                Seat = J.Str(t, "seat"), Team = J.Str(t, "team"), BagId = J.Str(t, "bagId"),
                ControlledBy = J.Str(t, "controlledBy", "human"),
                DeadlineAt = J.Num(t, "deadlineAt", 0),
                FromEnd = J.Int(t, "fromEnd"), TargetEnd = J.Int(t, "targetEnd"), ThrowNumber = J.Int(t, "throwNumber"),
                BagsLeftA = J.Int(bags, "A"), BagsLeftB = J.Int(bags, "B"),
            };
            if (wind != null)
                turn.Wind = new WindInfo { Mph = J.Num(wind, "mph"), TowardDeg = J.Num(wind, "towardDeg"), Cross = J.Num(wind, "cross"), Along = J.Num(wind, "along") };
            return turn;
        }

        private static List<SeatInfo> ParseSeats(List<object> list)
        {
            var seats = new List<SeatInfo>();
            if (list == null) return seats;
            foreach (var s in list)
                seats.Add(new SeatInfo
                {
                    Id = J.Str(s, "id"), Team = J.Str(s, "team"), Name = J.Str(s, "name"), CharacterId = J.Str(s, "characterId"),
                    AccountId = J.Str(s, "accountId"), Kind = J.Str(s, "kind"), BotLevel = J.Str(s, "botLevel"),
                    Claimed = J.Bool(s, "claimed"), Connected = J.Bool(s, "connected"), ControlledByBot = J.Bool(s, "controlledByBot"),
                    StartEnd = J.Int(s, "startEnd"),
                });
            return seats;
        }

        private static RatingChange ParseRating(object o)
        {
            return new RatingChange
            {
                AccountId = J.Str(o, "accountId"), Mode = J.Str(o, "mode"),
                Before = J.Int(o, "before"), After = J.Int(o, "after"), Change = J.Int(o, "change"), Games = J.Int(o, "games"),
                FarmingLimited = J.Bool(o, "farmingLimited"),
            };
        }

        private static Point2 Pt(object o) { return new Point2(J.Num(o, "x"), J.Num(o, "y")); }

        public static ThrowResult ParseThrow(Dictionary<string, object> d)
        {
            var t = new ThrowResult
            {
                Seat = J.Str(d, "seat"), Team = J.Str(d, "team"), BagId = J.Str(d, "bagId"), Status = J.Str(d, "status"), Foul = J.Str(d, "foul"),
                Inning = J.Int(d, "inning"), FromEnd = J.Int(d, "fromEnd"), TargetEnd = J.Int(d, "targetEnd"),
                FlightMs = J.Num(d, "flightMs"), DurationMs = J.Num(d, "durationMs"),
                Landing = Pt(J.Obj(d, "landing")),
                FramesOmitted = J.Bool(d, "framesOmitted"),
            };
            var resting = J.Obj(d, "resting");
            if (resting != null) foreach (var kv in resting) t.Resting[kv.Key] = Pt(kv.Value);
            var updates = J.Obj(d, "updates");
            if (updates != null) foreach (var kv in updates) t.Updates[kv.Key] = kv.Value as string;
            var flight = J.Arr(d, "flight");
            if (flight != null) foreach (var f in flight) t.Flight.Add(new FlightSample { T = J.Num(f, "t"), X = J.Num(f, "x"), Y = J.Num(f, "y"), Z = J.Num(f, "z") });
            var slide = J.Arr(d, "slide");
            if (slide != null)
                foreach (var f in slide)
                {
                    var frame = new SlideFrame { T = J.Num(f, "t") };
                    var bags = J.Obj(f, "bags");
                    if (bags != null)
                        foreach (var kv in bags)
                        {
                            var xy = kv.Value as List<object>;
                            if (xy != null && xy.Count >= 2 && xy[0] is double && xy[1] is double) frame.Bags[kv.Key] = new Point2((double)xy[0], (double)xy[1]);
                        }
                    t.Slide.Add(frame);
                }
            var holes = J.Arr(d, "holeEvents");
            if (holes != null) foreach (var h in holes) t.HoleEvents.Add(new HoleEvent { BagId = J.Str(h, "bagId"), Cause = J.Str(h, "cause"), TMs = J.Num(h, "tMs") });
            var cues = J.Arr(d, "cues");
            if (cues != null)
                foreach (var c in cues)
                {
                    var cue = new Cue { AtMs = J.Num(c, "atMs"), Reason = J.Str(c, "reason"), BagId = J.Str(c, "bagId"), Sound = J.Str(c, "sound") };
                    var led = J.Obj(c, "led");
                    if (led != null)
                    {
                        cue.Led = new LedCue { Pattern = J.Str(led, "pattern"), DurationMs = J.Num(led, "durationMs"), BoardEnd = J.Int(led, "boardEnd") };
                        var colors = J.Arr(led, "colors");
                        if (colors != null) foreach (var col in colors) cue.Led.Colors.Add(col as string);
                    }
                    t.Cues.Add(cue);
                }
            var wind = J.Obj(d, "wind");
            if (wind != null) { t.WindCross = J.Num(wind, "cross"); t.WindAlong = J.Num(wind, "along"); t.DriftX = J.Num(wind, "driftX"); t.DriftY = J.Num(wind, "driftY"); }
            var rel = J.Obj(d, "release");
            if (rel != null)
            {
                var aimed = J.Obj(rel, "aimed");
                t.Release = new ReleaseVerdict
                {
                    PushIn = J.Num(rel, "pushIn"), ShortIn = J.Num(rel, "shortIn"), Shake = J.Num(rel, "shake", 1), Spin = J.Num(rel, "spin"),
                    Verdict = J.Str(rel, "verdict", "pure"),
                    AimedAim = J.Num(aimed, "aim"), AimedPower = J.Num(aimed, "power"), AimedArc = J.Num(aimed, "arc"),
                };
            }
            return t;
        }
    }
}
