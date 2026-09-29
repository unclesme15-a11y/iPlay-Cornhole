namespace IPlay.Cornhole
{
    /// <summary>A colour with no Unity dependency (the Unity layer converts it to UnityEngine.Color).</summary>
    public struct Rgba
    {
        public readonly float R, G, B, A;
        public Rgba(float r, float g, float b, float a = 1f) { R = r; G = g; B = b; A = a; }
        public Rgba WithAlpha(float a) { return new Rgba(R, G, B, a); }
        public static Rgba Hex(string hex)
        {
            var h = hex.TrimStart('#');
            if (h.Length != 6 && h.Length != 8) return new Rgba(1, 1, 1);
            var r = System.Convert.ToInt32(h.Substring(0, 2), 16) / 255f;
            var g = System.Convert.ToInt32(h.Substring(2, 2), 16) / 255f;
            var b = System.Convert.ToInt32(h.Substring(4, 2), 16) / 255f;
            var a = h.Length == 8 ? System.Convert.ToInt32(h.Substring(6, 2), 16) / 255f : 1f;
            return new Rgba(r, g, b, a);
        }
    }

    /// <summary>
    /// The iPlay look, taken from the Street Dice project so the games feel like one family: distressed
    /// dark surfaces, a restrained cyan glow, gold edges, condensed brush-style lettering, and a hot
    /// red/orange that is kept for the one big moment (here: a cornhole streak). The values are the ones
    /// Street Dice uses in code (its menus, hand previews and readouts).
    /// </summary>
    public static class Theme
    {
        // surfaces
        public static readonly Rgba Backdrop = new Rgba(0.02f, 0.031f, 0.043f);      // menu and intro backdrop
        public static readonly Rgba Scene = new Rgba(0.018f, 0.02f, 0.02f);           // camera background behind the plate
        public static readonly Rgba Panel = new Rgba(0.06f, 0.07f, 0.07f);            // metal plate rows and panels
        public static readonly Rgba PanelEdge = new Rgba(0.95f, 0.72f, 0.18f);       // gold edge
        // accents
        public static readonly Rgba Cyan = new Rgba(0.05f, 0.8f, 0.95f);             // the restrained glow
        public static readonly Rgba SoftCyan = new Rgba(0.42f, 0.78f, 1f);           // "you" markers, active seat
        public static readonly Rgba Gold = new Rgba(0.95f, 0.72f, 0.18f);
        public static readonly Rgba GoldLight = new Rgba(1f, 0.84f, 0.42f);
        public static readonly Rgba Good = new Rgba(0.66f, 1f, 0.74f);               // success text
        public static readonly Rgba Green = new Rgba(0.1f, 0.72f, 0.35f);            // streak / positive meter
        /// <summary>Reserved. Street Dice keeps red/orange for a full hot streak only; cornhole uses it for a win streak of 5+ and nothing else.</summary>
        public static readonly Rgba Hot = new Rgba(1f, 0.23f, 0.02f);
        public static readonly Rgba TextDim = new Rgba(0.62f, 0.66f, 0.68f, 0.75f);  // unavailable choices
        public static readonly Rgba Text = new Rgba(0.92f, 0.94f, 0.94f);

        // type: Street Dice menus use Barlow Condensed SemiBold, big and centred
        public const string DisplayFontResource = "UI/BarlowCondensed-SemiBold";
        public const int TitleSize = 38;
        public const int HeadingSize = 30;
        public const int BodySize = 24;
        public const int SmallSize = 18;

        /// <summary>Street Dice's UI restraint rule: keep the screen quiet unless the player needs something.</summary>
        public const string Restraint = "Only what the player needs right now is on screen. Numbers and helpers stay hidden unless tutorial mode is on.";

        public static Rgba RankColor(int rank)
        {
            if (rank == 1) return GoldLight;
            if (rank <= 3) return Gold;
            if (rank <= 10) return SoftCyan;
            return Text;
        }

        /// <summary>Hot red/orange appears only on a streak of 5 or more.</summary>
        public static Rgba StreakColor(int streak) { return streak >= 5 ? Hot : (streak >= 2 ? Green : Text); }
    }
}
