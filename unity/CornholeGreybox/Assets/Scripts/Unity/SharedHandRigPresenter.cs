using System;
using System.Collections.Generic;
using IPlay.Cornhole;
using IPlay.HandRig;
using UnityEngine;

/// <summary>
/// Opt-in <see cref="MatchPresenter"/> for the shared iPlay hand rig and the cornhole bag prop.
/// The greybox does not add this on its own, so the top-down board stays the default.
/// Add it to any object in the scene, or call <see cref="Attach"/>.
///
/// Aim samples the shared cup pose and keeps the bag in the grip. A server throw plays the
/// shared release. At 0.48s the bag is handed to <see cref="OnBagReleased"/> as a
/// <see cref="CornholeArcHandoff"/> (origin, lofted direction, speed, rotation). The same
/// bag then flies. Server time 0 is that release pose, and the path is the replay
/// <see cref="OnReplayFrame"/> is built from. With no server path, a local arc is visual only.
/// This does not score the throw.
/// </summary>
public sealed class SharedHandRigPresenter : MatchPresenter
{
    const float HoldReplayTimeoutSeconds = 2f;
    const float BagClaimRadius = 0.12f;

    [SerializeField] private bool leftHanded;

    public event Action<CornholeArcHandoff> BagReleased;

    private GameObject rigRoot;
    private Camera rigCamera;
    private CornholeBagPropView view;
    private bool throwing;
    private float throwStart = -1f;
    private readonly BagFlightVisual flight = new BagFlightVisual();
    private Transform releasedBag;
    private Quaternion releaseRotation = Quaternion.identity;
    private bool hasReleaseRotation;

    public CornholeArcHandoff LastHandoff { get; private set; }
    public bool HasHandoff { get; private set; }

    /// <summary>True while the swing is playing and the bag has not left the hand, so the replay clock waits.</summary>
    public override bool HoldReplayClock
    {
        get
        {
            if (view == null || !throwing || HasHandoff || throwStart < 0f) return false;
            return Time.unscaledTime - throwStart < HoldReplayTimeoutSeconds;
        }
    }

    public static SharedHandRigPresenter Attach(GameObject host)
    {
        var existing = host.GetComponent<SharedHandRigPresenter>();
        if (existing != null) return existing;
        return host.AddComponent<SharedHandRigPresenter>();
    }

    public override void OnMatchOpened(MatchModel model, ThrowGuide guide)
    {
        EnsureRig();
        rigRoot.SetActive(true);
        ShowBag();
        flight.Clear();
        throwing = false;
        HasHandoff = false;
        view.BeginThrow();
    }

    public override void OnAimChanged(double aim, double power, string shotId, bool pulling, double handShake)
    {
        if (view == null || throwing) return;
        // The one prop is still in the air or on its way to the board. Don't pull it back to the hand.
        if (flight.IsReleased && !flight.HasLanded(Age)) return;
        if (flight.IsReleased)
        {
            ShowBag();
            flight.Clear();
        }
        if (view.HasReleased) view.BeginThrow();
        // Stay below the shared release (0.48s) so the bag does not leave during the pull.
        // A deeper pull samples earlier on the entrance, which lowers the hand.
        float hold = 0.30f - Mathf.Clamp01((float)power) * 0.14f;
        if (handShake > 0.0) view.SampleShake((float)handShake);
        else view.Sample(hold);
    }

    public override void OnThrowResult(ThrowResult result, IDictionary<string, BoardBag> boardBefore)
    {
        if (view == null) EnsureRig();
        ShowBag();
        view.BeginThrow();
        throwing = true;
        HasHandoff = false;
        hasReleaseRotation = false;
        throwStart = Time.unscaledTime;
        flight.BeginServerThrow(result, boardBefore);
        SetFlightAxes();
        view.Sample(0f);
    }

    public override void OnReplayFrame(ThrowResult result, ReplayFrame frame)
    {
        // The pose itself is applied in LateUpdate, after the rig's Sample, so the grip
        // cannot pin the bag back to the release pose for the rendered frame.
        flight.NoteReplayFrame(result, frame, Age);
    }

    public override void OnMatchClosed()
    {
        throwing = false;
        flight.Clear();
        if (rigRoot != null) rigRoot.SetActive(false);
    }

    protected virtual void OnBagReleased(CornholeArcHandoff handoff)
    {
        LastHandoff = handoff;
        var handler = BagReleased;
        if (handler != null) handler(handoff);
        if (HasHandoff) return;
        HasHandoff = true;
        StartFlight(handoff);
    }

    private void StartFlight(CornholeArcHandoff handoff)
    {
        Vector3 origin;
        Vector3 direction;
        double speed;
        ReadHandoff(handoff, out origin, out direction, out speed, out releaseRotation);
        hasReleaseRotation = true;
        releasedBag = ClaimReleasedBag(origin, releaseRotation);
        PrepareClaimedBag(releasedBag);
        SetFlightAxes();
        // Fly even if the renderer was not found: the next successful claim picks the pose up.
        flight.Release(ToFlight(origin), ToFlight(direction), speed, Age);
    }

    private void Update()
    {
        if (!throwing || view == null) return;
        float elapsed = Time.unscaledTime - throwStart;
        view.Sample(elapsed);
        if (elapsed >= ThrowTimeline.ExitTime) throwing = false;
    }

