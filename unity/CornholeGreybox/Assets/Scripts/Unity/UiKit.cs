using UnityEngine;
using IPlay.Cornhole;

/// <summary>
/// The iPlay look in immediate-mode UI, like Street Dice: dark surfaces, a restrained cyan glow, gold edges,
/// condensed lettering. This is deliberately plain: it makes every screen usable and testable now, and the final
/// art pass (metal plates, brush lettering, motion) replaces the drawing without touching the game logic.
/// </summary>
public static class UiKit
{
    /// <summary>The shorter side of the screen is this many logical units, so layouts look the same on every phone.</summary>
    public const float ShortSide = 720f;

    public static float Scale { get; private set; } = 1f;
    public static float W { get; private set; } = 1280f;
    public static float H { get; private set; } = 720f;
    public static bool Portrait { get { return H > W; } }

    private static Font font;
    private static bool fontLoaded;
    private static Texture2D white;

    public static Color C(Rgba c) { return new Color(c.R, c.G, c.B, c.A); }

    /// <summary>Call first in OnGUI. Sets the scale and returns the logical width and height.</summary>
    public static void Begin()
    {
        Scale = Mathf.Min(Screen.width, Screen.height) / ShortSide;
        if (Scale < 0.1f) Scale = 1f;
        W = Screen.width / Scale;
        H = Screen.height / Scale;
        GUI.matrix = Matrix4x4.Scale(new Vector3(Scale, Scale, 1f));
        if (!fontLoaded) { font = Resources.Load<Font>(Theme.DisplayFontResource); fontLoaded = true; }
        white = Texture2D.whiteTexture;
    }

    private static readonly System.Collections.Generic.Dictionary<string, GUIStyle> styles = new System.Collections.Generic.Dictionary<string, GUIStyle>();

    /// <summary>Text styles are cached (IMGUI asks for one per label per frame). Do not modify the result.</summary>
    public static GUIStyle Style(int size, TextAnchor anchor = TextAnchor.MiddleCenter, Rgba? color = null, FontStyle fontStyle = FontStyle.Normal)
    {
        var col = color ?? Theme.Text;
        var key = size + "|" + (int)anchor + "|" + (int)fontStyle + "|" + col.R + "," + col.G + "," + col.B + "," + col.A;
        GUIStyle s;
        if (styles.TryGetValue(key, out s)) return s;
        s = new GUIStyle(GUI.skin.label) { fontSize = size, alignment = anchor, fontStyle = fontStyle, wordWrap = true, clipping = TextClipping.Clip };
        if (font != null) s.font = font;
        var c = C(col);
        s.normal.textColor = c;
        s.hover.textColor = c;
        if (styles.Count > 400) styles.Clear();
        styles[key] = s;
        return s;
    }

    public static void Fill(Rect r, Rgba c)
    {
        var old = GUI.color;
        GUI.color = C(c);
        GUI.DrawTexture(r, white);
        GUI.color = old;
    }

    public static void Edge(Rect r, Rgba c, float t = 2f)
    {
        Fill(new Rect(r.x, r.y, r.width, t), c);
        Fill(new Rect(r.x, r.yMax - t, r.width, t), c);
        Fill(new Rect(r.x, r.y, t, r.height), c);
        Fill(new Rect(r.xMax - t, r.y, t, r.height), c);
    }

    public static void Backdrop() { Fill(new Rect(0, 0, W, H), Theme.Backdrop); }

    /// <summary>A dark panel with a gold edge (the "metal plate" stand-in).</summary>
    public static void Panel(Rect r, bool glow = false)
    {
        Fill(r, Theme.Panel);
        Edge(r, glow ? Theme.Cyan : Theme.PanelEdge, glow ? 3f : 2f);
    }

    public static void Text(Rect r, string text, int size = Theme.BodySize, TextAnchor anchor = TextAnchor.MiddleCenter, Rgba? color = null)
    {
        GUI.Label(r, text, Style(size, anchor, color));
    }

