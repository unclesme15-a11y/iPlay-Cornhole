using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using IPlay.Cornhole;

// One match: lobby, character and colour picks, the coin toss, throwing (drag to aim, pull back, flick), the
// results with the rating change, and the safety tools (voice controls, report, block). The plain top-down board
// here is a working greybox; the final art plugs in through MatchPresenter.
public sealed partial class CornholeApp
{
    private MatchSession match;
    private CornholeVivoxVoiceClient voice;
    private VoiceGrant voiceGrant;
    private bool voiceStarted, leaveConfirm;
    private MatchPresenter presenter;

    // replay of the latest throw
    private ThrowResult replayResult;
    private float replayStart;
    private double replayLastMs;
    private string banner;
    private float bannerUntil;
    private SeatInfo reportTarget;

    // finger tracking
    private bool pointerDown, pointerPulling;
    private Vector2 lastPointer;

    // ---------------------------------------------------------------- open and close
    private void OpenMatch(string id)
    {
        CloseMatch(false);
        match = new MatchSession(api, new ClientWebSocketFactory(), Guide, id, settings.LastShot);
        match.Throw.LeftHanded = settings.LeftHanded;
        var model = match.Model;
        model.ThrowResultReceived += OnThrowResult;
        model.Scored += (team, pts) => { if (presenter != null) presenter.OnScore(team, pts); };
        model.WindChanged += w => { if (presenter != null) presenter.OnWind(w); };
        model.MatchEnded += (winner, reason) => { ads.MatchFinished(); if (presenter != null) presenter.OnMatchEnded(winner, reason); };
        model.SeatForfeited += (seat, reason) => Say(seat == model.YouSeat ? "You left the match." : "Your opponent left the match. You win!", 5f);
        match.Fatal += OnMatchFatal;
        voiceStarted = false;
        replayResult = null;
        banner = null;
        leaveConfirm = false;
        reportTarget = null;
        presenter = FindFirstObjectByType<MatchPresenter>();
        if (presenter != null) presenter.OnMatchOpened(model, Guide);
        match.Connect(account.Account.Id);
        Go(Page.Match);
    }

    private void OnMatchFatal(int code)
    {
        Say(code == CloseCodes.NotFound ? "That match isn't running any more." : code == CloseCodes.Banned ? "This account is banned." : code == CloseCodes.UpdateRequired ? "Please update the app." : "You were signed out.", 5f);
        CloseMatch(true);
    }

    private void CloseMatch(bool backToMenu)
    {
        if (voice != null) { Destroy(voice); voice = null; }
        voiceGrant = null;
        if (match != null)
        {
            match.Disconnect();
            if (presenter != null) presenter.OnMatchClosed();
            match = null;
        }
        replayResult = null;
        if (backToMenu)
        {
            Go(Page.Menu);
            _ = RefreshAfterMatch();
        }
    }

    private async Task RefreshAfterMatch()
    {
        try { await account.RefreshAsync(); } catch (ApiException) { }
        MaybeShowInterstitial();
    }

    // ---------------------------------------------------------------- per frame
    private void UpdateMatch()
    {
        if (match == null) return;
        var model = match.Model;
        if (!voiceStarted && match.IsConnected && !model.IsOver && settings.Voice && VoiceOn && model.YouSeat != null)
        {
            voiceStarted = true;
            _ = StartVoice(match.Id);
        }
        UpdateReplay();
        if (model.Phase == "playing") UpdateThrowInput();
        else pointerDown = false;
        if (model.Rematch != null && J.Str(model.Rematch, "matchId") != null && model.IsOver && match.Model.Rematch != null)
        {
            var next = J.Str(model.Rematch, "matchId");
            if (next != null && next != match.Id) OpenMatch(next);
        }
    }

    private bool VoiceOn { get { return account.Meta != null && J.Bool(J.Obj(account.Meta, "voice"), "enabled"); } }

    private async Task StartVoice(string matchId)
    {
        try
        {
            voiceGrant = VoiceGrant.From(await api.VoiceGrant(matchId));
            if (match == null || match.Id != matchId) return; // left already
            voice = gameObject.AddComponent<CornholeVivoxVoiceClient>();
            voice.Join(api, matchId, voiceGrant, settings.StartMuted ? TalkTarget.Nobody : TalkTarget.Table);
        }
        catch (ApiException e)
        {
            if (e.Code != "voice_unavailable") Say("Voice chat isn't available right now.");
        }
    }

