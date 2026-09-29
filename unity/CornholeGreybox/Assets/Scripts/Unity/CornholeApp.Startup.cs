using System;
using System.Threading.Tasks;
using UnityEngine;
using IPlay.Cornhole;

// Launch: logo, the 18+ screen, sign-in, the checks that can stop the game (update, maintenance, ban, offline),
// new terms, and "you were in a match".
public sealed partial class CornholeApp
{
    private async Task BeginStartup()
    {
        try
        {
            var outcome = await account.StartAsync();
            if (account.Meta != null) { ads.Configure(account.Meta); StartAds(); }
            Route(outcome);
        }
        catch (ApiException e)
        {
            Debug.LogWarning("Start-up failed: " + e.Code);
            outage = StartupOutcome.Offline;
            Go(Page.Outage);
        }
        finally { busy = false; }
    }

    private void Route(StartupOutcome outcome)
    {
        outage = outcome;
        switch (outcome)
        {
            case StartupOutcome.NeedAdultGate: Go(Page.AdultGate); break;
            case StartupOutcome.AdultDenied: Go(Page.AdultDenied); break;
            case StartupOutcome.Ready: Go(Page.Menu); break;
            case StartupOutcome.NeedTerms: Go(Page.Terms); break;
            case StartupOutcome.RejoinMatch: Go(Page.Rejoin); break;
            default: Go(Page.Outage); break;
        }
    }

    private void DrawIntro()
    {
        var elapsed = Time.unscaledTime - introStarted;
        var a = Mathf.Clamp01(elapsed / 0.5f) * (1f - Mathf.Clamp01((elapsed - (IntroSeconds - 0.4f)) / 0.4f));
        var size = Mathf.Min(UiKit.H * 0.5f, UiKit.W * 0.5f);
        var r = new Rect((UiKit.W - size) / 2f, (UiKit.H - size) / 2f - 20f, size, size);
        var old = GUI.color;
        GUI.color = new Color(1, 1, 1, a);
        if (logo != null) GUI.DrawTexture(r, logo, ScaleMode.ScaleToFit, true);
        GUI.color = old;
        UiKit.Text(new Rect(0, r.yMax, UiKit.W, 60f), "CORNHOLE", Theme.TitleSize, TextAnchor.MiddleCenter, Theme.Cyan.WithAlpha(a));
    }

    // ---------------------------------------------------------------- 18+
    private void DrawAdultGate()
    {
        var panel = UiKit.Center(Mathf.Min(UiKit.W - 40f, 760f), 320f);
        UiKit.Panel(panel);
        UiKit.Text(new Rect(panel.x, panel.y + 20f, panel.width, 64f), "18+", 52, TextAnchor.MiddleCenter, Theme.GoldLight);
        UiKit.Text(new Rect(panel.x + 30f, panel.y + 90f, panel.width - 60f, 100f), "iPlay Cornhole is for adults. It has live voice chat with other players, and it is not filtered.", Theme.BodySize);
        var half = (panel.width - 90f) / 2f;
        if (UiKit.Button(new Rect(panel.x + 30f, panel.y + 220f, half, 64f), "I'm 18 or older", !busy))
        {
            account.AnswerAdultGate(true);
            introStarted = Time.unscaledTime - IntroSeconds;
            screen = Page.Intro; // runs start-up again, now allowed to talk to the server
        }
        if (UiKit.Button(new Rect(panel.x + 60f + half, panel.y + 220f, half, 64f), "Under 18"))
        {
            account.AnswerAdultGate(false);
            Go(Page.AdultDenied);
        }
    }

    private void DrawAdultDenied()
    {
        var panel = UiKit.Center(Mathf.Min(UiKit.W - 40f, 720f), 240f);
        UiKit.Panel(panel);
        UiKit.Text(new Rect(panel.x + 20f, panel.y + 30f, panel.width - 40f, 90f), "This game is for adults.", 34);
        UiKit.Text(new Rect(panel.x + 20f, panel.y + 120f, panel.width - 40f, 90f), "Come back when you're 18.", Theme.BodySize, TextAnchor.MiddleCenter, Theme.TextDim);
    }

