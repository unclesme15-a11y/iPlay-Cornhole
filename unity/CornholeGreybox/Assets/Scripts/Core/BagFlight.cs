using System;
using System.Collections.Generic;

namespace IPlay.Cornhole
{
    /// <summary>A point in world meters (the hand rig) or a plain 3-vector. No Unity types.</summary>
    public struct FlightVec
    {
        public double X, Y, Z;
        public FlightVec(double x, double y, double z) { X = x; Y = y; Z = z; }
        public static FlightVec operator +(FlightVec a, FlightVec b) { return new FlightVec(a.X + b.X, a.Y + b.Y, a.Z + b.Z); }
        public static FlightVec operator -(FlightVec a, FlightVec b) { return new FlightVec(a.X - b.X, a.Y - b.Y, a.Z - b.Z); }
        public static FlightVec operator *(FlightVec a, double s) { return new FlightVec(a.X * s, a.Y * s, a.Z * s); }
        public double LengthSq { get { return X * X + Y * Y + Z * Z; } }
        public double Length { get { return Math.Sqrt(LengthSq); } }
        public static double Dot(FlightVec a, FlightVec b) { return a.X * b.X + a.Y * b.Y + a.Z * b.Z; }
        public static double Distance(FlightVec a, FlightVec b) { return (a - b).Length; }

        public FlightVec NormalizedOr(FlightVec fallback)
        {
            var n = Length;
            if (n < 1e-8 || double.IsNaN(n) || double.IsInfinity(n)) return fallback;
            return this * (1.0 / n);
        }

        public override string ToString() { return "(" + X.ToString("0.####") + ", " + Y.ToString("0.####") + ", " + Z.ToString("0.####") + ")"; }
    }

    /// <summary>
    /// Board inches (x right of the centre line, y down the lane from the target board's front edge, z height)
    /// into a world frame in meters. The frame is anchored so one board point — the server's release sample —
    /// lands on the hand's release pose. Later samples keep that same scale and facing.
    /// </summary>
    public struct LaneFrame
    {
        public FlightVec Origin, Right, Up, Forward;
        public double BoardYAtOrigin;
        public double MetersPerInch;

        public FlightVec ToWorld(double boardX, double boardY, double heightIn)
        {
            var s = MetersPerInch;
            return Origin + Right * (boardX * s) + Forward * ((boardY - BoardYAtOrigin) * s) + Up * (heightIn * s);
        }

        /// <summary>Build the frame that places (boardX, boardY, heightIn) exactly on <paramref name="releaseWorld"/>.</summary>
        public static LaneFrame Anchored(FlightVec releaseWorld, FlightVec right, FlightVec up, FlightVec forward, double boardX, double boardY, double heightIn)
        {
            right = right.NormalizedOr(new FlightVec(1, 0, 0));
            up = up.NormalizedOr(new FlightVec(0, 1, 0));
            forward = forward.NormalizedOr(new FlightVec(0, 0, 1));
            var s = BagFlightVisual.MetersPerInch;
            // Board-y of the anchor is BoardYAtOrigin, so the forward term is 0 there.
            var origin = releaseWorld - right * (boardX * s) - up * (heightIn * s);
            return new LaneFrame
            {
                Origin = origin,
                Right = right,
                Up = up,
                Forward = forward,
                BoardYAtOrigin = boardY,
                MetersPerInch = s,
            };
        }
    }

    /// <summary>
    /// The deck the bag sits on after it lands. Heights match the server board
    /// (front 3.5 in, back 12 in, 48 in long). Replay frames report height 0 once the bag is
    /// on the deck, which is right for the top-down map and wrong for a 3D bag.
    /// </summary>
    public static class BoardDeck
    {
        public const double WidthIn = 24;
        public const double LengthIn = 48;
        public const double FrontHeightIn = 3.5;
        public const double BackHeightIn = 12;

        public static double HeightAt(double yIn)
        {
            var y = yIn < 0 ? 0 : (yIn > LengthIn ? LengthIn : yIn);
            return FrontHeightIn + (BackHeightIn - FrontHeightIn) * y / LengthIn;
        }