    // ---------------------------------------------------------------- results of a throw
    private void OnThrowResult(ThrowResult r)
    {
        replayResult = r;
        replayStart = Time.unscaledTime;
        replayLastMs = -1;
        banner = DescribeThrow(r);
        bannerUntil = Time.unscaledTime + 4f + (float)(r.DurationMs / 1000.0);
        if (presenter != null) presenter.OnThrowResult(r, match.Model.BoardBeforeLastThrow);
    }

    private string DescribeThrow(ThrowResult r)
    {
        var mine = r.Seat == match.Model.YouSeat;
        var who = mine ? "You" : (match.Model.Seat(r.Seat) != null ? match.Model.Seat(r.Seat).Name : "They");
        string line;
        if (r.Status == "hole") line = "CORNHOLE!";
        else if (r.Status == "ground") line = r.Foul == "missed_board" ? "Missed the board" : "Foul";
        else line = "On the board";
        if (mine && r.Release != null && r.Release.Verdict != "pure")
            line += "\n" + Describe(r.Release);
        if (r.WindCross != 0 && Math.Abs(r.DriftX) >= 1.5)
            line += "\nWind pushed it " + Math.Abs(r.DriftX).ToString("0.0") + " in " + (r.DriftX > 0 ? "right" : "left");
        return (mine ? "" : who + ": ") + line;
    }

    private static string Describe(ReleaseVerdict v)
    {
        switch (v.Verdict)
        {
            case "pushed": return "Flick pushed it right";
            case "pulled": return "Flick pulled it left";
            case "short-armed": return "Short-armed: flick harder";
            case "shaky": return "Shaky hand: don't hold so long";
            default: return "";
        }
    }

    private void UpdateReplay()
    {
        if (replayResult == null) return;
        var ms = (Time.unscaledTime - replayStart) * 1000.0;
        foreach (var cue in ThrowReplay.CuesBetween(replayResult, replayLastMs, ms))
        {
            sounds.PlayCue(cue);
            if (presenter != null) presenter.OnCue(cue, settings.ReduceMotion);
        }
        if (presenter != null) presenter.OnReplayFrame(replayResult, ThrowReplay.At(replayResult, ms, match.Model.BoardBeforeLastThrow));
        replayLastMs = ms;
        if (ms > replayResult.DurationMs + 200) { replayResult = null; }
    }

    // ---------------------------------------------------------------- throw input
    private bool ReadPointer(out Vector2 pos, out bool down, out bool up)
    {
        down = up = false;
        if (Input.touchCount > 0)
        {
            var t = Input.GetTouch(0);
            pos = t.position;
            down = t.phase == TouchPhase.Began;
            up = t.phase == TouchPhase.Ended || t.phase == TouchPhase.Canceled;
            return true;
        }
        pos = Input.mousePosition;
        down = Input.GetMouseButtonDown(0);
        up = Input.GetMouseButtonUp(0);
        return Input.GetMouseButton(0) || up;
    }

    private void UpdateThrowInput()
    {
        if (!match.CanThrow || leaveConfirm || reportTarget != null) { pointerDown = false; return; }
        Vector2 pos;
        bool down, up;
        var active = ReadPointer(out pos, out down, out up);
        var t = (double)Time.unscaledTime;
        // touch positions as fractions of the screen height, y up (the throw maths uses these)
        var x = pos.x / Screen.height;
        var y = pos.y / Screen.height;
        var c = match.Throw;

        if (down)
        {
            if (y > 0.86) { pointerDown = false; return; } // the shot picker strip is a UI area
            pointerDown = true;
            pointerPulling = y < 0.35; // the bag is in the bottom third
            lastPointer = pos;
            if (pointerPulling) c.BeginPull(t, x, y);
        }
        else if (pointerDown && active)
        {
            if (pointerPulling)
            {
                c.MovePull(t, x, y);
                if (presenter != null) presenter.OnAimChanged(c.Aim, c.Power, c.Shot, true, c.Shake);
            }
            else
            {
                c.DragAim((pos.x - lastPointer.x) / Screen.height);
                if (presenter != null) presenter.OnAimChanged(c.Aim, c.Power, c.Shot, false, 1);
            }
            lastPointer = pos;
        }
        if (pointerDown && up)
        {
            pointerDown = false;
            if (pointerPulling)
            {
                var cmd = c.Release(t, x, y);
                if (cmd != null) _ = Do(async () => { await match.SendThrowAsync(cmd); if (match != null && match.LastError != null) Say(Friendly(new ApiException(0, match.LastError, match.LastError))); });
                else { c.Reset(); if (presenter != null) presenter.OnAimChanged(c.Aim, c.Power, c.Shot, false, 1); }
            }
        }
    }