    public static void Title(string text, float y = 40f)
    {
        Text(new Rect(0, y, W, 60f), text, Theme.TitleSize, TextAnchor.MiddleCenter, Theme.GoldLight);
    }

    /// <summary>A button: dark plate, gold edge, cyan when pressed or highlighted. Returns true when tapped.</summary>
    public static bool Button(Rect r, string label, bool enabled = true, bool highlight = false, int size = Theme.HeadingSize)
    {
        Fill(r, highlight ? new Rgba(0.05f, 0.16f, 0.2f) : Theme.Panel);
        Edge(r, enabled ? (highlight ? Theme.Cyan : Theme.PanelEdge) : Theme.TextDim, 2f);
        GUI.Label(r, label, Style(size, TextAnchor.MiddleCenter, enabled ? Theme.Text : Theme.TextDim));
        return enabled && GUI.Button(r, GUIContent.none, GUIStyle.none);
    }

    /// <summary>Plain tappable text (used for BACK and links), like Street Dice's flow choices.</summary>
    public static bool Link(Rect r, string label, int size = Theme.BodySize, Rgba? color = null)
    {
        GUI.Label(r, label, Style(size, TextAnchor.MiddleCenter, color ?? Theme.SoftCyan));
        return GUI.Button(r, GUIContent.none, GUIStyle.none);
    }

    public static bool Toggle(Rect r, string label, bool value)
    {
        var box = new Rect(r.x, r.y + (r.height - 34f) / 2f, 34f, 34f);
        Edge(box, Theme.PanelEdge, 2f);
        if (value) Fill(new Rect(box.x + 7f, box.y + 7f, 20f, 20f), Theme.Cyan);
        GUI.Label(new Rect(r.x + 48f, r.y, r.width - 48f, r.height), label, Style(Theme.BodySize, TextAnchor.MiddleLeft));
        return GUI.Button(r, GUIContent.none, GUIStyle.none) ? !value : value;
    }

    public static string TextField(Rect r, string value, int maxLength = 30)
    {
        Fill(r, new Rgba(0.03f, 0.04f, 0.045f));
        Edge(r, Theme.SoftCyan, 2f);
        var style = new GUIStyle(Style(Theme.BodySize, TextAnchor.MiddleLeft)) { padding = new RectOffset(12, 12, 0, 0) }; // a copy: the text field needs its own padding
        return GUI.TextField(r, value ?? "", maxLength, style);
    }

    /// <summary>An arrow at <paramref name="center"/> pointing angleDeg clockwise from straight up (0 = up, 90 = right).</summary>
    public static void Arrow(Vector2 center, float angleDeg, float length, Rgba color)
    {
        var old = GUI.matrix;
        GUIUtility.RotateAroundPivot(angleDeg, center);
        Fill(new Rect(center.x - 4f, center.y - length * 0.15f, 8f, length * 0.65f), color);        // shaft (tail below the centre)
        Fill(new Rect(center.x - 13f, center.y - length * 0.5f, 26f, 8f), color);                    // head bar
        Fill(new Rect(center.x - 8f, center.y - length * 0.5f - 8f, 16f, 8f), color);               // head tip
        GUI.matrix = old;
    }

    public static Rect Center(float w, float h, float yOffset = 0f) { return new Rect((W - w) / 2f, (H - h) / 2f + yOffset, w, h); }

    /// <summary>Back link in the bottom-left corner.</summary>
    public static bool Back(string label = "BACK") { return Link(new Rect(28f, H - 78f, 160f, 48f), label, Theme.HeadingSize, Theme.Text); }

    /// <summary>Small toast at the bottom (errors and confirmations).</summary>
    public static void Toast(string message)
    {
        if (string.IsNullOrEmpty(message)) return;
        var r = new Rect(W * 0.1f, H - 150f, W * 0.8f, 56f);
        Fill(r, new Rgba(0.02f, 0.02f, 0.02f, 0.92f));
        Edge(r, Theme.Gold, 2f);
        Text(r, message, Theme.SmallSize + 2);
    }
}
