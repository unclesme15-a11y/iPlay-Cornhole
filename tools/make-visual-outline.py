# Builds docs/art-briefs/iPlay-Cornhole-Visual-Outline.pdf (needs: pip install reportlab). Run from anywhere.
from reportlab.lib.pagesizes import letter
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
                                Image, PageBreak, KeepTogether)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

ROOT = '/home/user/iplay-cornhole'
OUT = ROOT + '/docs/art-briefs/iPlay-Cornhole-Visual-Outline.pdf'
pdfmetrics.registerFont(TTFont('Barlow', ROOT + '/unity/CornholeGreybox/Assets/Resources/UI/BarlowCondensed-SemiBold.ttf'))
for name, f in [('Body', 'DejaVuSans.ttf'), ('Body-Bold', 'DejaVuSans-Bold.ttf'), ('Body-Oblique', 'DejaVuSans.ttf')]:
    pdfmetrics.registerFont(TTFont(name, '/usr/share/fonts/truetype/dejavu/' + f))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily('Body', normal='Body', bold='Body-Bold', italic='Body-Oblique', boldItalic='Body-Bold')

NAVY = colors.HexColor('#05080B'); CYAN = colors.HexColor('#0DCCF2'); CYAN_DK = colors.HexColor('#0679A0')
GOLD = colors.HexColor('#B8862B'); INK = colors.HexColor('#1A2228'); MUTE = colors.HexColor('#5A6B74')
RULE = colors.HexColor('#D5DEE2'); TINT = colors.HexColor('#EEF6F8'); PROMPT_BG = colors.HexColor('#F4F7F8')

ss = {
 'title': ParagraphStyle('t', fontName='Barlow', fontSize=40, leading=42, textColor=NAVY, spaceAfter=10),
 'subtitle': ParagraphStyle('st', fontName='Body', fontSize=12, leading=17, textColor=MUTE),
 'h1': ParagraphStyle('h1', fontName='Barlow', fontSize=24, leading=27, textColor=NAVY, spaceBefore=4, spaceAfter=8),
 'h2': ParagraphStyle('h2', fontName='Barlow', fontSize=15, leading=18, textColor=CYAN_DK, spaceBefore=10, spaceAfter=4),
 'body': ParagraphStyle('b', fontName='Body', fontSize=9.6, leading=14, textColor=INK, spaceAfter=5),
 'small': ParagraphStyle('s', fontName='Body', fontSize=8.4, leading=11.5, textColor=INK),
 'cell': ParagraphStyle('c', fontName='Body', fontSize=8.4, leading=11.2, textColor=INK),
 'cellh': ParagraphStyle('ch', fontName='Body-Bold', fontSize=8.4, leading=11.2, textColor=colors.white),
 'bullet': ParagraphStyle('bl', fontName='Body', fontSize=9.6, leading=14, textColor=INK, leftIndent=12, bulletIndent=2, spaceAfter=2),
 'prompt': ParagraphStyle('p', fontName='Body', fontSize=8.8, leading=12.6, textColor=INK),
 'plabel': ParagraphStyle('pl', fontName='Body-Bold', fontSize=8.8, leading=12, textColor=NAVY, spaceAfter=2),
}
P = lambda t, s='body': Paragraph(t, ss[s])
def bullets(items): return [Paragraph(i, ss['bullet'], bulletText='•') for i in items]

def table(rows, widths, header=True):
    data = [[Paragraph(c, ss['cellh'] if (header and r == 0) else ss['cell']) for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    st = [('GRID', (0, 0), (-1, -1), 0.5, RULE), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
          ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
          ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5)]
    if header: st += [('BACKGROUND', (0, 0), (-1, 0), NAVY)]
    for r in range(1 if header else 0, len(rows)):
        if r % 2 == 0: st.append(('BACKGROUND', (0, r), (-1, r), TINT))
    t.setStyle(TableStyle(st)); return t

def prompt(label, text):
    inner = [Paragraph(label, ss['plabel']), Paragraph(text, ss['prompt'])]
    t = Table([[inner]], colWidths=[6.9 * inch])
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), PROMPT_BG), ('LINEBEFORE', (0, 0), (0, -1), 3, CYAN),
                           ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                           ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 7)]))
    return KeepTogether([t, Spacer(1, 6)])