    // ---------------------------------------------------------------- drawing
    private void DrawMatch()
    {
        if (match == null) { Go(Page.Menu); return; }
        var m = match.Model;
        switch (m.Phase)
        {
            case "lobby": DrawLobby(); break;
            case "characters": DrawCharacterPick(); break;
            case "colors": DrawColorPick(); break;
            case "toss": DrawToss(); break;
            case "playing": DrawPlaying(); break;
            default: DrawResults(); break;
        }
        if (m.Phase != "lobby" && !m.IsOver) DrawMatchBar();
        if (match.Socket != null && match.Socket.State != SocketState.Live && m.Id != null)
            UiKit.Toast("Reconnecting…");
        if (leaveConfirm) DrawLeaveConfirm();
        if (reportTarget != null) DrawReport();
    }

    private void DrawMatchBar()
    {
        var m = match.Model;
        var you = m.YouTeam ?? "A";
        var mine = you == "A" ? m.ScoreA : m.ScoreB;
        var theirs = you == "A" ? m.ScoreB : m.ScoreA;
        var bar = new Rect(0, 0, UiKit.W, 56f);
        UiKit.Fill(bar, new Rgba(0f, 0f, 0f, 0.55f));
        UiKit.Text(new Rect(16f, 0, 260f, 56f), "YOU  " + (int)mine + "  —  " + (int)theirs, Theme.HeadingSize, TextAnchor.MiddleLeft, Theme.GoldLight);
        UiKit.Text(new Rect(UiKit.W / 2f - 130f, 0, 260f, 56f), (m.IsRanked ? "RANKED  ·  " : "") + "to " + m.PlayTo + "  ·  inning " + Mathf.Max(1, m.Inning), Theme.SmallSize + 2, TextAnchor.MiddleCenter, Theme.TextDim);
        // voice controls
        var vx = UiKit.W - 360f;
        if (voice != null && voice.IsJoined)
        {
            var target = voice.Target;
            if (UiKit.Button(new Rect(vx, 8f, 96f, 40f), target == TalkTarget.Nobody ? "MIC OFF" : "MIC", true, target != TalkTarget.Nobody, Theme.SmallSize)) voice.SetTarget(target == TalkTarget.Nobody ? TalkTarget.Table : TalkTarget.Nobody);
            if (voiceGrant != null && voiceGrant.TeamName != null)
                if (UiKit.Button(new Rect(vx + 104f, 8f, 110f, 40f), "TEAM", true, target == TalkTarget.Team, Theme.SmallSize)) voice.SetTarget(target == TalkTarget.Team ? TalkTarget.Table : TalkTarget.Team);
        }
        if (UiKit.Button(new Rect(UiKit.W - 130f, 8f, 116f, 40f), "MENU", true, false, Theme.SmallSize)) leaveConfirm = true;
    }

    private void DrawLeaveConfirm()
    {
        var m = match.Model;
        var r = UiKit.Center(Mathf.Min(UiKit.W - 40f, 620f), 270f);
        UiKit.Fill(new Rect(0, 0, UiKit.W, UiKit.H), new Rgba(0, 0, 0, 0.6f));
        UiKit.Panel(r, true);
        string text = "Leave this match?";
        if (m.IsRanked && !m.IsOver) text = "Leaving a ranked match counts as a loss, and you can't search again for 10 minutes.";
        else if (!m.IsOver && m.Phase != "lobby") text = "Leave this match? A bot will play your seat.";
        UiKit.Text(new Rect(r.x + 24f, r.y + 20f, r.width - 48f, 130f), text, Theme.BodySize);
        var half = (r.width - 72f) / 2f;
        if (UiKit.Button(new Rect(r.x + 24f, r.y + 176f, half, 62f), "STAY", !busy, true, Theme.BodySize)) leaveConfirm = false;
        if (UiKit.Button(new Rect(r.x + 48f + half, r.y + 176f, half, 62f), "LEAVE", !busy, false, Theme.BodySize))
        {
            leaveConfirm = false;
            var wasOver = m.IsOver;
            _ = Do(async () => { await match.LeaveAsync(); CloseMatch(true); });
            _ = wasOver;
        }
    }

