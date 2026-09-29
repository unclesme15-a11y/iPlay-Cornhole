using System;
using System.Collections.Generic;

namespace IPlay.Cornhole
{
    /// <summary>Where everything is at one moment of a throw's replay.</summary>
    public sealed class ReplayFrame
    {
        /// <summary>"flight" (in the air), "slide" (on the board, moving) or "rest" (finished).</summary>
        public string Phase;
        /// <summary>The thrown bag: board coordinates in inches (x from the centre line, y from the target board's front edge).</summary>
        public Point2 Bag;
        /// <summary>Height above the ground in inches while in flight, otherwise 0.</summary>
        public double Height;
        /// <summary>Every bag on the board that has moved so far (including the thrown one once it lands).</summary>
        public Dictionary<string, Point2> Board = new Dictionary<string, Point2>();
        /// <summary>Bags that have dropped in the hole by this moment.</summary>
        public HashSet<string> InHole = new HashSet<string>();
    }

    /// <summary>
    /// Plays a <see cref="ThrowResult"/> back. The server already decided the result; this only says where
    /// the bags are at time t (milliseconds since the release) so the visuals can draw them, and which
    /// sound/LED cues are due. Every phone gets the same frames, so everybody sees the same landing.
    /// </summary>
    public static class ThrowReplay
    {
        public static ReplayFrame At(ThrowResult r, double tMs, IDictionary<string, BoardBag> boardBefore)
        {
            var f = new ReplayFrame();
            if (boardBefore != null)
                foreach (var kv in boardBefore)
                    if (kv.Value.HasPosition && kv.Value.Status == "board") f.Board[kv.Key] = new Point2(kv.Value.X, kv.Value.Y);

            if (tMs < r.FlightMs)
            {
                f.Phase = "flight";
                if (r.Flight.Count == 0)
                {
                    f.Bag = r.Landing; // no frames were kept for this throw: just show where it came down
                    return f;
                }
                var s = Sample(r.Flight, tMs);
                f.Bag = new Point2(s.X, s.Y);
                f.Height = s.Z;
                return f;
            }

            f.Phase = tMs >= r.DurationMs ? "rest" : "slide";
            f.Height = 0;
            f.Bag = r.Landing;
            f.Board[r.BagId] = r.Landing;
            var sinceTouch = tMs - r.FlightMs;
            foreach (var frame in r.Slide)
            {
                if (frame.T > sinceTouch) break;
                foreach (var kv in frame.Bags) f.Board[kv.Key] = kv.Value;
            }
            if (f.Phase == "rest")
                foreach (var kv in r.Resting) f.Board[kv.Key] = kv.Value;
            f.Bag = f.Board.ContainsKey(r.BagId) ? f.Board[r.BagId] : f.Bag;

            foreach (var h in r.HoleEvents)
                if (h.TMs <= tMs) { f.InHole.Add(h.BagId); f.Board.Remove(h.BagId); }
            return f;
        }

        /// <summary>Linear interpolation between the two flight samples around t.</summary>
        private static FlightSample Sample(List<FlightSample> flight, double t)
        {
            if (flight.Count == 0) return new FlightSample();
            if (t <= flight[0].T) return flight[0];
            for (var i = 1; i < flight.Count; i++)
            {
                if (t > flight[i].T) continue;
                var a = flight[i - 1];
                var b = flight[i];
                var u = b.T - a.T < 1e-9 ? 1 : (t - a.T) / (b.T - a.T);
                return new FlightSample { T = t, X = a.X + (b.X - a.X) * u, Y = a.Y + (b.Y - a.Y) * u, Z = a.Z + (b.Z - a.Z) * u };
            }
            return flight[flight.Count - 1];
        }

        /// <summary>The sound and light cues that fall in (fromMs, toMs]. Call every frame with the last time and this time.</summary>
        public static List<Cue> CuesBetween(ThrowResult r, double fromMs, double toMs)
        {
            var due = new List<Cue>();
            foreach (var c in r.Cues)
                if (c.AtMs > fromMs && c.AtMs <= toMs) due.Add(c);
            return due;
        }

        /// <summary>The first moment (ms) a bag dropped into the hole, or -1. The board's lights and the ring-in sound fire then.</summary>
        public static double FirstHoleMs(ThrowResult r)
        {
            var best = -1.0;
            foreach (var h in r.HoleEvents) if (best < 0 || h.TMs < best) best = h.TMs;
            return best;
        }
    }
}
