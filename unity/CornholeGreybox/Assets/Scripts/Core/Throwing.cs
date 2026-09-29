using System;
using System.Collections.Generic;

namespace IPlay.Cornhole
{
    /// <summary>How the player let go of the bag, as measured on the phone. The server decides what it means.</summary>
    public sealed class ReleaseInfo
    {
        /// <summary>Degrees the flick leaned from straight up the screen. Negative = left.</summary>
        public double AngleDeg;
        /// <summary>Flick speed in screen heights per second.</summary>
        public double Speed;
        /// <summary>How long the bag was held pulled back, in milliseconds.</summary>
        public double HoldMs;
        /// <summary>How much the flick bent, -1 to 1.</summary>
        public double Curve;
    }

    /// <summary>What is sent to POST /api/matches/:id/throw.</summary>
    public sealed class ThrowCommand
    {
        public double Power, Aim, Arc, Spin;
        public bool LeftHanded;
        public ReleaseInfo Release;
    }

    public struct Point2
    {
        public double X, Y;
        public Point2(double x, double y) { X = x; Y = y; }
    }

    /// <summary>One touch sample: screen position as fractions of the screen height (x right, y UP) and time in seconds.</summary>
    public struct TouchSample
    {
        public double T, X, Y;
        public TouchSample(double t, double x, double y) { T = t; X = x; Y = y; }
    }

    public sealed class ShotOption
    {
        public string Id, Name, Note;
        public double Arc, SlideIn;
    }

    /// <summary>
    /// The numbers the server publishes in GET /api/meta -> throwing, and the maths built on them, so the
    /// aim line, landing ring and hole marks the phone draws match the server's physics exactly.
    /// </summary>
    public sealed class ThrowGuide
    {
        public double AimToX, PowerMinY, PowerMaxY, HoleMarkIn;
        public double CrossInPerMph, AlongInPerMph, AirtimeBase, AirtimeSlope;
        public double SlideFlatSpeed, SlideLobSpeed, SlideDecel;
        public double StraightDeg, PushInPerDeg, MinFlickSpeed, ShortInPerSpeed, SteadyHoldMs, ShakePerMs, MaxShake;
        public List<ShotOption> Shots = new List<ShotOption>();

        public static ThrowGuide FromMeta(Dictionary<string, object> meta)
        {
            var t = J.Obj(meta, "throwing");
            if (t == null) throw new FormatException("The server did not send throwing settings (is it an older version?)");
            var g = J.Obj(t, "gesture");
            var w = J.Obj(t, "wind");
            var r = J.Obj(t, "release");
            var s = J.Obj(t, "slide");
            var guide = new ThrowGuide
            {
                AimToX = J.Num(g, "aimToX"),
                PowerMinY = J.Num(g, "powerMinY"),
                PowerMaxY = J.Num(g, "powerMaxY"),
                HoleMarkIn = J.Num(t, "holeMarkIn"),
                CrossInPerMph = J.Num(w, "crossInPerMph"),
                AlongInPerMph = J.Num(w, "alongInPerMph"),
                AirtimeBase = J.Num(w, "airtimeBase"),
                AirtimeSlope = J.Num(w, "airtimeSlope"),
                SlideFlatSpeed = J.Num(s, "flatSpeed"),
                SlideLobSpeed = J.Num(s, "lobSpeed"),
                SlideDecel = J.Num(s, "decel", 200),
                StraightDeg = J.Num(r, "straightDeg"),
                PushInPerDeg = J.Num(r, "pushInPerDeg"),
                MinFlickSpeed = J.Num(r, "minFlickSpeed"),
                ShortInPerSpeed = J.Num(r, "shortInPerSpeed"),
                SteadyHoldMs = J.Num(r, "steadyHoldMs"),
                ShakePerMs = J.Num(r, "shakePerMs", 4000),
                MaxShake = J.Num(r, "maxShake", 2.5),
            };
            var shots = J.Arr(t, "shots");
            if (shots != null)
                foreach (var o in shots)
                    guide.Shots.Add(new ShotOption { Id = J.Str(o, "id"), Name = J.Str(o, "name"), Note = J.Str(o, "note"), Arc = J.Num(o, "arc"), SlideIn = J.Num(o, "slideIn") });
            if (guide.AimToX <= 0 || guide.PowerMaxY <= guide.PowerMinY || guide.HoleMarkIn <= 0 || guide.Shots.Count == 0)
                throw new FormatException("The server's throwing settings are incomplete");
            return guide;
        }

        public ShotOption Shot(string id)
        {
            foreach (var s in Shots) if (s.Id == id) return s;
            return Shots[Shots.Count / 2];
        }

        /// <summary>Where a bag lands (inches: x from the centre line, y from the board's front edge) on a windless day.</summary>
        public Point2 CalmLanding(double aim, double power)
        {
            return new Point2(aim * AimToX, PowerMinY + (PowerMaxY - PowerMinY) * power);
        }

