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
/// <see cref="CornholeArcHandoff"/> (origin, lofted direction, speed). This does not run
/// dice physics and does not decide the score. Draw the server flight from OnReplayFrame.
/// </summary>
public sealed class SharedHandRigPresenter : MatchPresenter
{
    [SerializeField] private bool leftHanded;

    public event Action<CornholeArcHandoff> BagReleased;

    private GameObject rigRoot;
    private CornholeBagPropView view;
    private bool throwing;
    private float throwStart = -1f;

    public CornholeArcHandoff LastHandoff { get; private set; }
    public bool HasHandoff { get; private set; }

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
        view.BeginThrow();
        throwing = false;
        HasHandoff = false;
    }

    public override void OnAimChanged(double aim, double power, string shotId, bool pulling, double handShake)
    {
        if (view == null || throwing) return;
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
        view.BeginThrow();
        throwing = true;
        HasHandoff = false;
        throwStart = Time.unscaledTime;
        view.Sample(0f);
    }

    public override void OnMatchClosed()
    {
        throwing = false;
        if (rigRoot != null) rigRoot.SetActive(false);
    }

    protected virtual void OnBagReleased(CornholeArcHandoff handoff)
    {
        LastHandoff = handoff;
        HasHandoff = true;
        var handler = BagReleased;
        if (handler != null) handler(handoff);
    }

    private void Update()
    {
        if (!throwing || view == null) return;
        float elapsed = Time.unscaledTime - throwStart;
        view.Sample(elapsed);
        if (elapsed >= ThrowTimeline.ExitTime) throwing = false;
    }

    private void EnsureRig()
    {
        if (view != null) return;
        rigRoot = new GameObject("Cornhole First Person Hand Rig");
        var camera = Camera.main;
        if (camera == null)
        {
            var cameraObject = new GameObject("iPlay Hand Rig Camera");
            cameraObject.transform.SetParent(rigRoot.transform, false);
            camera = cameraObject.AddComponent<Camera>();
            camera.transform.position = new Vector3(0f, 1.55f, -2.4f);
            camera.transform.rotation = Quaternion.Euler(8f, 0f, 0f);
            camera.clearFlags = CameraClearFlags.Depth;
            camera.depth = 20f;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 40f;
        }

        string label = leftHanded ? "Left" : "Right";
        string path = leftHanded ? HandModelContract.LeftResourcePath : HandModelContract.RightResourcePath;
        var hand = HandModelSlot.Create(label, path, rigRoot.transform, HandModelContract.NormalizedMaxSize);
        hand.Root.transform.localPosition = HandModelSlot.SpawnLocalPosition(label);
        hand.Root.transform.localRotation = HandModelSlot.SpawnLocalRotation(label);
        view = new CornholeBagPropView(hand.Root, camera);
        view.Released += OnBagReleased;
    }
}