    // ---------------------------------------------------------------- lobby (friendly matches)
    private void DrawLobby()
    {
        var m = match.Model;
        UiKit.Title("WAITING FOR PLAYERS", 30f);
        var w = Mathf.Min(UiKit.W - 60f, 560f);
        var x = (UiKit.W - w) / 2f;
        UiKit.Text(new Rect(x, 100f, w, 30f), "Match code", Theme.SmallSize + 2, TextAnchor.MiddleCenter, Theme.TextDim);
        UiKit.Text(new Rect(x, 128f, w, 90f), m.Id ?? "", 72, TextAnchor.MiddleCenter, Theme.Cyan);
        if (UiKit.Link(new Rect(x, 222f, w, 40f), "Copy invite link")) { GUIUtility.systemCopyBuffer = InviteLink(m.Id); Say("Invite link copied"); }
        var y = 276f;
        foreach (var s in m.Seats)
        {
            var label = s.Kind == "bot" ? "Bot" + (s.BotLevel != null ? " (" + s.BotLevel + ")" : "") : (s.Claimed ? s.Name : "Waiting for a friend…");
            UiKit.Text(new Rect(x, y, w * 0.2f, 40f), s.Id, Theme.SmallSize + 2, TextAnchor.MiddleLeft, Theme.TextDim);
            UiKit.Text(new Rect(x + w * 0.2f, y, w * 0.8f, 40f), label, Theme.BodySize, TextAnchor.MiddleLeft, s.Claimed || s.Kind == "bot" ? Theme.Text : Theme.TextDim);
            y += 44f;
        }
        if (m.YouAreHost)
        {
            var open = m.Seats.FindAll(s => s.Kind == "human" && !s.Claimed).Count;
            if (UiKit.Button(new Rect(x, y + 14f, w, 66f), open == 0 ? "START" : "START WITH BOTS", !busy, true))
                _ = Do(async () => { if (!await match.StartAsync(open > 0)) Say(Friendly(new ApiException(0, match.LastError ?? "error", match.LastError ?? "Couldn't start"))); });
        }
        else UiKit.Text(new Rect(x, y + 14f, w, 50f), "Waiting for the host to start…", Theme.BodySize, TextAnchor.MiddleCenter, Theme.TextDim);
        if (UiKit.Link(new Rect(x, y + 96f, w, 44f), "Leave", Theme.BodySize, Theme.TextDim)) { _ = Do(async () => { await match.LeaveAsync(); CloseMatch(true); }); }
    }

    private string InviteLink(string code) { return server.BaseUrl.TrimEnd('/') + "/join/" + code; }

    // ---------------------------------------------------------------- picks
    private List<object> MetaList(string key) { return J.Arr(account.Meta, key) ?? new List<object>(); }

    private void DrawCharacterPick()
    {
        var m = match.Model;
        UiKit.Title("PICK YOUR PLAYER", 68f);
        UiKit.Text(new Rect(0, 120f, UiKit.W, 30f), Ago(Math.Max(0, (m.DeadlineAt - NowMs) / 1000.0)), Theme.SmallSize + 4, TextAnchor.MiddleCenter, Theme.TextDim);
        var list = MetaList("characters");
        var cols = UiKit.Portrait ? 2 : 4;
        var cw = Mathf.Min(220f, (UiKit.W - 60f) / cols - 12f);
        var ch = 76f;
        var x0 = (UiKit.W - cols * (cw + 12f) + 12f) / 2f;
        for (var i = 0; i < list.Count; i++)
        {
            var id = J.Str(list[i], "id");
            var name = J.Str(list[i], "name", id);
            var taken = m.Seats.Exists(s => s.CharacterId == id);
            var mine = m.Seat(m.YouSeat) != null && m.Seat(m.YouSeat).CharacterId == id;
            var r = new Rect(x0 + (i % cols) * (cw + 12f), 170f + (i / cols) * (ch + 12f), cw, ch);
            if (UiKit.Button(r, name, !busy && (!taken || mine), mine, Theme.BodySize)) _ = Do(async () => { if (!await match.PickCharacterAsync(id)) Say(Friendly(new ApiException(0, match.LastError ?? "error", "Couldn't pick"))); });
        }
    }