        public double SlideSpeed(double arc) { return SlideFlatSpeed + (SlideLobSpeed - SlideFlatSpeed) * arc; }
        public double SlideDistance(double arc) { var v = SlideSpeed(arc); return v * v / (2 * SlideDecel); }

        /// <summary>Where the bag comes to rest on a windless day if it lands here (landing plus the slide).</summary>
        public Point2 CalmRest(double aim, double power, double arc)
        {
            var l = CalmLanding(aim, power);
            return new Point2(l.X, l.Y + SlideDistance(arc));
        }

        /// <summary>How far the wind pushes a bag: x to the thrower's right, y further down the board (inches).</summary>
        public Point2 WindDrift(double arc, double cross, double along)
        {
            var f = AirtimeBase + AirtimeSlope * arc;
            return new Point2(cross * CrossInPerMph * f, along * AlongInPerMph * f);
        }

        /// <summary>Wind pushes as "hole marks" (one mark is the hole's width): + = to the right / long.</summary>
        public Point2 WindInHoleMarks(double arc, double cross, double along)
        {
            var d = WindDrift(arc, cross, along);
            return new Point2(d.X / HoleMarkIn, d.Y / HoleMarkIn);
        }

        /// <summary>The aim that puts the calm landing at x inches.</summary>
        public double AimForX(double x) { return Clamp(x / AimToX, -1, 1); }

        /// <summary>The power that puts the calm landing at y inches from the front edge.</summary>
        public double PowerForY(double y) { return Clamp((y - PowerMinY) / (PowerMaxY - PowerMinY), 0, 1); }

        /// <summary>What the flick does to the throw: the push (inches, + right), the short-arm (inches, 0 or less) and the scatter multiplier.</summary>
        public ReleaseEffect PreviewRelease(ReleaseInfo r)
        {
            var lean = Math.Sign(r.AngleDeg) * Math.Max(0, Math.Abs(r.AngleDeg) - StraightDeg);
            var push = Round1(lean * PushInPerDeg);
            var shortIn = Round1(-Math.Max(0, MinFlickSpeed - r.Speed) * ShortInPerSpeed);
            var shake = Round1(Math.Min(MaxShake, 1 + Math.Max(0, r.HoldMs - SteadyHoldMs) / ShakePerMs));
            var verdict = "pure";
            if (shortIn <= -3) verdict = "short-armed";
            else if (Math.Abs(push) >= 2) verdict = push > 0 ? "pushed" : "pulled";
            else if (shake >= 1.5) verdict = "shaky";
            return new ReleaseEffect { PushIn = push, ShortIn = shortIn, Shake = shake, Spin = Clamp(r.Curve, -1, 1), Verdict = verdict };
        }

        public static double Clamp(double v, double lo, double hi) { return Math.Min(hi, Math.Max(lo, v)); }
        private static double Round1(double v) { var r = Math.Floor(v * 10 + 0.5) / 10; return r == 0 ? 0 : r; } // same rounding as the server (JavaScript Math.round)
    }

    public sealed class ReleaseEffect
    {
        public double PushIn, ShortIn, Shake, Spin;
        public string Verdict;
    }

    /// <summary>Turns a finger flick (a list of touch samples) into the numbers the server wants.</summary>
    public static class FlickAnalyzer
    {
        /// <summary>Only the last stretch of the gesture is the flick; earlier movement is the pull-back.</summary>
        public const double WindowSeconds = 0.14;
        /// <summary>A flick shorter than this (screen heights) is a tap or a slip, not a throw.</summary>
        public const double MinDistance = 0.04;

        public sealed class Result
        {
            public double Speed, AngleDeg, Curve;
            public bool IsFlick;
        }

        public static Result Analyze(IList<TouchSample> samples)
        {
            var r = new Result();
            if (samples == null || samples.Count < 2) return r;
            var last = samples[samples.Count - 1];
            var startIndex = samples.Count - 1;
            while (startIndex > 0 && last.T - samples[startIndex - 1].T <= WindowSeconds) startIndex--;
            var first = samples[startIndex];
            var dt = last.T - first.T;
            var dx = last.X - first.X;
            var dy = last.Y - first.Y;
            var len = Math.Sqrt(dx * dx + dy * dy);
            if (dt <= 1e-4 || len < MinDistance || dy <= 0) return r; // must move upward
            r.IsFlick = true;
            r.Speed = len / dt;
            r.AngleDeg = Math.Atan2(dx, dy) * 180.0 / Math.PI;
            // Curve: how far the path bows away from the straight line between its ends.
            double best = 0;
            for (var i = startIndex + 1; i < samples.Count - 1; i++)
            {
                var px = samples[i].X - first.X;
                var py = samples[i].Y - first.Y;
                var side = (dx * py - dy * px) / len; // positive = path is left of the line
                if (Math.Abs(side) > Math.Abs(best)) best = side;
            }
            r.Curve = ThrowGuide.Clamp(-best / len * 4.0, -1, 1); // + = curls right
            return r;
        }
    }

    public enum ThrowPhase { Idle, Aiming, PulledBack, Released }