    private void LateUpdate()
    {
        if (throwStart < 0f || releasedBag == null) return;
        var pose = flight.Sample(Age);
        if (!pose.Drive) return;
        SetBagVisible(pose.Visible);
        if (!pose.Visible) return;
        releasedBag.position = ToWorld(pose.Position);
        if (hasReleaseRotation) releasedBag.rotation = releaseRotation;
    }

    private double Age
    {
        get { return throwStart < 0f ? 0 : Time.unscaledTime - throwStart; }
    }

    private void SetFlightAxes()
    {
        var cam = rigCamera != null ? rigCamera : Camera.main;
        var forward = cam != null ? cam.transform.forward : Vector3.forward;
        forward.y = 0f;
        if (forward.sqrMagnitude < 1e-8f) forward = Vector3.forward;
        forward.Normalize();
        var right = Vector3.Cross(Vector3.up, forward);
        if (right.sqrMagnitude < 1e-8f) right = Vector3.right;
        right.Normalize();
        flight.SetAxes(ToFlight(right), ToFlight(Vector3.up), ToFlight(forward));
    }

    /// <summary>
    /// The package hands over origin, direction, speed and rotation. The bag object itself
    /// stays the rig's placeholder: we move that transform and never spawn a second one.
    /// </summary>
    private static void ReadHandoff(CornholeArcHandoff handoff, out Vector3 origin, out Vector3 direction, out double speed, out Quaternion rotation)
    {
        origin = handoff.Origin;
        direction = handoff.Direction;
        speed = handoff.Speed;
        rotation = handoff.Rotation;
    }

    private Transform ClaimReleasedBag(Vector3 origin, Quaternion rotation)
    {
        // The rig's placeholder is already on this pose. Moving that renderer is the whole
        // handoff: a new cube would be a second bag.
        var found = FindBagRenderer(origin);
        if (found == null && releasedBag != null && Vector3.Distance(releasedBag.position, origin) <= BagClaimRadius)
            found = releasedBag;
        if (found == null) return null;
        found.rotation = rotation;
        return found;
    }

    private Transform FindBagRenderer(Vector3 origin)
    {
        var renderers = FindObjectsByType<Renderer>(FindObjectsInactive.Include, FindObjectsSortMode.None);
        Transform named = null;
        Transform exact = null;
        float namedDist = BagClaimRadius;
        float exactDist = 0.04f;
        for (var i = 0; i < renderers.Length; i++)
        {
            var renderer = renderers[i];
            if (renderer == null) continue;
            if (renderer.bounds.size.magnitude > 0.5f) continue;
            float dist = Vector3.Distance(renderer.transform.position, origin);
            if (IsBagName(renderer.name) && dist <= namedDist)
            {
                namedDist = dist;
                named = renderer.transform;
            }
            if (dist <= exactDist)
            {
                exactDist = dist;
                exact = renderer.transform;
            }
        }
        return named != null ? named : exact;
    }

    private static bool IsBagName(string name)
    {
        if (string.IsNullOrEmpty(name)) return false;
        if (name.IndexOf("bag", StringComparison.OrdinalIgnoreCase) >= 0) return true;
        if (name.IndexOf("bean", StringComparison.OrdinalIgnoreCase) >= 0) return true;
        if (name.IndexOf("prop", StringComparison.OrdinalIgnoreCase) >= 0) return true;
        if (name.IndexOf("cube", StringComparison.OrdinalIgnoreCase) >= 0) return true;
        return false;
    }

    private static void PrepareClaimedBag(Transform bag)
    {
        if (bag == null) return;
        if (!bag.gameObject.activeSelf) bag.gameObject.SetActive(true);
    }

    private void ShowBag()
    {
        SetBagVisible(true);
    }

    private void SetBagVisible(bool visible)
    {
        if (releasedBag == null) return;
        var renderers = releasedBag.GetComponentsInChildren<Renderer>(true);
        for (var i = 0; i < renderers.Length; i++)
        {
            if (renderers[i] != null) renderers[i].enabled = visible;
        }
    }

    private void EnsureRig()
    {
        if (view != null) return;
        rigRoot = new GameObject("Cornhole First Person Hand Rig");
        rigCamera = Camera.main;
        if (rigCamera == null)
        {
            var cameraObject = new GameObject("iPlay Hand Rig Camera");
            cameraObject.transform.SetParent(rigRoot.transform, false);
            rigCamera = cameraObject.AddComponent<Camera>();
            rigCamera.transform.position = new Vector3(0f, 1.55f, -2.4f);
            rigCamera.transform.rotation = Quaternion.Euler(8f, 0f, 0f);
            rigCamera.clearFlags = CameraClearFlags.Depth;
            rigCamera.depth = 20f;
            rigCamera.nearClipPlane = 0.05f;
            rigCamera.farClipPlane = 40f;
        }

        string label = leftHanded ? "Left" : "Right";
        string path = leftHanded ? HandModelContract.LeftResourcePath : HandModelContract.RightResourcePath;
        var hand = HandModelSlot.Create(label, path, rigRoot.transform, HandModelContract.NormalizedMaxSize);
        hand.Root.transform.localPosition = HandModelSlot.SpawnLocalPosition(label);
        hand.Root.transform.localRotation = HandModelSlot.SpawnLocalRotation(label);
        view = new CornholeBagPropView(hand.Root, rigCamera);
        view.Released += OnBagReleased;
    }

    private static FlightVec ToFlight(Vector3 v)
    {
        return new FlightVec(v.x, v.y, v.z);
    }

    private static Vector3 ToWorld(FlightVec v)
    {
        return new Vector3((float)v.X, (float)v.Y, (float)v.Z);
    }
}