def swatches(items):
    cells = []
    for name, hx in items:
        sw = Table([['']], colWidths=[0.36 * inch], rowHeights=[0.26 * inch])
        sw.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(hx)), ('BOX', (0, 0), (-1, -1), 0.5, RULE)]))
        cells.append([sw, Paragraph(f'<b>{name}</b><br/>{hx}', ss['small'])])
    rows = [sum(cells[i:i + 4], []) for i in range(0, len(cells), 4)]
    for r in rows:
        while len(r) < 8: r.append('')
    t = Table(rows, colWidths=[0.45 * inch, 1.28 * inch] * 4)
    t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
    return t

def on_page(c, doc):
    c.saveState()
    c.setFillColor(NAVY); c.rect(0, letter[1] - 0.32 * inch, letter[0], 0.32 * inch, fill=1, stroke=0)
    c.setFillColor(CYAN); c.rect(0, letter[1] - 0.35 * inch, letter[0], 0.03 * inch, fill=1, stroke=0)
    c.setFont('Barlow', 10); c.setFillColor(colors.white)
    c.drawString(0.8 * inch, letter[1] - 0.22 * inch, 'iPLAY CORNHOLE  ·  VISUAL OUTLINE FOR IMAGE GENERATION')
    c.setFont('Body', 7.5); c.setFillColor(MUTE)
    c.drawRightString(letter[0] - 0.8 * inch, 0.45 * inch, f'Page {doc.page}')
    c.drawString(0.8 * inch, 0.45 * inch, 'Source: docs/ in the iPlay-Cornhole repo. October 2026.')
    c.restoreState()

doc = BaseDocTemplate(OUT, pagesize=letter, leftMargin=0.8 * inch, rightMargin=0.8 * inch, topMargin=0.7 * inch, bottomMargin=0.75 * inch,
                      title='iPlay Cornhole: Visual Outline', author='iPlay', subject='Full picture for image generation')