    /// <summary>
    /// The state of one throw on the phone: line up (drag sideways), pull back (drag the bag down for
    /// distance), then flick up. Feed it touch events; take the finished <see cref="ThrowCommand"/> on release.
    /// </summary>
    public sealed class ThrowController
    {
        /// <summary>Pulling the bag this far down (screen heights) is full power.</summary>
        public const double FullPull = 0.30;
        /// <summary>Sideways drag (screen heights) to move the aim across its whole range.</summary>
        public const double AimRange = 0.6;
        public const double MaxAim = 0.85;
        /// <summary>Moving up faster than this (screen heights per second) is the flick starting, not the player easing off the pull.</summary>
        public const double FlickStartSpeed = 1.2;

        private readonly ThrowGuide guide;
        private readonly List<TouchSample> samples = new List<TouchSample>();
        private double pullStartT = -1;
        private double pullStartY;
        private bool flicking;

        public ThrowController(ThrowGuide guide, string shotId = "standard")
        {
            this.guide = guide;
            Shot = guide.Shot(shotId).Id;
            Aim = 0;
            Power = 0.5;
        }

        public string Shot { get; private set; }
        public double Aim { get; private set; }
        public double Power { get; private set; }
        public bool LeftHanded;
        public ThrowPhase Phase { get; private set; }

        public double Arc { get { return guide.Shot(Shot).Arc; } }
        public double Shake { get; private set; }

        public void SelectShot(string id) { Shot = guide.Shot(id).Id; }

        /// <summary>Drag sideways on the upper screen to turn the aim. dxHeights is the change since the last event.</summary>
        public void DragAim(double dxHeights)
        {
            if (Phase == ThrowPhase.Released) return;
            Phase = ThrowPhase.Aiming;
            Aim = ThrowGuide.Clamp(Aim + dxHeights / AimRange * 2.0, -MaxAim, MaxAim);
        }

        public void SetAim(double aim) { Aim = ThrowGuide.Clamp(aim, -MaxAim, MaxAim); }

        /// <summary>Touch the bag.</summary>
        public void BeginPull(double t, double x, double y)
        {
            samples.Clear();
            pullStartT = t;
            pullStartY = y;
            flicking = false;
            Phase = ThrowPhase.PulledBack;
            samples.Add(new TouchSample(t, x, y));
        }

        /// <summary>Move the touch. Down pulls the bag back and sets the power; the ring moves up the board as you pull.</summary>
        public void MovePull(double t, double x, double y)
        {
            if (Phase != ThrowPhase.PulledBack) return;
            var prev = samples[samples.Count - 1];
            samples.Add(new TouchSample(t, x, y));
            // Once the finger shoots upward the flick has begun: the power stays where the pull left it.
            var dt = t - prev.T;
            if (!flicking && dt > 1e-4 && (y - prev.Y) / dt > FlickStartSpeed) flicking = true;
            if (!flicking) Power = ThrowGuide.Clamp((pullStartY - y) / FullPull, 0, 1);
            Shake = ShakeAt(t);
        }

        /// <summary>How shaky the hand is right now (1 = steady). The hand should tremble on screen when this is above 1.</summary>
        public double ShakeAt(double t)
        {
            if (pullStartT < 0) return 1;
            var heldMs = (t - pullStartT) * 1000.0;
            return Math.Min(guide.MaxShake, 1 + Math.Max(0, heldMs - guide.SteadyHoldMs) / guide.ShakePerMs);
        }

        /// <summary>Let go. Returns the throw to send, or null if it was not a flick (so nothing is thrown and the pull is undone).</summary>
        public ThrowCommand Release(double t, double x, double y)
        {
            if (Phase != ThrowPhase.PulledBack) return null;
            samples.Add(new TouchSample(t, x, y));
            var flick = FlickAnalyzer.Analyze(samples);
            if (!flick.IsFlick)
            {
                Phase = ThrowPhase.Aiming;
                return null;
            }
            Phase = ThrowPhase.Released;
            var cmd = new ThrowCommand
            {
                Power = Power,
                Aim = Aim,
                Arc = Arc,
                Spin = 0,
                LeftHanded = LeftHanded,
                Release = new ReleaseInfo
                {
                    AngleDeg = ThrowGuide.Clamp(flick.AngleDeg, -60, 60),
                    Speed = ThrowGuide.Clamp(flick.Speed, 0, 30),
                    HoldMs = ThrowGuide.Clamp((t - pullStartT) * 1000.0, 0, 60000),
                    Curve = flick.Curve,
                },
            };
            return cmd;
        }

        /// <summary>Back to the start for the next throw. The player's last aim and shot stay, like a golf club.</summary>
        public void Reset()
        {
            samples.Clear();
            pullStartT = -1;
            flicking = false;
            Phase = ThrowPhase.Idle;
            Power = 0.5;
            Shake = 1;
        }

        /// <summary>The calm-day landing for the current aim and pull (where to draw the ring).</summary>
        public Point2 RingCenter { get { return guide.CalmLanding(Aim, Power); } }
    }
}