    private void DrawColorPick()
    {
        var m = match.Model;
        UiKit.Title("PICK YOUR BAG COLOR", 68f);
        UiKit.Text(new Rect(0, 120f, UiKit.W, 30f), Ago(Math.Max(0, (m.DeadlineAt - NowMs) / 1000.0)), Theme.SmallSize + 4, TextAnchor.MiddleCenter, Theme.TextDim);
        var list = MetaList("colors");
        var cols = UiKit.Portrait ? 3 : 6;
        var size = Mathf.Min(150f, (UiKit.W - 60f) / cols - 12f);
        var x0 = (UiKit.W - cols * (size + 12f) + 12f) / 2f;
        var myTeam = m.YouTeam;
        var teamHasColor = myTeam != null && m.Colors.ContainsKey(myTeam);
        for (var i = 0; i < list.Count; i++)
        {
            var id = J.Str(list[i], "id");
            var hex = J.Str(list[i], "hex", "#FFFFFF");
            var taken = m.Colors.ContainsValue(id);
            var mine = teamHasColor && m.Colors[myTeam] == id;
            var r = new Rect(x0 + (i % cols) * (size + 12f), 170f + (i / cols) * (size + 12f), size, size);
            UiKit.Fill(r, new Rgba(0f, 0f, 0f));
            UiKit.Fill(new Rect(r.x + 6f, r.y + 6f, r.width - 12f, r.height - 12f), Rgba.Hex(hex).WithAlpha(taken && !mine ? 0.25f : 1f));
            UiKit.Edge(r, mine ? Theme.Cyan : Theme.PanelEdge, mine ? 4f : 2f);
            UiKit.Text(new Rect(r.x, r.yMax - 30f, r.width, 28f), J.Str(list[i], "name", id), Theme.SmallSize, TextAnchor.MiddleCenter, Theme.Text);
            if (!busy && !teamHasColor && !taken && GUI.Button(r, GUIContent.none, GUIStyle.none))
                _ = Do(async () => { if (!await match.PickColorAsync(id)) Say(Friendly(new ApiException(0, match.LastError ?? "error", "Couldn't pick"))); });
        }
        if (teamHasColor) UiKit.Text(new Rect(0, UiKit.H - 110f, UiKit.W, 40f), "Your team has its color. Waiting for the others…", Theme.BodySize, TextAnchor.MiddleCenter, Theme.TextDim);
    }

    private void DrawToss()
    {
        var m = match.Model;
        UiKit.Title("COIN TOSS", 200f);
        var first = m.FirstTeam;
        UiKit.Text(new Rect(0, 290f, UiKit.W, 60f), first == null ? "…" : (first == m.YouTeam ? "You throw first" : "They throw first"), 40, TextAnchor.MiddleCenter, Theme.Cyan);
    }

    // ---------------------------------------------------------------- playing
    private void DrawPlaying()
    {
        var m = match.Model;
        var turn = m.Turn;
        var c = match.Throw;

        // shot picker (a strip at the top, below the bar)
        if (turn != null && m.IsMyTurn)
        {
            var n = Guide.Shots.Count;
            var w = Mathf.Min(UiKit.W - 40f, 560f);
            var bw = (w - (n - 1) * 10f) / n;
            for (var i = 0; i < n; i++)
            {
                var shot = Guide.Shots[i];
                if (UiKit.Button(new Rect((UiKit.W - w) / 2f + i * (bw + 10f), 64f, bw, 46f), shot.Name.ToUpperInvariant(), !match.ThrowInFlight, c.Shot == shot.Id, Theme.SmallSize + 2))
                {
                    c.SelectShot(shot.Id);
                    settings.LastShot = shot.Id;
                    if (presenter != null) presenter.OnAimChanged(c.Aim, c.Power, c.Shot, false, 1);
                }
            }
        }

        DrawBoardMap(new Rect(UiKit.W - 190f, UiKit.H * 0.24f, 170f, 340f));
        DrawWind(turn != null ? turn.Wind : m.Wind, new Vector2(78f, UiKit.H * 0.30f));

        // whose turn
        string who = "";
        if (turn != null)
        {
            if (m.IsMyTurn) who = match.ThrowInFlight ? "…" : "YOUR THROW";
            else { var s = m.Seat(turn.Seat); who = (s != null && s.Name != null ? s.Name : "Opponent") + " is throwing"; }
        }
        UiKit.Text(new Rect(0, UiKit.H * 0.58f, UiKit.W, 44f), who, 34, TextAnchor.MiddleCenter, m.IsMyTurn ? Theme.Cyan : Theme.TextDim);
        if (m.IsMyTurn)
        {
            var left = match.ThrowSecondsLeft(NowMs);
            if (turn.DeadlineAt > 0) UiKit.Text(new Rect(0, UiKit.H * 0.58f + 40f, UiKit.W, 36f), Mathf.CeilToInt((float)left) + "s", Theme.BodySize, TextAnchor.MiddleCenter, left < 5 ? Theme.Hot : Theme.TextDim);
        }

        // power bar while pulling
        if (pointerDown && pointerPulling)
        {
            var bar = new Rect(30f, UiKit.H * 0.55f, 22f, 200f);
            UiKit.Edge(bar, Theme.PanelEdge, 2f);
            UiKit.Fill(new Rect(bar.x + 3f, bar.yMax - 3f - (bar.height - 6f) * (float)c.Power, bar.width - 6f, (bar.height - 6f) * (float)c.Power), Theme.Cyan);
            if (c.Shake > 1.05) UiKit.Text(new Rect(60f, bar.y, 200f, 40f), "STEADY…", Theme.BodySize, TextAnchor.MiddleLeft, Theme.Gold);
        }

        // helper text and result banner
        if (settings.Tutorial && m.IsMyTurn && !pointerDown)
            UiKit.Text(new Rect(20f, UiKit.H - 120f, UiKit.W - 40f, 60f), "Drag sideways to aim  ·  pull the bag down for distance  ·  flick up to throw", Theme.SmallSize + 4, TextAnchor.MiddleCenter, Theme.TextDim);
        if (settings.AimAssist && !m.IsRanked && m.IsMyTurn && turn != null) DrawAimHint(turn.Wind);
        if (banner != null && Time.unscaledTime < bannerUntil)
        {
            var r = new Rect(20f, UiKit.H * 0.33f, UiKit.W - 220f, 120f);
            UiKit.Text(r, banner, 34, TextAnchor.MiddleCenter, banner.StartsWith("CORNHOLE") ? Theme.GoldLight : Theme.Text);
        }
    }