        public static bool Contains(double xIn, double yIn)
        {
            return yIn >= 0 && yIn <= LengthIn && Math.Abs(xIn) <= WidthIn * 0.5;
        }

        /// <summary>Height in inches to draw for this replay frame. Flight uses the sample; the deck uses the board surface; a miss stays on the grass.</summary>
        public static double DrawHeight(ReplayFrame frame, ThrowResult result)
        {
            if (frame == null) return 0;
            if (frame.Phase == "flight") return frame.Height;
            if (result != null && result.BagId != null && frame.InHole != null && frame.InHole.Contains(result.BagId))
                return frame.Height;
            if (BoardDeck.Contains(frame.Bag.X, frame.Bag.Y)) return HeightAt(frame.Bag.Y);
            return 0;
        }
    }

    public enum BagFlightMode { InHand, LocalArc, Replay }

    /// <summary>One pose for the one bag. <see cref="Drive"/> false means leave the rig's grip alone.</summary>
    public struct BagFlightPose
    {
        public bool Drive;
        public bool Visible;
        public FlightVec Position;
        public BagFlightMode Mode;
        /// <summary>"in-hand", "local", "flight", "slide", or "rest".</summary>
        public string Phase;
    }

    /// <summary>
    /// Flies the one bag after the hand lets go.
    ///
    /// The rig releases the bag partway through its swing (about 0.48s after the throw result,
    /// which is also when the phone's replay clock normally starts). A replay frame at that
    /// moment is already down the lane. Drawing it raw would pop the bag out of the hand.
    ///
    /// This anchors server time 0 to the release pose and then follows <see cref="ThrowReplay"/>.
    /// That is the same path <c>OnReplayFrame</c> is built from, read on a clock that starts at
    /// the handoff. If the server path is missing, a local arc flies from the release velocity.
    /// It does not score. A path that shows up later eases in from wherever that arc has reached,
    /// so the bag never teleports and a second pose is never produced.
    /// </summary>
    public sealed class BagFlightVisual
    {
        public const double MetersPerInch = 0.0254;
        /// <summary>Visual-only fallback, meters per second squared, along the lane's up axis.</summary>
        public const double FallbackGravity = 9.81;
        /// <summary>Shortest ease onto a late server path. A release that already has a path blends across the remaining flight, which is usually longer.</summary>
        public const double MinBlendSeconds = 0.12;

        public BagFlightMode Mode { get; private set; }
        public LaneFrame Lane { get; private set; }
        public bool HasLane { get; private set; }
        public bool IsReleased { get; private set; }

        private ThrowResult result;
        private Dictionary<string, BoardBag> boardBefore;
        private bool laneLocked;
        private bool hasAxes;
        private FlightVec axesRight, axesUp, axesForward;

        private FlightVec releasePosition, releaseDirection;
        private double releaseSpeed, releaseAge;
        private bool localGrounded;
        private FlightVec localRest;

        private FlightVec blendError;
        private double blendStartAge, blendDuration;
        private bool blending;

        public void Clear()
        {
            Mode = BagFlightMode.InHand;
            result = null;
            boardBefore = null;
            laneLocked = false;
            HasLane = false;
            IsReleased = false;
            localGrounded = false;
            blending = false;
        }

        /// <summary>World axes for the lane. Ignored once a throw has anchored the frame, so the bag cannot jump.</summary>
        public void SetAxes(FlightVec right, FlightVec up, FlightVec forward)
        {
            if (laneLocked) return;
            axesRight = right;
            axesUp = up;
            axesForward = forward;
            hasAxes = true;
        }

        /// <summary>The server throw is in. The bag stays in the hand until <see cref="Release"/>.</summary>
        public void BeginServerThrow(ThrowResult throwResult, IDictionary<string, BoardBag> board)
        {
            result = throwResult;
            boardBefore = CopyBoard(board);
            laneLocked = false;
            HasLane = false;
            IsReleased = false;
            localGrounded = false;
            blending = false;
            Mode = BagFlightMode.InHand;
        }