    // ---------------------------------------------------------------- things that stop the game
    private void DrawOutage()
    {
        var panel = UiKit.Center(Mathf.Min(UiKit.W - 40f, 760f), 340f);
        UiKit.Panel(panel);
        string title, body, action = null;
        switch (outage)
        {
            case StartupOutcome.UpdateRequired:
                title = "Update needed"; body = "There's a new version of iPlay Cornhole. Update to keep playing."; action = "Update";
                break;
            case StartupOutcome.Maintenance:
                title = "Back soon"; body = "iPlay Cornhole is being updated."; action = "Try again";
                break;
            case StartupOutcome.Banned:
                var reason = account.LastError != null ? J.Str(account.LastError.Details, "reason", "") : "";
                var until = account.LastError != null ? J.Str(account.LastError.Details, "bannedUntil", "") : "";
                title = "Account banned";
                body = (reason.Length > 0 ? reason + "\n" : "") + (until.Length > 0 ? "Until " + until : "This ban has no end date.");
                break;
            default:
                title = "No connection"; body = "Can't reach the iPlay server. Check your connection."; action = "Try again";
                break;
        }
        UiKit.Text(new Rect(panel.x, panel.y + 20f, panel.width, 60f), title, Theme.TitleSize, TextAnchor.MiddleCenter, Theme.GoldLight);
        UiKit.Text(new Rect(panel.x + 30f, panel.y + 95f, panel.width - 60f, 130f), body, Theme.BodySize);
        if (action != null && UiKit.Button(new Rect(panel.x + (panel.width - 300f) / 2f, panel.y + 250f, 300f, 64f), action, !busy))
        {
            if (outage == StartupOutcome.UpdateRequired)
            {
                if (!string.IsNullOrEmpty(server.StoreUrl)) Application.OpenURL(server.StoreUrl);
                else if (account.LastError != null) OpenStoreFromError();
            }
            else { introStarted = Time.unscaledTime - IntroSeconds; screen = Page.Intro; }
        }
    }

    private void OpenStoreFromError()
    {
        var urls = J.Obj(account.LastError.Details, "storeUrls");
        var url = J.Str(urls, Application.platform == RuntimePlatform.IPhonePlayer ? "ios" : "android", "");
        if (url.Length > 0) Application.OpenURL(url);
    }

    // ---------------------------------------------------------------- terms
    private void DrawTerms()
    {
        var panel = UiKit.Center(Mathf.Min(UiKit.W - 40f, 800f), 380f);
        UiKit.Panel(panel);
        UiKit.Text(new Rect(panel.x, panel.y + 16f, panel.width, 56f), "Updated terms", Theme.TitleSize, TextAnchor.MiddleCenter, Theme.GoldLight);
        UiKit.Text(new Rect(panel.x + 30f, panel.y + 80f, panel.width - 60f, 90f), "We've updated our terms and privacy policy. Please read and accept them to play ranked and use voice chat.", Theme.BodySize);
        if (UiKit.Link(new Rect(panel.x + 30f, panel.y + 175f, panel.width / 2f - 40f, 44f), "Read the terms")) OpenUrl(server.TermsUrl);
        if (UiKit.Link(new Rect(panel.x + panel.width / 2f + 10f, panel.y + 175f, panel.width / 2f - 40f, 44f), "Privacy policy")) OpenUrl(server.PrivacyUrl);
        if (UiKit.Button(new Rect(panel.x + 30f, panel.y + 260f, panel.width - 60f, 70f), "I accept", !busy))
            _ = Do(async () => { await account.AcceptTermsAsync(); Go(account.Account.ActiveMatchId != null ? Page.Rejoin : Page.Menu); });
    }

    private void OpenUrl(string url)
    {
        if (string.IsNullOrEmpty(url)) Say("This link isn't set up yet.");
        else Application.OpenURL(url);
    }

    // ---------------------------------------------------------------- rejoin
    private void DrawRejoin()
    {
        var panel = UiKit.Center(Mathf.Min(UiKit.W - 40f, 720f), 300f);
        UiKit.Panel(panel, true);
        UiKit.Text(new Rect(panel.x, panel.y + 20f, panel.width, 60f), "You're in a match", Theme.TitleSize, TextAnchor.MiddleCenter, Theme.GoldLight);
        UiKit.Text(new Rect(panel.x + 30f, panel.y + 90f, panel.width - 60f, 60f), "You left in the middle of a game. Jump back in?", Theme.BodySize);
        var half = (panel.width - 90f) / 2f;
        if (UiKit.Button(new Rect(panel.x + 30f, panel.y + 190f, half, 66f), "Rejoin", !busy, true))
            OpenMatch(account.Account.ActiveMatchId);
        if (UiKit.Button(new Rect(panel.x + 60f + half, panel.y + 190f, half, 66f), "Leave it", !busy))
            _ = Do(async () =>
            {
                await api.LeaveMatch(account.Account.ActiveMatchId);
                await account.RefreshAsync();
                Go(Page.Menu);
            });
    }
}