    /// <summary>The wind as the thrower feels it: an arrow that points where it blows, and the speed.</summary>
    private void DrawWind(WindInfo w, Vector2 center)
    {
        if (w == null) return;
        var r = new Rect(center.x - 62f, center.y - 62f, 124f, 150f);
        UiKit.Fill(r, new Rgba(0, 0, 0, 0.35f));
        UiKit.Edge(r, Theme.PanelEdge, 1f);
        if (w.IsCalm) { UiKit.Text(new Rect(r.x, r.y + 40f, r.width, 40f), "CALM", Theme.BodySize, TextAnchor.MiddleCenter, Theme.Good); return; }
        UiKit.Arrow(new Vector2(center.x, center.y - 6f), (float)w.TowardDeg, 56f, Theme.SoftCyan);
        UiKit.Text(new Rect(r.x, r.yMax - 46f, r.width, 40f), w.Mph.ToString("0") + " mph", Theme.BodySize, TextAnchor.MiddleCenter, Theme.Text);
    }

    /// <summary>Casual play only: how many hole-widths to aim off for the wind, like Golf Clash's rings.</summary>
    private void DrawAimHint(WindInfo wind)
    {
        if (wind == null || wind.IsCalm) return;
        var marks = Guide.WindInHoleMarks(match.Throw.Arc, wind.Cross, wind.Along);
        var sideways = Math.Abs(marks.X) < 0.15 ? "" : "aim " + Math.Abs(marks.X).ToString("0.0") + " hole " + (marks.X > 0 ? "left" : "right");
        var depth = Math.Abs(marks.Y) < 0.15 ? "" : (marks.Y > 0 ? "  ·  wind will carry it long" : "  ·  wind will hold it short");
        if (sideways.Length + depth.Length > 0)
            UiKit.Text(new Rect(20f, UiKit.H - 170f, UiKit.W - 40f, 44f), sideways + depth, Theme.BodySize, TextAnchor.MiddleCenter, Theme.SoftCyan);
    }