        /// <summary>
        /// A replay frame arrived. Before the release this only records that the path is live.
        /// After a local arc has been flying, the server path takes over from the current pose.
        /// </summary>
        public void NoteReplayFrame(ThrowResult throwResult, ReplayFrame frame, double ageSeconds)
        {
            if (throwResult != null) result = throwResult;
            if (!IsReleased || Mode != BagFlightMode.LocalArc || !HasAuthoritativePath) return;
            if (frame == null && throwResult == null) return;
            ArmReplay(ageSeconds, LocalPosition(ageSeconds));
        }

        /// <summary>The hand let go. <paramref name="ageSeconds"/> is seconds since the throw result, on the same clock as later <see cref="Sample"/> calls.</summary>
        public void Release(FlightVec position, FlightVec direction, double speed, double ageSeconds)
        {
            var forward = ForwardAxis();
            releasePosition = position;
            releaseDirection = direction.NormalizedOr(forward);
            releaseSpeed = speed > 0 ? speed : 0;
            releaseAge = ageSeconds;
            IsReleased = true;
            localGrounded = false;
            blending = false;
            if (HasAuthoritativePath) ArmReplay(ageSeconds, position);
            else Mode = BagFlightMode.LocalArc;
        }

        public BagFlightPose Sample(double ageSeconds)
        {
            if (!IsReleased || Mode == BagFlightMode.InHand)
                return new BagFlightPose { Drive = false, Visible = false, Mode = BagFlightMode.InHand, Phase = "in-hand", Position = releasePosition };

            if (Mode == BagFlightMode.LocalArc && HasAuthoritativePath)
                ArmReplay(ageSeconds, LocalPosition(ageSeconds));

            if (Mode == BagFlightMode.LocalArc) return LocalPose(ageSeconds);
            if (!HasAuthoritativePath)
            {
                Mode = BagFlightMode.LocalArc;
                return LocalPose(ageSeconds);
            }
            return ReplayPose(ageSeconds);
        }

        /// <summary>The bag has reached the board or the ground, so the next aim may take the prop back.</summary>
        public bool HasLanded(double ageSeconds)
        {
            if (!IsReleased || Mode == BagFlightMode.InHand) return true;
            if (Mode == BagFlightMode.LocalArc)
            {
                LocalPosition(ageSeconds);
                return localGrounded;
            }
            if (!HasAuthoritativePath || result == null) return true;
            if (blending && BlendU(ageSeconds) < 1) return false;
            return (ageSeconds - releaseAge) * 1000.0 >= result.FlightMs;
        }

        /// <summary>Server pose at this age, after the lane is anchored. False before the release arms it.</summary>
        public bool TryAuthority(double ageSeconds, out FlightVec position)
        {
            position = default(FlightVec);
            if (!IsReleased || !HasAuthoritativePath || !HasLane) return false;
            position = AuthorityPosition(ageSeconds - releaseAge);
            return true;
        }

        private bool HasAuthoritativePath
        {
            get { return result != null && result.Flight != null && result.Flight.Count >= 2; }
        }

        private void ArmReplay(double ageSeconds, FlightVec visualPosition)
        {
            EnsureLane();
            var visual = ageSeconds - releaseAge;
            if (visual < 0) visual = 0;
            var auth = AuthorityPosition(visual);
            blendError = visualPosition - auth;
            blendStartAge = ageSeconds;
            var remain = result.FlightMs / 1000.0 - visual;
            blendDuration = remain > MinBlendSeconds ? remain : MinBlendSeconds;
            blending = true;
            Mode = BagFlightMode.Replay;
        }

        private void EnsureLane()
        {
            if (laneLocked && HasLane) return;
            var sample = result.Flight[0];
            Lane = LaneFrame.Anchored(releasePosition, RightAxis(), UpAxis(), ForwardAxis(), sample.X, sample.Y, sample.Z);
            HasLane = true;
            laneLocked = true;
        }

