// Ads through AppLovin MAX (the account shared by all iPlay games).
//
// This file only compiles once the AppLovin MAX package is installed and APPLOVIN_MAX is added to
//   Project Settings > Player > Scripting Define Symbols
// (see docs/unity-client.md). Until then the game runs with no ads. It has NOT been compiled against a real MAX
// install: AppLovin changes its API between versions, so check the calls below against the version you install.
#if APPLOVIN_MAX
using System;
using UnityEngine;
using IPlay.Cornhole;

/// <summary>
/// Shows ads only when <see cref="AdPacer"/> allows it: never in a match, only after enough matches and time, only
/// after MAX's consent flow (which also asks Apple's tracking question), and only if the server has ads on.
/// Nothing in the game is for sale: ads are the only income.
/// </summary>
public sealed class AppLovinAds
{
    private readonly AdPacer pacer;
    private string interstitialId = "", bannerId = "";
    private bool ready, bannerCreated, bannerShown;

    public AppLovinAds(AdPacer pacer) { this.pacer = pacer; }

    /// <summary>Call at start-up (after the server's settings are loaded).</summary>
    public void Initialize()
    {
        if (!pacer.Enabled) return;
        var asset = Resources.Load<TextAsset>("iplay-ads");
        if (asset == null) return;
        var json = MiniJson.ParseObject(asset.text);
        var sdkKey = J.Str(json, "sdkKey", "");
        interstitialId = J.Str(json, "interstitialUnitId", "");
        bannerId = J.Str(json, "bannerUnitId", "");
        if (sdkKey.Length == 0) return;

        MaxSdkCallbacks.OnSdkInitializedEvent += config =>
        {
            // MAX has run its consent flow (Terms & Privacy, GDPR/UMP and Apple's tracking prompt) by now.
            pacer.ConsentGiven = true;
            ready = true;
            if (interstitialId.Length > 0)
            {
                MaxSdkCallbacks.Interstitial.OnAdHiddenEvent += (id, info) => MaxSdk.LoadInterstitial(interstitialId);
                MaxSdkCallbacks.Interstitial.OnAdLoadFailedEvent += (id, error) => { };
                MaxSdk.LoadInterstitial(interstitialId);
            }
        };
        MaxSdk.SetSdkKey(sdkKey);
        MaxSdk.InitializeSdk();
    }

    /// <summary>Call on menu screens. Shows or hides the banner (never during a match).</summary>
    public void UpdateBanner()
    {
        if (!ready || bannerId.Length == 0) return;
        if (!bannerCreated)
        {
            MaxSdk.CreateBanner(bannerId, MaxSdkBase.BannerPosition.BottomCenter);
            bannerCreated = true;
        }
        var want = pacer.ShouldShowMenuBanner;
        if (want == bannerShown) return;
        if (want) MaxSdk.ShowBanner(bannerId); else MaxSdk.HideBanner(bannerId);
        bannerShown = want;
    }

    /// <summary>Call when a match has finished and the player is back on a menu. Returns true if an ad was shown.</summary>
    public bool TryShowInterstitial(double nowSeconds)
    {
        if (!ready || interstitialId.Length == 0) return false;
        if (!pacer.ShouldShowInterstitial(nowSeconds)) return false;
        if (!MaxSdk.IsInterstitialReady(interstitialId)) return false;
        MaxSdk.ShowInterstitial(interstitialId);
        pacer.InterstitialShown(nowSeconds);
        return true;
    }
}
#endif