    /// <summary>A plain top-down view of the far board: the hole, the bags, and (casual play) where the bag will land.</summary>
    private void DrawBoardMap(Rect r)
    {
        var m = match.Model;
        var widthIn = 24f;
        var lengthIn = 48f;
        UiKit.Fill(r, new Rgba(0.05f, 0.05f, 0.05f, 0.7f));
        UiKit.Edge(r, Theme.PanelEdge, 2f);
        Func<double, double, Vector2> map = (bx, by) => new Vector2(r.x + r.width / 2f + (float)bx / widthIn * r.width, r.yMax - (float)by / lengthIn * r.height);
        var hole = map(0, 39);
        UiKit.Fill(new Rect(hole.x - 9f, hole.y - 9f, 18f, 18f), Theme.Backdrop);
        UiKit.Edge(new Rect(hole.x - 9f, hole.y - 9f, 18f, 18f), Theme.Cyan, 1f);

        var frame = replayResult != null ? ThrowReplay.At(replayResult, (Time.unscaledTime - replayStart) * 1000.0, m.BoardBeforeLastThrow) : null;
        var bags = new Dictionary<string, Point2>();
        var teams = new Dictionary<string, string>();
        foreach (var kv in m.Board) { teams[kv.Key] = kv.Value.Team; if (kv.Value.HasPosition && kv.Value.Status == "board") bags[kv.Key] = new Point2(kv.Value.X, kv.Value.Y); }
        if (frame != null)
        {
            bags.Clear();
            foreach (var kv in frame.Board) bags[kv.Key] = kv.Value;
            if (replayResult != null && frame.Phase == "flight" && frame.Height > 0) bags[replayResult.BagId] = new Point2(replayResult.Landing.X, Math.Max(0, frame.Bag.Y));
        }
        foreach (var kv in bags)
        {
            var p = map(kv.Value.X, kv.Value.Y);
            string team;
            if (!teams.TryGetValue(kv.Key, out team)) team = replayResult != null && kv.Key == replayResult.BagId ? replayResult.Team : "A";
            string colorId;
            m.Colors.TryGetValue(team, out colorId);
            var hex = "#FFFFFF";
            foreach (var o in MetaList("colors")) if (J.Str(o, "id") == colorId) hex = J.Str(o, "hex", hex);
            UiKit.Fill(new Rect(p.x - 7f, p.y - 7f, 14f, 14f), Rgba.Hex(hex));
            UiKit.Edge(new Rect(p.x - 7f, p.y - 7f, 14f, 14f), Theme.Backdrop, 1f);
        }
        // the landing ring you are aiming (casual only): calm-day landing, with the wind's push if the helper is on
        if (m.IsMyTurn && (pointerDown || match.Throw.Phase != ThrowPhase.Idle) && !m.IsRanked && settings.AimAssist)
        {
            var calm = Guide.CalmLanding(match.Throw.Aim, match.Throw.Power);
            var wind = m.Turn != null ? m.Turn.Wind : null;
            var drift = wind != null ? Guide.WindDrift(match.Throw.Arc, wind.Cross, wind.Along) : new Point2(0, 0);
            var ring = map(calm.X + drift.X, calm.Y + drift.Y + 0);
            UiKit.Edge(new Rect(ring.x - 12f, ring.y - 12f, 24f, 24f), Theme.Cyan, 2f);
        }
    }

