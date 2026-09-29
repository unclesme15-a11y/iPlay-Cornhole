using System.Collections.Generic;
using UnityEngine;
using IPlay.Cornhole;

/// <summary>
/// Where the visuals plug in. Put one component that derives from this anywhere in the scene (the video plates,
/// the first-person hand, the bags, the LED board, the crowd) and the game calls it with everything that happens.
/// The game logic never depends on it: with none in the scene the match still plays, with the plain top-down view.
///
/// Everything a visual needs is already decided by the server and given here in board coordinates
/// (inches; x from the centre line, y from the target board's front edge; the hole is at x 0, y 39).
/// </summary>
public abstract class MatchPresenter : MonoBehaviour
{
    /// <summary>A match screen opened. Use the guide for the aim ring and hole marks.</summary>
    public virtual void OnMatchOpened(MatchModel model, ThrowGuide guide) { }

    /// <summary>The player is lining up (drag), pulling the bag back, or letting go. Move the hand and the aim ring.</summary>
    public virtual void OnAimChanged(double aim, double power, string shotId, bool pulling, double handShake) { }

    /// <summary>The server's answer to a throw (anyone's): the whole flight, slide and result. Start the throw animation.</summary>
    public virtual void OnThrowResult(ThrowResult result, IDictionary<string, BoardBag> boardBefore) { }

    /// <summary>Called every frame while a throw replays. Position the thrown bag (and any bags it moves).</summary>
    public virtual void OnReplayFrame(ThrowResult result, ReplayFrame frame) { }

    /// <summary>A sound/light cue is due (a cornhole: the ring-in sound and the board's LED flash; a thud; a foul).</summary>
    public virtual void OnCue(Cue cue, bool reduceMotion) { }

    /// <summary>The wind changed (start of an inning). Wave the flags and the trees.</summary>
    public virtual void OnWind(WindInfo wind) { }

    public virtual void OnScore(string team, double points) { }
    public virtual void OnMatchEnded(string winnerTeam, string reason) { }
    public virtual void OnMatchClosed() { }
}
