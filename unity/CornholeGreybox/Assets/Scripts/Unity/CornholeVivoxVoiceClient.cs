using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;
using Unity.Services.Authentication;
using Unity.Services.Core;
using Unity.Services.Vivox;
using UnityEngine;
#if UNITY_ANDROID
using UnityEngine.Android;
#endif
using IPlay.Cornhole;

/// <summary>Who the player is talking to.</summary>
public enum TalkTarget { Table, Team, Nobody }

/// <summary>
/// Voice chat for a match (Unity Vivox), adapted from Street Dice's voice client. Everyone hears the table
/// channel; in 2v2 partners also share a private team channel. The server signs the tokens (for whichever
/// Vivox identity the SDK picks) and says which players this player blocked: those are muted on this phone.
/// Voice is not filtered, which is why the whole game is 18+, so the match screen always offers Report.
/// </summary>
public sealed class CornholeVivoxVoiceClient : MonoBehaviour
{
    private ApiClient api;
    private string matchId;
    private VoiceGrant grant;
    private bool initialized, signedIn, joined;
    private TalkTarget target = TalkTarget.Table;
    private BackendTokens tokenProvider;
    private readonly Dictionary<VivoxParticipant, Action> speechHandlers = new Dictionary<VivoxParticipant, Action>();
    private readonly Dictionary<string, VivoxParticipant> byDisplayName = new Dictionary<string, VivoxParticipant>();

    public string Status { get; private set; } = "Voice idle";
    public bool IsJoined { get { return joined; } }
    public TalkTarget Target { get { return target; } }
    /// <summary>Fires with the account id of whoever is speaking (light up their marker).</summary>
    public event Action<string> SpeechActivity;

    public void Join(ApiClient apiClient, string match, VoiceGrant channels, TalkTarget startTarget)
    {
        api = apiClient;
        matchId = match;
        grant = channels;
        target = startTarget;
        StartCoroutine(JoinWhenPermitted());
    }

