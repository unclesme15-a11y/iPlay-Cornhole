using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace IPlay.Cornhole
{
    /// <summary>
    /// A small JSON reader/writer. Objects become Dictionary&lt;string, object&gt;, arrays List&lt;object&gt;,
    /// numbers double, plus string, bool and null. Unity's JsonUtility cannot read the server's
    /// free-form event data, and this keeps the core free of any package dependency.
    /// </summary>
    public static class MiniJson
    {
        public static object Parse(string json)
        {
            if (json == null) throw new ArgumentNullException("json");
            var p = new Parser(json);
            p.SkipWhite();
            var value = p.ReadValue();
            p.SkipWhite();
            if (!p.AtEnd) throw new FormatException("Unexpected text after the JSON value at " + p.Position);
            return value;
        }

        public static Dictionary<string, object> ParseObject(string json)
        {
            var o = Parse(json) as Dictionary<string, object>;
            if (o == null) throw new FormatException("Expected a JSON object");
            return o;
        }

        public static string Serialize(object value)
        {
            var sb = new StringBuilder();
            Write(sb, value);
            return sb.ToString();
        }

        private static void Write(StringBuilder sb, object v)
        {
            if (v == null) { sb.Append("null"); return; }
            var s = v as string;
            if (s != null) { WriteString(sb, s); return; }
            if (v is bool) { sb.Append((bool)v ? "true" : "false"); return; }
            if (v is double || v is float)
            {
                var d = Convert.ToDouble(v, CultureInfo.InvariantCulture);
                if (double.IsNaN(d) || double.IsInfinity(d)) throw new ArgumentException("JSON cannot hold NaN or infinity");
                sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
                return;
            }
            if (v is int || v is long || v is short || v is byte || v is uint || v is ulong)
            {
                sb.Append(Convert.ToString(v, CultureInfo.InvariantCulture));
                return;
            }
            var dict = v as System.Collections.IDictionary;
            if (dict != null)
            {
                sb.Append('{');
                var first = true;
                foreach (System.Collections.DictionaryEntry e in dict)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteString(sb, Convert.ToString(e.Key, CultureInfo.InvariantCulture));
                    sb.Append(':');
                    Write(sb, e.Value);
                }
                sb.Append('}');
                return;
            }
            var list = v as System.Collections.IEnumerable;
            if (list != null)
            {
                sb.Append('[');
                var first = true;
                foreach (var item in list)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    Write(sb, item);
                }
                sb.Append(']');
                return;
            }
            throw new ArgumentException("Cannot write " + v.GetType().Name + " as JSON");
        }

        private static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        private sealed class Parser
        {
            private readonly string s;
            private int i;
            public Parser(string text) { s = text; }
            public bool AtEnd { get { return i >= s.Length; } }
            public int Position { get { return i; } }

            public void SkipWhite()
            {
                while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++;
            }

            public object ReadValue()
            {
                if (AtEnd) throw new FormatException("Unexpected end of JSON");
                var c = s[i];
                if (c == '{') return ReadObject();
                if (c == '[') return ReadArray();
                if (c == '"') return ReadString();
                if (c == 't') { Expect("true"); return true; }
                if (c == 'f') { Expect("false"); return false; }
                if (c == 'n') { Expect("null"); return null; }
                return ReadNumber();
            }

            private void Expect(string word)
            {
                if (string.CompareOrdinal(s, i, word, 0, word.Length) != 0) throw new FormatException("Bad JSON at " + i);
                i += word.Length;
            }

            private Dictionary<string, object> ReadObject()
            {
                var result = new Dictionary<string, object>();
                i++; // {
                SkipWhite();
                if (i < s.Length && s[i] == '}') { i++; return result; }
                for (;;)
                {
                    SkipWhite();
                    if (AtEnd || s[i] != '"') throw new FormatException("Expected a key at " + i);
                    var key = ReadString();
                    SkipWhite();
                    if (AtEnd || s[i] != ':') throw new FormatException("Expected ':' at " + i);
                    i++;
                    SkipWhite();
                    result[key] = ReadValue();
                    SkipWhite();
                    if (AtEnd) throw new FormatException("Unterminated object");
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == '}') { i++; return result; }
                    throw new FormatException("Expected ',' or '}' at " + i);
                }
            }

            private List<object> ReadArray()
            {
                var result = new List<object>();
                i++; // [
                SkipWhite();
                if (i < s.Length && s[i] == ']') { i++; return result; }
                for (;;)
                {
                    SkipWhite();
                    result.Add(ReadValue());
                    SkipWhite();
                    if (AtEnd) throw new FormatException("Unterminated array");
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == ']') { i++; return result; }
                    throw new FormatException("Expected ',' or ']' at " + i);
                }
            }

            private string ReadString()
            {
                var sb = new StringBuilder();
                i++; // opening quote
                while (i < s.Length)
                {
                    var c = s[i++];
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    if (AtEnd) break;
                    var e = s[i++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (i + 4 > s.Length) throw new FormatException("Bad \\u escape");
                            sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16));
                            i += 4;
                            break;
                        default: throw new FormatException("Bad escape \\" + e);
                    }
                }
                throw new FormatException("Unterminated string");
            }

            private object ReadNumber()
            {
                var start = i;
                while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
                if (i == start) throw new FormatException("Unexpected character '" + s[i] + "' at " + i);
                double d;
                if (!double.TryParse(s.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture, out d))
                    throw new FormatException("Bad number at " + start);
                return d;
            }
        }
    }

    /// <summary>Safe readers for parsed JSON, so a missing field gives a default instead of a crash.</summary>
    public static class J
    {
        public static Dictionary<string, object> Obj(object o, string key)
        {
            var d = o as Dictionary<string, object>;
            object v;
            return d != null && d.TryGetValue(key, out v) ? v as Dictionary<string, object> : null;
        }

        public static List<object> Arr(object o, string key)
        {
            var d = o as Dictionary<string, object>;
            object v;
            return d != null && d.TryGetValue(key, out v) ? v as List<object> : null;
        }

        public static string Str(object o, string key, string fallback = null)
        {
            var d = o as Dictionary<string, object>;
            object v;
            return d != null && d.TryGetValue(key, out v) && v is string ? (string)v : fallback;
        }

        public static double Num(object o, string key, double fallback = 0)
        {
            var d = o as Dictionary<string, object>;
            object v;
            return d != null && d.TryGetValue(key, out v) && v is double ? (double)v : fallback;
        }

        public static int Int(object o, string key, int fallback = 0)
        {
            return (int)Math.Round(Num(o, key, fallback));
        }

        public static bool Bool(object o, string key, bool fallback = false)
        {
            var d = o as Dictionary<string, object>;
            object v;
            return d != null && d.TryGetValue(key, out v) && v is bool ? (bool)v : fallback;
        }

        public static bool Has(object o, string key)
        {
            var d = o as Dictionary<string, object>;
            return d != null && d.ContainsKey(key) && d[key] != null;
        }

        /// <summary>Build a JSON object from key, value pairs (skips null values).</summary>
        public static Dictionary<string, object> Make(params object[] pairs)
        {
            var d = new Dictionary<string, object>();
            for (var i = 0; i + 1 < pairs.Length; i += 2)
                if (pairs[i + 1] != null) d[(string)pairs[i]] = pairs[i + 1];
            return d;
        }
    }
}
