# Game Rules Contract

Working title: **iPlay Cornhole**

This file uses standard regulation cornhole (the version used by the major leagues, ACL/ACO style) as its base. Each rule is tagged:

- **[Reg]**: standard regulation rule.
- **[iPlay]**: a choice made for this game. It can be changed.
- **[House]**: a common backyard variant, available as an optional table setting.

## Equipment

- **[Reg]** Board: 2 ft x 4 ft playing surface. 6 in hole, centered 9 in from the top edge. Front edge about 3-4 in off the ground, back edge about 12 in.
- **[Reg]** Distance: 27 ft between the front edges of the two boards. The junior/casual distance is 21 ft. **[iPlay]** Default is 27 ft. "Backyard 21 ft" is an option on the Match Setup screen.
- **[Reg]** Bags: 6 in x 6 in, about 16 oz. Each player gets 4 bags, and each team uses one color.
- **[Reg]** Pitcher's box: a 3 ft x 4 ft area on each side of every board. The player must stay in it while throwing. The **foul line** is the front edge of the board.

## Scoring

- **[Reg]** Bag goes through the hole (a "cornhole"): **3 points**. That includes a bag that slides in or is knocked in later.
- **[Reg]** Bag is resting on the board at the end of the inning (a "woody"): **1 point**.
- **[Reg]** Bag touching the ground at all, even if it's hanging off the edge while partly on the board: **0**. It is removed.
- **[Reg]** **Cancellation scoring:** at the end of each inning, subtract the smaller team's points from the larger team's. Only the team with more points scores, and only the difference.
  - Example: you get one in the hole and one on the board (3 + 1 = 4). Your opponent gets one on the board (1). You score **3** and they score **0**.
  - Example: both teams total 4. Nobody scores ("wash").
- **[Reg]** Bags knocked around count where they finish. If an opponent pushes your bag into the hole, you get 3.
- **[Reg]** The most one team can score in an inning is 12 (4 bags x 3).

## Innings (Frames)

- **[Reg]** One inning = every player at that end throws all 4 bags. Players alternate one bag at a time: A, B, A, B, A, B, A, B.
- **[Reg]** The team that scored in the last inning throws first in the next one. After a wash, the team that threw first last time goes first again.
- **[Reg]** Coin toss decides who throws first in the first inning. **[iPlay]** The app uses a server coin flip with an animation.
- **[Reg]** Singles: after each inning, both players walk to the other end. **[iPlay]** The park scene looks the same from both ends, so the camera stays put. You just keep throwing "down the lane" every inning.

## Winning

- **[Reg]** The first team to reach **21 or more** at the end of an inning wins. You don't need to land on exactly 21.
- **[House] Bust rule:** a team that goes over the target score drops back (to 15 when playing to 21). Off by default.
- **[House] Skunk:** a team leading 11-0 at the end of an inning wins right away. Off by default.
- The target score and these toggles are all set on the **Match Setup** screen below.

## Match Setup Screen **[iPlay]**

Before every match, the host sees one setup screen. Everything starts at the default, so they can just tap **Start**.

| Option | Choices | Default |
|--------|---------|---------|
| Mode | 1v1 / 2v2 | 2v2 |
| Seats | Each seat: Human (invite) or Video Bot | You + 3 bots |
| Bot skill | Rookie / Regular / Pro (per bot) | Regular |
| Play to | 11 / 15 / 21 | **21** |
| Bust rule | Off / On | Off |
| Skunk (11-0) | Off / On | Off |
| Distance | Regulation 27 ft / Backyard 21 ft | 27 ft |
| Throw timer | 20 s / Off | 20 s |
| Board-cam cut (far board only) | On / Off | **On** |
| Tutorial tips | On / Off | Off |

Whatever the host picks shows on everyone's screen before the coin toss, so all players know the rules for that game.

After setup, each player picks a video character, then each team picks a bag color, first come first served. Two teams can never share a color (see `visual-camera-plan.md` → Bag Color Pick). Then the coin toss.

## Fouls (Bag Removed, Scores 0)

- **[Reg]** Stepping on or past the foul line when the bag is released.
- **[Reg]** Throwing from outside the pitcher's box.
- **[Reg]** The bag touches the ground before landing on the board (bouncing off the grass onto the board doesn't count).
- **[Reg]** The bag hits a tree, an overhead object, a person, or anything else before landing.
- **[Reg]** Taking longer than the throw timer. **[iPlay]** The timer is 20 seconds. When it runs out the bag counts as a foul, and the bag icon shows it.
- **[iPlay]** Players can't physically step over a line in a phone game, so foot fouls only apply as an optional "Pro Footwork" mode where the swipe has to start inside a marked zone. Off by default.

## Singles vs Doubles

- **[Reg] Singles (1v1):** both players stand at the same end, one on each side of the board, and throw at the far board. After each inning they walk to the other end.
- **[Reg] Doubles (2v2):** partners stand at **opposite** ends. Each end has one player from each team. Only one end throws in an inning. The next inning, the other end throws back.
  - This is the key layout point for the video idea. When the far end is throwing, you are looking straight at those two players as they throw at **your** board. That's the "their hole is right in front of me" shot.
- **[iPlay]** Only regulation layouts are used. There is no non-regulation face-off mode.

## No Wagers

- **[iPlay]** Cornhole has no wagers, no wallet, and no money of any kind. Matches are played for wins, stats, and bragging rights only.