    private IEnumerator JoinWhenPermitted()
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        if (!Permission.HasUserAuthorizedPermission(Permission.Microphone))
        {
            Permission.RequestUserPermission(Permission.Microphone);
            float deadline = Time.realtimeSinceStartup + 15f;
            while (!Permission.HasUserAuthorizedPermission(Permission.Microphone) && Time.realtimeSinceStartup < deadline)
                yield return null;
            if (!Permission.HasUserAuthorizedPermission(Permission.Microphone))
            {
                Status = "Microphone permission is needed for table voice";
                yield break;
            }
        }
#endif
        var _ = JoinAsync();
        yield break;
    }

    private async Task JoinAsync()
    {
        try
        {
            Status = "Connecting voice";
            if (UnityServices.State != ServicesInitializationState.Initialized)
                await UnityServices.InitializeAsync();
            if (!AuthenticationService.Instance.IsSignedIn)
                await AuthenticationService.Instance.SignInAnonymouslyAsync();
            if (tokenProvider == null) tokenProvider = new BackendTokens(this);
            VivoxService.Instance.SetTokenProvider(tokenProvider);
            if (!initialized)
            {
                await VivoxService.Instance.InitializeAsync();
                initialized = true;
                VivoxService.Instance.ParticipantAddedToChannel += OnParticipantAdded;
            }
            if (!signedIn)
            {
                // The display name is the account id: other phones use it to know who is speaking and who to mute.
                await VivoxService.Instance.LoginAsync(new LoginOptions { DisplayName = grant.DisplayName });
                signedIn = true;
            }
            await VivoxService.Instance.JoinGroupChannelAsync(grant.TableName, ChatCapability.AudioOnly);
            if (grant.TeamName != null) await VivoxService.Instance.JoinGroupChannelAsync(grant.TeamName, ChatCapability.AudioOnly);
            joined = true;
            await ApplyTargetAsync();
            Status = "Voice connected";
        }
        catch (Exception e)
        {
            joined = false;
            Status = "Voice unavailable. Check your connection.";
            Debug.LogWarning("Voice join failed: " + e.Message);
        }
    }

    /// <summary>Choose where the microphone goes: everyone, just the partner, or nobody. You always hear both.</summary>
    public void SetTarget(TalkTarget value)
    {
        if (value == TalkTarget.Team && grant != null && grant.TeamName == null) value = TalkTarget.Table; // no team channel in 1v1
        target = value;
        if (joined) { var _ = ApplyTargetAsync(); }
    }

    private async Task ApplyTargetAsync()
    {
        try
        {
            if (target == TalkTarget.Nobody)
                await VivoxService.Instance.SetChannelTransmissionModeAsync(TransmissionMode.None, grant.TableName);
            else
                await VivoxService.Instance.SetChannelTransmissionModeAsync(TransmissionMode.Single, target == TalkTarget.Team ? grant.TeamName : grant.TableName);
        }
        catch (Exception) { Status = "Voice control unavailable."; }
    }

    /// <summary>Mute one player on this phone (they were just blocked). Their account id is their voice display name.</summary>
    public void MutePlayer(string accountId)
    {
        VivoxParticipant p;
        if (byDisplayName.TryGetValue(accountId, out p)) p.MutePlayerLocally();
        if (grant != null && !grant.Mute.Contains(accountId)) grant.Mute.Add(accountId);
    }

    public void UnmutePlayer(string accountId)
    {
        VivoxParticipant p;
        if (byDisplayName.TryGetValue(accountId, out p)) p.UnmutePlayerLocally();
        if (grant != null) grant.Mute.Remove(accountId);
    }

    public async void Leave()
    {
        if (!joined) return;
        joined = false;
        try
        {
            await VivoxService.Instance.LeaveChannelAsync(grant.TableName);
            if (grant.TeamName != null) await VivoxService.Instance.LeaveChannelAsync(grant.TeamName);
        }
        catch (Exception) { Status = "Voice disconnect failed."; }
        byDisplayName.Clear();
    }

    private void OnParticipantAdded(VivoxParticipant participant)
    {
        var name = participant.DisplayName;
        if (name != null) byDisplayName[name] = participant;
        // People this player blocked are muted the moment they show up.
        if (grant != null && name != null && grant.ShouldMute(name)) participant.MutePlayerLocally();
        if (speechHandlers.ContainsKey(participant)) return;
        Action handler = () =>
        {
            if (participant.SpeechDetected)
            {
                var h = SpeechActivity;
                if (h != null) h(participant.DisplayName);
            }
        };
        participant.ParticipantSpeechDetected += handler;
        participant.ParticipantAudioEnergyChanged += handler;
        speechHandlers[participant] = handler;
    }

    private void OnDestroy()
    {
        if (initialized) VivoxService.Instance.ParticipantAddedToChannel -= OnParticipantAdded;
        foreach (var entry in speechHandlers)
        {
            entry.Key.ParticipantSpeechDetected -= entry.Value;
            entry.Key.ParticipantAudioEnergyChanged -= entry.Value;
        }
        speechHandlers.Clear();
        Leave();
    }

    /// <summary>The SDK asks for a token whenever it needs one: we ask the game server, which checks this is our match and channel.</summary>
    private Task<string> GetTokenAsync(string action, string fromUserUri, string channelUri)
    {
        return RequestToken(action, fromUserUri, channelUri);
    }

    private async Task<string> RequestToken(string action, string fromUserUri, string channelUri)
    {
        try
        {
            var r = await api.VoiceToken(matchId, action, channelUri, fromUserUri);
            var token = J.Str(r, "accessToken");
            if (string.IsNullOrEmpty(token)) throw new InvalidOperationException("Table voice token is empty");
            return token;
        }
        catch (ApiException e)
        {
            throw new InvalidOperationException("Table voice token is unavailable (" + e.Code + ")");
        }
    }

    private sealed class BackendTokens : IVivoxTokenProvider
    {
        private readonly CornholeVivoxVoiceClient owner;
        public BackendTokens(CornholeVivoxVoiceClient owner) { this.owner = owner; }
        public Task<string> GetTokenAsync(string issuer = null, TimeSpan? expiration = null,
            string targetUserUri = null, string action = null, string channelUri = null,
            string fromUserUri = null, string realm = null)
        {
            return owner.GetTokenAsync(action ?? "join", fromUserUri ?? targetUserUri, channelUri);
        }
    }
}
