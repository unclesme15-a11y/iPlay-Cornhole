using UnityEngine;
using IPlay.Cornhole;

// Ads: the phone shows them, the server (through AdPacer) decides when. Everything here is a no-op until the
// AppLovin MAX package is installed and APPLOVIN_MAX is defined (see AppLovinAds.cs and docs/unity-client.md).
public sealed partial class CornholeApp
{
#if APPLOVIN_MAX
    private AppLovinAds appLovin;
#endif

    private void InitializeAds()
    {
#if APPLOVIN_MAX
        appLovin = new AppLovinAds(ads);
#endif
    }

    /// <summary>Called once the server's settings are known.</summary>
    private void StartAds()
    {
#if APPLOVIN_MAX
        if (appLovin != null) appLovin.Initialize();
#endif
    }

    private void UpdateAds()
    {
#if APPLOVIN_MAX
        if (appLovin == null) return;
        ads.InMatch = screen == Page.Match && match != null && !match.Model.IsOver;
        appLovin.UpdateBanner();
#else
        ads.InMatch = screen == Page.Match && match != null && !match.Model.IsOver;
#endif
    }

    /// <summary>Called when the player is back on a menu after a match. Shows an interstitial if the pacing rules allow.</summary>
    private void MaybeShowInterstitial()
    {
#if APPLOVIN_MAX
        if (appLovin != null) appLovin.TryShowInterstitial(Time.realtimeSinceStartupAsDouble);
#endif
    }
}