doc.addPageTemplates([PageTemplate(id='p', frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')], onPage=on_page)])
W = doc.width
s = []

# ---------------- cover
s += [Spacer(1, 0.35 * inch)]
logo = Image(ROOT + '/assets/logo/iplay-mark-source.jpg', width=1.6 * inch, height=1.6 * inch)
s += [logo, Spacer(1, 14), P('iPlay Cornhole', 'title'), P('Visual outline: the full picture for image generation', 'subtitle'), Spacer(1, 18)]
s += [P('<b>Read this first (for the image AI).</b> This document describes a mobile game called <b>iPlay Cornhole</b> and everything about how it must look. '
        'It is the shared context for every image you are asked to make. Keep every image consistent with it: the brand, the scene, the board, the bags and the people. '
        'When a request in the chat conflicts with this document, ask before guessing.')]
s += [P('<b>The logo.</b> The image above is the real iPlay app icon: a dark brushed-metal tile with a glowing cyan "i" and a play triangle. '
        'This is <b>the</b> iPlay mark. Whenever an image includes the logo, use this exact mark. Never redesign, restyle or re-letter it.')]
s += [Spacer(1, 8), P('Contents', 'h2')]
toc = ['1. The game in one page', '2. The iPlay look (brand rules)', '3. The world: the park cookout scene', '4. Cameras and what is video vs. 3D',
       '5. The characters', '6. The board', '7. The bags', '8. The iPlay nameplate (all iPlay games)',
       '9. Rules for every image', '10. Image list and prompts: board, bags, nameplate', '11. What is already decided']
s += [P('<br/>'.join(toc))]
s += [PageBreak()]

# ---------------- 1
s += [P('1. The game in one page', 'h1')]
s += [P('<b>iPlay Cornhole</b> is a first-person, regulation cornhole game for phones, played <b>landscape</b>. You stand at the board and see your hand holding a bag at the bottom of the screen. '
        'The far board is 27 feet ahead, across a summer park cookout. You aim with a line and a landing ring, pull back for distance and flick up to throw. Wind changes every inning.')]
s += bullets([
    '<b>Modes:</b> 1 vs 1 and 2 vs 2. Friends by invite link, video opponents (bots), and <b>ranked</b> matches with global leaderboards for singles and duo teams.',
    '<b>Players:</b> adults only (18+). Live voice chat between players.',
    '<b>Money:</b> free with ads. Nothing to buy and no betting, ever.',
    '<b>Rules:</b> official cornhole. 4 bags each, bag on the board = 1 point, in the hole = 3, cancellation scoring, play to 21.',
    '<b>Big moment:</b> when a bag drops in the hole, the custom iPlay LED board bursts with light and a game-show style "ring-in" bell plays. A "CORNHOLE!" result appears.',
    '<b>Family:</b> part of a set of iPlay games on one brand. The sister game is <b>iPlay Street Dice</b> (a bodega street-dice game). Both share one look and the same iPlay nameplate.',
])
s += [P('Example: Keisha (a video opponent) steps up at the far end and throws. Her bag flies toward you, slides up the board and drops in the hole. '
        'The board flashes white and her team color, the bell rings, and the nearby crowd reacts ("ayy!").')]

# ---------------- 2
s += [P('2. The iPlay look (brand rules)', 'h1')]
s += [P('One look across every iPlay game, set by Street Dice: <b>distressed dark surfaces, restrained cyan glow, gold edges, and clean functional lettering</b>. '
        'Premium and real, never cartoonish. The menus are dark; the game world itself (the park) is bright, natural daylight.')]
s += [swatches([('Navy black', '#05080B'), ('iPlay cyan', '#0DCCF2'), ('Soft cyan', '#5FE0FA'), ('Gold edge', '#E8B84A'),
                ('Gunmetal', '#2A2F33'), ('Hot (rare)', '#FF4A1C')])]
s += [Spacer(1, 4)]
s += bullets([
    '<b>Metal:</b> dark gunmetal, brushed with fine straight lines, exactly like the app icon. Used for the board frame and the nameplate.',
    '<b>Glow:</b> iPlay cyan, soft and controlled, like light coming from inside. Never neon overload.',
    '<b>Gold:</b> thin edges, rims and pinstripes only. An accent, not a fill.',
    '<b>Hot red/orange:</b> saved for one big moment only (a 5+ win streak). Do not use it elsewhere.',
    '<b>Lettering:</b> Barlow Condensed SemiBold for UI. Brush or graffiti style is allowed for big headings only.',
])

# ---------------- 3
s += [P('3. The world: the park cookout scene', 'h1')]
s += [P('<b>Scene 1: a big open park on a hot summer afternoon, at a hood BBQ cookout.</b>')]
s += bullets([
    'Wide open green park in full afternoon sun. The cornhole lane is on flat, trimmed grass with open space around it.',
    'Cookout life in the <b>background only</b>: grills smoking, pop-up tents, folding tables, coolers, a speaker, string lights or balloons on the tents.',
    'A big, <b>female-heavy crowd</b> in the distance: mostly Black women, then Latina, then white. Curvy, thick-figured adults in summer outfits (sundresses, shorts, tank tops, sandals), hanging out, dancing, some watching the game. Some men mixed in.',
    'The crowd stays <b>behind and to the sides</b> of the boards, never between them. The lane stays clear.',
    'Background people are slightly soft-focus so the boards and players stand out.',
    '<b>No logos, brand names or readable text anywhere in the scene.</b>',
])
s += [P('Keep it natural', 'h2')]
s += bullets([
    'Nobody poses or stares into the camera. Most people are in their own conversations; only those nearest the lane look over.',
    'At most one or two phones in any shot, and some shots have none.',
    'Describe the vibe and one or two details. Long checklists make everything happen at once and look staged.',
])
s += [P('Later scenes, after this one is locked: backyard, rooftop, beach.', 'small')]

# ---------------- 4
s += [P('4. Cameras, and what is video vs. 3D', 'h1')]
s += [P('<b>The people and the place are real-looking video</b> (made with Kling from approved still images). <b>The bags, the board lights and the score are 3D in Unity.</b> '
        'The same split as Street Dice, where video makes the bodega and Unity owns the dice.')]
s += [table([
    ['Plate', 'What you see', 'When'],
    ['1. Thrower View', 'First person from the pitcher\'s box, looking down the lane at the far board about 27 ft away. Your own board fills the lower part of the frame. Your hand comes in from the bottom-right (bottom-left for lefties).', 'Aiming and throwing; watching far-end players throw at you'],
    ['2. Far Board Cam', 'Close-up of the far board, low and slightly to the side.', 'Cut to it about 0.3 s after a throw toward the far board'],
    ['3. Neighbor Cut', 'Short side angle of the player sharing your end.', 'When the player beside you throws'],
], [1.2 * inch, 3.9 * inch, 1.8 * inch])]
s += [Spacer(1, 6)]
s += bullets([
    '<b>Plates are locked stills.</b> One approved frame per angle; every video clip for that angle starts from it.',
    '<b>Boards in the video plates have their LED strips switched off</b> (dark, clear strips). Unity draws the light on top, so it can flash exactly when a bag drops in.',
    'Bags in 3D fly, land, slide, squash and stack, with a contact shadow, and really disappear into the hole.',
    'The game is <b>16:9 landscape</b>. Every plate, clip and menu is made 16:9.',
])

# ---------------- 5
s += [P('5. The characters (video opponents)', 'h1')]
s += [P('8 characters, 4 women and 4 men, ages 30 to 50, dressed for a hot summer cookout. <b>All clothes are plain, with no logos or readable text.</b> '
        'Make one approved reference portrait per character first, then use that same reference for every clip so the face, body and outfit never change.')]
s += [table([
    ['Name', 'Age', 'Look', 'Outfit', 'Personality'],
    ['Keisha', '34', 'Black woman, curvy, long braids pulled up', 'Bright yellow sundress, white sneakers, big hoop earrings', 'Smooth, confident, smiling trash talk'],
    ['Tanya', '46', 'Black woman, full-figured, short natural curls', 'Linen shorts set, sandals, sunglasses on her head', 'Auntie energy, cheers loud'],
    ['Marisol', '38', 'Latina, curvy, long wavy hair', 'Denim shorts, fitted tank top, wedge sandals', 'Quick, competitive, hypes her partner'],
    ['Jenna', '42', 'White woman, athletic-curvy, blonde ponytail', 'Tank top, bike shorts, running shoes, visor', 'Serious form, quiet fist pump'],
    ['Dre', '36', 'Black man, tall, lean, low fade, beard', 'Plain white tee, basketball shorts, slides with socks', 'Cool and relaxed, airmail specialist'],
    ['Big Mike', '48', 'Black man, big build, bald, salt-and-pepper beard', 'Short-sleeve button-up, cargo shorts, grill apron in some clips', 'Grill master, big laugh, points at people'],
    ['Carlos', '41', 'Latino, stocky, short curly hair, mustache', 'Plain polo, khaki shorts, sneakers', 'Steady, slow nod when he scores'],
    ['Travis', '33', 'White man, average build, backwards cap, scruff', 'Plain tank top, board shorts, flip-flops', 'Goofy, dances after a cornhole'],
], [0.75 * inch, 0.4 * inch, 1.75 * inch, 2.05 * inch, 1.95 * inch])]
s += [Spacer(1, 4), P('Each character needs 7 clips: idle, step-up, throw, good reaction, bad reaction, reaction to the opponent scoring, and a side-angle throw. Keisha is built first.', 'small')]

# ---------------- 6
s += [P('6. The board: the custom iPlay LED board', 'h1')]
s += [P('A premium, regulation cornhole board, iPlay-branded, that looks completely real: a <b>deep glossy black deck</b> with a clear-coat shine, a <b>brushed dark gunmetal frame</b> (like the app icon), '
        '<b>thin LED strips</b> down both long sides, along the front edge and in a ring around the hole, and the iPlay mark and nameplate on the deck.')]
s += [table([
    ['Part', 'Real-world spec'],
    ['Deck', '24 x 48 in, deep glossy black, clear coat. iPlay mark printed large in cyan on the lower half of the deck.'],
    ['Hole', '6 in across, centred 9 in from the back (top) edge. Metal trim ring with a thin gold inner edge.'],
    ['Frame', 'About 3.5 in thick (2x4), brushed dark gunmetal, thin gold pinstripe accents.'],
    ['Height', 'Back about 12 in off the ground, front about 3 in (the deck slopes toward the thrower).'],
    ['LEDs', '73 LEDs down each long side, 37 along the front edge, 24 in a ring around the hole. Frosted diffuser strips.'],
    ['Front apron', 'The iPlay nameplate (section 8) mounted across the front.'],
    ['Wear', 'Slight dust and bag-rub marks up the middle of the deck, so it looks played on.'],
], [1.2 * inch, 5.7 * inch])]
s += [P('What the lights do', 'h2')]
s += [table([
    ['Moment', 'Lights'],
    ['Idle', 'Cyan running lights chase down both sides; slow glow on the front; small spinner around the hole.'],
    ['Bag drops in the hole', 'Burst for 1.8 s: rails and front alternate white and the scoring team\'s bag color (max 3 flashes a second), hole ring pulses gold.'],
    ['Inning scored', 'One soft pulse in the scoring team\'s color.'],
    ['Match won', 'Fast chase in the winner\'s color and white, 4 s.'],
], [1.6 * inch, 5.3 * inch])]
s += [P('For still images: show the LEDs glowing softly cyan (the idle look) unless asked otherwise. For video plates: LEDs <b>off</b>.', 'small')]

# ---------------- 7
s += [P('7. The bags', 'h1')]
s += bullets([
    '<b>Size and weight:</b> 6 x 6 in, about 16 oz, resin-filled, so they slump and sag over the board when they land.',
    '<b>Two sides:</b> smooth heavy <b>duck-cloth canvas</b> (slides) on one side, <b>suede</b> (grips) on the other.',
    '<b>Border:</b> double-stitched seam all round.',
    '<b>Logo:</b> the iPlay mark screen-printed in the centre, about 3.4 in wide. <b>White mark on dark bags, black mark on light bags.</b>',
    '<b>Team B</b> bags also get a <b>stitched X</b> across the front, so color-blind players can tell the teams apart.',
])
s += [P('The 12 team colors', 'h2')]
s += [swatches([('Black', '#1B1B1B'), ('White', '#F4F4F2'), ('Red', '#C8102E'), ('Orange', '#FF6A13'), ('Yellow', '#FFD100'), ('Kelly Green', '#009A44'),
                ('Royal Blue', '#1D4ED8'), ('Sky Blue', '#6CC5F0'), ('Purple', '#6B2C91'), ('Hot Pink', '#E0218A'), ('Teal', '#00A5A8'), ('Maroon', '#6D1A2A')])]
s += [P('White mark on: black, red, kelly green, royal blue, purple, hot pink, teal, maroon. Black mark on: white, yellow, orange, sky blue.', 'small')]

# ---------------- 8
s += [P('8. The iPlay nameplate (every iPlay game)', 'h1')]
s += [P('<b>One brand plate shared by all iPlay games</b>, so the brand reads the same everywhere. In Cornhole it sits on the board\'s front apron and under the logo on the deck. '
        'In Street Dice and future games it appears on menus, loading screens and wherever the brand shows.')]
s += bullets([
    'A slim horizontal plate, about <b>4 to 1</b> wide, in the same dark brushed gunmetal as the app icon. Bevelled edges and a thin polished gold rim.',
    'On the left, the iPlay mark glowing cyan. Next to it, the word <b>iPlay</b> in clean, bold, modern lettering (spelled exactly: lower-case i, capital P).',
    'A <b>custom audio waveform</b> runs the full width behind the lettering. It looks etched into the metal and lit from inside: cyan in the middle, blending to warm gold toward both ends.',
    'The waveform will be rebuilt as an exact vector shape so it is identical in every game and can pulse with sound. Images of it are a <b>design target</b>; three style options are requested in section 10.',
])

# ---------------- 9
s += [P('9. Rules for every image', 'h1')]
s += [P('Two kinds of images', 'h2')]
s += [table([
    ['Kind', 'What it is', 'How to make it'],
    ['Look reference', 'A realistic, photo-style picture of the finished thing, to agree the design.', 'Photorealistic, natural daylight, real materials, real detail.'],
    ['Texture sheet', 'A flat close-up of a surface (fabric, metal, paint) that the 3D game wraps onto a shape.', 'Straight down, evenly lit, no shadows, fills the square, tiles seamlessly. Rule below.'],
], [1.2 * inch, 2.9 * inch, 2.8 * inch])]
s += [Spacer(1, 6)]
s += [prompt('Add to the end of every texture sheet prompt',
             'Flat orthographic view straight down, perfectly even soft lighting, no shadows, no highlights, no reflections, no perspective, no vignette, no text, no logos, no border. '
             'The texture fills the whole square edge to edge and tiles seamlessly.')]
s += bullets([
    '<b>Logo images:</b> the real iPlay icon is attached. Use that exact mark. Never invent or restyle a logo.',
    '<b>Lettering:</b> the only words that may appear are "iPlay" (exact spelling) and, where asked, "CORNHOLE". No other text.',
    '<b>Textures:</b> square, the largest size available, PNG. Fabrics in neutral mid-gray (the game tints them into team colors).',
    '<b>Realism:</b> real materials, real scale, real wear. No cartoon, no illustration style, no plastic look.',
    '<b>Consistency:</b> the board, bags and plate must match sections 6 to 8 in every image.',
])

# ---------------- 10
s += [PageBreak(), P('10. Image list and prompts: board, bags, nameplate', 'h1')]
s += [P('<b>Order:</b> first the three hero looks (A1, B1, C1) and the waveform options (C4) to agree the design; then the texture sheets. File names are what to call each image.')]
s += [P('A. The board', 'h2')]
s += [table([
    ['#', 'Image', 'Kind', 'File name'],
    ['A1', 'The finished board, hero view', 'Look reference', 'board-ref-hero.png'],
    ['A2', 'The board from straight above', 'Look reference', 'board-ref-top.png'],
    ['A3', 'Glossy black deck surface', 'Texture', 'board-deck-albedo.png'],
    ['A4', 'Brushed dark gunmetal frame', 'Texture', 'board-frame-metal.png'],
    ['A5', 'Frosted LED diffuser strip, lights off', 'Texture', 'board-led-diffuser.png'],
    ['A6', 'Scuff and bag-rub wear (black and white)', 'Texture', 'board-deck-wear.png'],
    ['A7', 'Metal and gold trim ring around the hole', 'Texture', 'board-hole-trim.png'],
    ['A8', 'Deck artwork (logo and nameplate) alone', 'Transparent decal', 'board-deck-decal.png'],
    ['A9', 'Underside, legs and hinge hardware', 'Texture', 'board-underside.png'],
], [0.4 * inch, 3.3 * inch, 1.3 * inch, 1.9 * inch])]
s += [Spacer(1, 6)]
s += [prompt('A1. Board hero (attach the logo)',
 'Photorealistic product photo of a premium regulation cornhole board, 24 by 48 inches, at a sunny summer park cookout, three-quarter view from the front at waist height. '
 'Deep glossy black deck with a clear-coat shine reflecting the sky, one 6-inch hole near the top. Frame of brushed dark gunmetal like the attached app icon, with thin cyan LED strips glowing softly along both long sides, the front edge, and in a ring around the hole. '
 'The attached iPlay logo printed large on the lower half of the deck in glowing cyan, with a slim brushed-metal "iPlay" nameplate across the front apron. Gold pinstripe edge accents. '
 'Real wood and metal detail, slight dust and bag-rub wear on the deck, natural daylight, shallow depth of field. Use this exact logo, do not redesign it.')]
s += [prompt('A2. Board from above (attach the logo)',
 'Same board as before, viewed perfectly straight down from above, flat orthographic, the whole board filling the frame vertically, even lighting, no perspective, no shadows. '
 'Shows the exact layout: hole near the top, logo on the lower half, LED strips down both sides and in a ring around the hole, metal frame around the edge. Use this exact logo.')]
s += [prompt('A3. Deck surface', 'Close-up of a deep glossy black painted wood surface with a thick clear coat: very fine orange-peel texture in the lacquer, faint wood grain barely visible under the paint, a few microscopic dust specks. [texture rule]')]
s += [prompt('A4. Brushed metal', 'Close-up of dark gunmetal brushed aluminium, fine straight horizontal brush lines, subtle variation, matching the attached iPlay app icon\'s metal. [texture rule]')]
s += [prompt('A5. LED diffuser', 'Close-up of a frosted white polycarbonate LED strip diffuser with the lights switched off, milky and translucent, faint dot pattern of the LEDs underneath, thin aluminium channel edges along the top and bottom. Wide strip filling the square, tiles left to right. [texture rule]')]
s += [prompt('A6. Wear map', 'Grayscale texture map: pure black background with soft white streaks and smudges where cornhole bags slide up a board toward the hole, light scuffs and faint dust. Mostly black; the wear is subtle. [texture rule]')]
s += [prompt('A7. Hole trim', 'Close-up of a polished dark metal ring trim with a thin gold inner edge, the kind set around a hole in a premium board. Straight down, the ring centred and filling the square, pure black in the middle. Even lighting, no shadows, no perspective.')]
s += [prompt('A8. Deck artwork (attach the logo and the approved nameplate)', 'The deck artwork alone for a cornhole board, on a transparent background: the attached iPlay logo large and centred, glowing cyan with a soft halo, and the iPlay nameplate below it. Flat graphic, no board, no perspective, no shadows. Use this exact logo.')]
s += [prompt('A9. Underside', 'Close-up of the raw underside of a cornhole board: sanded birch plywood with dark gunmetal folding-leg hardware and a black hinge bracket in one corner. Straight down, even lighting, no shadows, no perspective.')]

s += [P('B. The bags', 'h2')]
s += [table([
    ['#', 'Image', 'Kind', 'File name'],
    ['B1', 'The bags, hero view', 'Look reference', 'bag-ref-hero.png'],
    ['B2', 'Duck-cloth fabric (slide side), neutral gray', 'Texture', 'bag-duck-albedo.png'],
    ['B3', 'Suede (grip side), neutral gray', 'Texture', 'bag-suede-albedo.png'],
    ['B4', 'Stitched border seam', 'Texture strip', 'bag-stitch-strip.png'],
    ['B5', 'Screen-print ink grain (black and white)', 'Texture', 'bag-print-grain.png'],
    ['B6', 'One bag laid flat, both faces', 'Look reference', 'bag-ref-flat.png'],
], [0.4 * inch, 3.3 * inch, 1.3 * inch, 1.9 * inch])]
s += [Spacer(1, 6)]
s += [prompt('B1. Bags hero (attach the logo)',
 'Photorealistic product photo of four premium regulation cornhole bags, 6 by 6 inches, resting slumped on a glossy black cornhole board deck at a summer park. '
 'Two cobalt blue bags with the attached iPlay logo screen-printed in white in the centre, two bright yellow bags with the same logo printed in black, and the yellow ones also have a stitched X across the front. '
 'Heavy duck-cloth canvas, double-stitched edges, resin-filled so they sag naturally over the board. One bag flipped to show its suede underside. Natural daylight, shallow depth of field. Use this exact logo, do not redesign it.')]
s += [prompt('B2. Duck cloth', 'Close-up of heavy cotton duck canvas fabric, tight even weave clearly visible, mid neutral gray (no color cast), slightly worn and soft. [texture rule]')]
s += [prompt('B3. Suede', 'Close-up of microsuede fabric, short soft nap with gentle directional shading where it has been brushed, mid neutral gray (no color cast). [texture rule]')]
s += [prompt('B4. Stitch strip', 'Close-up of a double row of heavy stitching along the folded seam of a canvas bag, neutral gray fabric with slightly lighter thread, running straight left to right across the middle of the square, tiles left to right. [texture rule]')]
s += [prompt('B5. Print grain', 'Grayscale texture map of screen-printed ink on canvas: white ink with tiny cracks, slight fabric weave showing through, small worn patches, on black. [texture rule]')]
s += [prompt('B6. Flat bag (attach the logo)', 'Photorealistic photo of one cobalt blue cornhole bag laid perfectly flat, shown twice side by side: the duck-cloth front with the attached iPlay logo screen-printed in white, and the suede back. Straight down, even lighting, no shadows, white background. Use this exact logo.')]

s += [P('C. The iPlay nameplate', 'h2')]
s += [table([
    ['#', 'Image', 'Kind', 'File name'],
    ['C1', 'The nameplate, hero view', 'Look reference', 'nameplate-ref-hero.png'],
    ['C2', 'The nameplate flat, front-on (master layout)', 'Look reference', 'nameplate-ref-flat.png'],
    ['C3', 'The plate metal with no lettering or waveform', 'Texture', 'nameplate-metal.png'],
    ['C4', 'Three waveform style options', 'Look reference', 'nameplate-waveform-options.png'],
], [0.4 * inch, 3.3 * inch, 1.3 * inch, 1.9 * inch])]
s += [Spacer(1, 6)]
s += [prompt('C1. Nameplate hero (attach the logo)',
 'Photorealistic close-up of a premium slim horizontal brand nameplate, about 4 to 1 wide, mounted on the front of a glossy black cornhole board. Dark gunmetal brushed metal like the attached app icon, bevelled edges, a thin polished gold rim. '
 'On the left, the attached iPlay logo glowing cyan; next to it the word "iPlay" in clean bold modern lettering. A smooth audio sound waveform runs the full width of the plate behind the lettering, etched into the metal and glowing iPlay cyan from inside, blending into warm gold toward both ends. '
 'Subtle reflections, real machined detail, outdoor daylight. Use this exact logo, do not redesign it.')]
s += [prompt('C2. Nameplate flat', 'The same nameplate, perfectly front-on, flat orthographic, filling the frame left to right, even lighting, no perspective, no shadows, on a pure black background. Exact spelling "iPlay".')]
s += [prompt('C3. Plate metal', 'Close-up of dark gunmetal brushed metal with fine horizontal brush lines and a very slight satin sheen, matching the attached app icon. [texture rule]')]
s += [prompt('C4. Waveform options', 'Three different glowing audio waveform designs stacked on a black background, each a single horizontal line the full width: 1) a smooth flowing wave that swells in the middle, '
 '2) a spiky sound-meter waveform of thin vertical bars, mirrored top and bottom, 3) a soft layered waveform of three overlapping translucent lines. Each glows cyan in the middle, fading to gold at both ends. Flat, no perspective, no text.')]

# ---------------- 11
s += [P('11. What is already decided', 'h1')]
s += [table([
    ['Topic', 'Decision'],
    ['Screen', 'Landscape (16:9), like Street Dice.'],
    ['Scene', 'Big open park, summer hood BBQ cookout (section 3).'],
    ['Board cam', 'On by default; far board only.'],
    ['Bag colors', '12-color palette, first come first served, no two teams share a color.'],
    ['Hole sound', 'An original two-bell game-show ring-in (already made).'],
    ['Light safety', 'LED bursts capped at 3 flashes a second; a soft-glow version for players who turn on "reduce motion".'],
    ['Logo', 'The iPlay app-icon mark on the board deck, the bags and the nameplate.'],
    ['Money', 'No wagers ever, nothing for sale; ads only, never during a match.'],
    ['Video tool', 'Kling for the plates and character clips (a side-by-side test with other tools first).'],
], [1.3 * inch, 5.6 * inch])]
s += [Spacer(1, 10), P('Already built (not part of image work): the game server, rules, ranked play, leaderboards, voice chat, the Unity game logic, sounds, and the LED light patterns. '
        'The images in section 10 are the next step: they turn the plain prototype into the real-looking game.', 'small')]

doc.build(s)
print(OUT)