    // ---------------------------------------------------------------- results
    private void DrawResults()
    {
        var m = match.Model;
        var w = Mathf.Min(UiKit.W - 40f, 640f);
        var x = (UiKit.W - w) / 2f;
        var abandoned = m.Phase == "abandoned" || m.WinReason == "abandoned";
        var won = !abandoned && m.Winner != null && m.Winner == m.YouTeam;
        UiKit.Text(new Rect(0, 50f, UiKit.W, 80f), abandoned ? "MATCH CANCELLED" : (won ? "YOU WON" : "YOU LOST"), 60, TextAnchor.MiddleCenter, abandoned ? Theme.TextDim : (won ? Theme.GoldLight : Theme.Text));
        if (!abandoned)
        {
            var you = m.YouTeam ?? "A";
            UiKit.Text(new Rect(0, 130f, UiKit.W, 50f), (int)(you == "A" ? m.ScoreA : m.ScoreB) + "  —  " + (int)(you == "A" ? m.ScoreB : m.ScoreA), 44, TextAnchor.MiddleCenter, Theme.Text);
            if (m.WinReason == "forfeit") UiKit.Text(new Rect(0, 178f, UiKit.W, 34f), won ? "Your opponent left the match" : "You left the match", Theme.BodySize, TextAnchor.MiddleCenter, Theme.TextDim);
        }
        var y = 230f;
        if (m.IsRanked)
        {
            var mine = m.MyRating;
            if (mine != null)
            {
                var up = mine.Change >= 0;
                UiKit.Text(new Rect(0, y, UiKit.W, 44f), mine.Before + "  >  " + mine.After, 40, TextAnchor.MiddleCenter, Theme.GoldLight);
                UiKit.Text(new Rect(0, y + 44f, UiKit.W, 40f), (up ? "+" : "") + mine.Change + (mine.FarmingLimited ? "  (fewer points: you've played these players a lot today)" : "") + (mine.Games <= 10 ? "  ·  placement game " + mine.Games + "/10" : ""), Theme.BodySize, TextAnchor.MiddleCenter, up ? Theme.Good : Theme.Hot);
            }
            else if (m.RatingsReady && m.RatingsVoided) UiKit.Text(new Rect(0, y, UiKit.W, 44f), "This match doesn't count. Nobody's rating changed.", Theme.BodySize, TextAnchor.MiddleCenter, Theme.TextDim);
            else if (!abandoned) UiKit.Text(new Rect(0, y, UiKit.W, 44f), "Updating your rating…", Theme.BodySize, TextAnchor.MiddleCenter, Theme.TextDim);
            y += 96f;
        }

        // people I can report or block
        var others = match.OtherHumans();
        foreach (var s in others)
        {
            UiKit.Text(new Rect(x, y, w * 0.5f, 44f), s.Name, Theme.BodySize, TextAnchor.MiddleLeft);
            var blocked = voiceGrant != null && voiceGrant.ShouldMute(s.AccountId);
            var target = s;
            if (UiKit.Link(new Rect(x + w * 0.5f, y, w * 0.25f, 44f), "Report", Theme.SmallSize + 2, Theme.TextDim)) reportTarget = target;
            if (UiKit.Link(new Rect(x + w * 0.75f, y, w * 0.25f, 44f), blocked ? "Unblock" : "Block", Theme.SmallSize + 2, Theme.TextDim))
            {
                var id = target.AccountId;
                _ = Do(async () =>
                {
                    if (blocked) { await api.Unblock(id); if (voice != null) voice.UnmutePlayer(id); else if (voiceGrant != null) voiceGrant.Mute.Remove(id); }
                    else { await api.Block(id); if (voice != null) voice.MutePlayer(id); else if (voiceGrant != null) voiceGrant.Mute.Add(id); }
                    Say(blocked ? "Unblocked" : "Blocked. You won't hear or match with them.");
                });
            }
            y += 48f;
        }

        y = Mathf.Max(y + 20f, UiKit.H - 220f);
        var rematchOpen = !m.IsRanked && !abandoned && m.Rematch != null && !J.Bool(m.Rematch, "cancelled");
        if (rematchOpen)
        {
            var votes = J.Obj(m.Rematch, "votes");
            var voted = votes != null && votes.ContainsKey(m.YouId);
            if (UiKit.Button(new Rect(x, y, w, 66f), voted ? "WAITING FOR THE OTHERS…" : "PLAY AGAIN", !busy && !voted, true)) _ = Do(async () => { await match.RematchAsync(true); });
        }
        else if (m.IsRanked)
        {
            if (UiKit.Button(new Rect(x, y, w, 66f), "SEARCH AGAIN", !busy, true))
                _ = Do(async () => { CloseMatch(false); await ranked.JoinAsync(m.Ranked); Go(Page.Searching); nextPoll = 0; });
        }
        if (UiKit.Button(new Rect(x, y + 78f, w, 60f), "MENU", !busy, false, Theme.BodySize)) { var wasRematch = rematchOpen; if (wasRematch) _ = match.RematchAsync(false); CloseMatch(true); }
    }

    private static readonly string[] ReportReasons = { "harassment", "cheating", "inappropriate_name", "underage", "other" };
    private static readonly string[] ReportLabels = { "Harassing me", "Cheating", "Inappropriate name", "Seems under 18", "Something else" };

    private void DrawReport()
    {
        var r = UiKit.Center(Mathf.Min(UiKit.W - 40f, 560f), 460f);
        UiKit.Fill(new Rect(0, 0, UiKit.W, UiKit.H), new Rgba(0, 0, 0, 0.7f));
        UiKit.Panel(r, true);
        UiKit.Text(new Rect(r.x, r.y + 14f, r.width, 50f), "Report " + reportTarget.Name, Theme.HeadingSize, TextAnchor.MiddleCenter, Theme.GoldLight);
        for (var i = 0; i < ReportReasons.Length; i++)
        {
            var reason = ReportReasons[i];
            if (UiKit.Button(new Rect(r.x + 30f, r.y + 76f + i * 62f, r.width - 60f, 54f), ReportLabels[i], !busy, false, Theme.BodySize))
            {
                var target = reportTarget;
                var matchId = match != null ? match.Id : null;
                _ = Do(async () => { await api.Report(target.AccountId, reason, matchId); Say("Thanks. We'll take a look."); reportTarget = null; });
            }
        }
        if (UiKit.Link(new Rect(r.x, r.yMax - 52f, r.width, 44f), "Cancel", Theme.BodySize, Theme.TextDim)) reportTarget = null;
    }
}