        private BagFlightPose ReplayPose(double ageSeconds)
        {
            var visual = ageSeconds - releaseAge;
            if (visual < 0) visual = 0;
            var position = Blended(ageSeconds, AuthorityPosition(visual));
            var frame = ThrowReplay.At(result, visual * 1000.0, boardBefore);
            var inHole = result.BagId != null && frame.InHole.Contains(result.BagId);
            var stillBlending = blending && BlendU(ageSeconds) < 1;
            return new BagFlightPose
            {
                Drive = true,
                Visible = !inHole || stillBlending,
                Position = position,
                Mode = BagFlightMode.Replay,
                Phase = frame.Phase ?? "flight",
            };
        }

        private FlightVec Blended(double ageSeconds, FlightVec auth)
        {
            if (!blending) return auth;
            var u = BlendU(ageSeconds);
            var s = Smooth(u);
            if (s >= 1)
            {
                blending = false;
                return auth;
            }
            return auth + blendError * (1.0 - s);
        }

        private double BlendU(double ageSeconds)
        {
            if (blendDuration <= 1e-9) return 1;
            var u = (ageSeconds - blendStartAge) / blendDuration;
            // Snap the end so a binary-inexact flight length still counts as arrived.
            if (u >= 1 - 1e-9) return 1;
            if (u < 0) return 0;
            return u;
        }

        private FlightVec AuthorityPosition(double visualSeconds)
        {
            if (visualSeconds < 0) visualSeconds = 0;
            var frame = ThrowReplay.At(result, visualSeconds * 1000.0, boardBefore);
            return Lane.ToWorld(frame.Bag.X, frame.Bag.Y, BoardDeck.DrawHeight(frame, result));
        }

        private BagFlightPose LocalPose(double ageSeconds)
        {
            var position = LocalPosition(ageSeconds);
            return new BagFlightPose
            {
                Drive = true,
                Visible = true,
                Position = position,
                Mode = BagFlightMode.LocalArc,
                Phase = localGrounded ? "rest" : "local",
            };
        }

        private FlightVec LocalPosition(double ageSeconds)
        {
            if (localGrounded) return localRest;
            var up = UpAxis();
            var dt = ageSeconds - releaseAge;
            if (dt < 0) dt = 0;
            var pos = releasePosition + releaseDirection * (releaseSpeed * dt) + up * (-0.5 * FallbackGravity * dt * dt);
            var height = FlightVec.Dot(pos - GroundOrigin(), up);
            if (height <= 0)
            {
                pos = pos - up * height;
                localGrounded = true;
                localRest = pos;
            }
            return pos;
        }

        private FlightVec GroundOrigin()
        {
            return HasLane ? Lane.Origin : new FlightVec(0, 0, 0);
        }

        private FlightVec RightAxis()
        {
            return hasAxes ? axesRight.NormalizedOr(new FlightVec(1, 0, 0)) : new FlightVec(1, 0, 0);
        }

        private FlightVec UpAxis()
        {
            return hasAxes ? axesUp.NormalizedOr(new FlightVec(0, 1, 0)) : new FlightVec(0, 1, 0);
        }

        private FlightVec ForwardAxis()
        {
            return hasAxes ? axesForward.NormalizedOr(new FlightVec(0, 0, 1)) : new FlightVec(0, 0, 1);
        }

        private static double Smooth(double u)
        {
            if (u <= 0) return 0;
            if (u >= 1) return 1;
            return u * u * (3.0 - 2.0 * u);
        }

        private static Dictionary<string, BoardBag> CopyBoard(IDictionary<string, BoardBag> board)
        {
            var copy = new Dictionary<string, BoardBag>();
            if (board == null) return copy;
            foreach (var kv in board)
            {
                var bag = kv.Value;
                if (bag == null) continue;
                copy[kv.Key] = new BoardBag
                {
                    Id = bag.Id,
                    Team = bag.Team,
                    Status = bag.Status,
                    X = bag.X,
                    Y = bag.Y,
                    HasPosition = bag.HasPosition,
                };
            }
            return copy;
        }
    }
}
