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
       '5. The characters', '6. The board', '7. The bags', '8. The title logo and the iPlay nameplate',
       '9. Rules for every image', '10. The image list, one image at a time', '11. What is already decided']
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
    ['Deck', '24 x 48 in, deep glossy black, clear coat. The iPLAY CORNHOLE title logo (section 8) printed large on the lower half of the deck.'],
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
    '<b>Logo:</b> the regular iPlay mark (the i and the play button from the app icon, without the square tile) screen-printed in the centre, about 3.4 in wide. <b>No words or lettering on the bags.</b> <b>White mark on dark bags, black mark on light bags.</b>',
    '<b>Weight:</b> real tournament bags that lie fairly flat and drape. Never puffy pillows. The suede side is the same color as the front.',
    '<b>Team B</b> bags also get a <b>stitched X</b> across the front, so color-blind players can tell the teams apart.',
])
s += [P('The 12 team colors', 'h2')]
s += [swatches([('Black', '#1B1B1B'), ('White', '#F4F4F2'), ('Red', '#C8102E'), ('Orange', '#FF6A13'), ('Yellow', '#FFD100'), ('Kelly Green', '#009A44'),
                ('Royal Blue', '#1D4ED8'), ('Sky Blue', '#6CC5F0'), ('Purple', '#6B2C91'), ('Hot Pink', '#E0218A'), ('Teal', '#00A5A8'), ('Maroon', '#6D1A2A')])]
s += [P('White mark on: black, red, kelly green, royal blue, purple, hot pink, teal, maroon. Black mark on: white, yellow, orange, sky blue.', 'small')]

# ---------------- 8
s += [P('8. The title logo and the iPlay nameplate', 'h1')]
s += [P('The play button carved into the P', 'h2')]
s += [P('<b>The signature idea of the brand: the play button from the app icon is carved into the bowl of the letter P.</b> The P stays a P; the glowing cyan play triangle sits inside it, as if cut into the metal. It appears in both the title logo and the nameplate.')]
s += [P('Title logo: iPLAY CORNHOLE', 'h2')]
tl = Image(ROOT + '/docs/art-briefs/reference/title-logo-approved-direction.png', width=3.3 * inch, height=2.2 * inch)
s += [Table([[tl, [P('<b>Approved direction.</b> "iPLAY" over "CORNHOLE" in chunky hand-brushed graffiti lettering of brushed silver metal with thick polished gold edges and a soft cyan glow. The play button carved into the P. The O of CORNHOLE is a glowing cyan cornhole hole. Cyan and gold paint splash behind.', 'small'), Spacer(1, 4),
          P('<b>For the final version:</b> clean, readable letters with the exact spelling (lowercase i, then PLAY; CORNHOLE). <b>No bags, pillows or other objects</b> in the logo. Used on the board deck, the app icon/splash, menus and the store.', 'small')]]],
               colWidths=[3.45 * inch, 3.45 * inch], style=TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP')]))]
s += [P('The iPlay nameplate (every iPlay game)', 'h2')]
np_img = Image(ROOT + '/docs/art-briefs/reference/nameplate-round1.png', width=6.9 * inch, height=6.9 * inch * 198 / 805)
s += [np_img, Spacer(1, 4)]
s += [P('<b>One brand plate shared by all iPlay games.</b> In Cornhole it sits on the board\'s front apron; in Street Dice and future games it appears on menus, loading screens and wherever the brand shows. '
        'The round-1 image above is the approved look, <b>with one change: the word reads "iPlay" and the play button is carved into the bowl of the P</b> (in the image the triangle replaced the P).')]
s += bullets([
    'A slim horizontal plate, about <b>4 to 1</b>, dark brushed gunmetal like the app icon, bevelled edges, a thin polished gold rim, a small brass screw at each end.',
    'The word <b>iPlay</b> (lowercase i, capital P, lowercase lay) in the centre: the i and the carved play button glow cyan; "lay" is brushed silver.',
    '<b>Waveform: option 2, the sound meter.</b> Thin vertical bars mirrored top and bottom on both sides of the word, glowing cyan near the word and fading to warm gold toward the ends. It will be rebuilt as an exact shape in code so it is identical in every game and can bounce with sound.',
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
    '<b>Lettering:</b> the only words that may appear are <b>iPLAY CORNHOLE</b> (title logo) and <b>iPlay</b> (nameplate), spelled exactly. No other text, and no words on the bags.',
    '<b>Textures:</b> square, the largest size available, PNG. Fabrics in neutral mid-gray (the game tints them into team colors).',
    '<b>Realism:</b> real materials, real scale, real wear. No cartoon, no illustration style, no plastic look.',
    '<b>Consistency:</b> the board, bags and plate must match sections 6 to 8 in every image.',
])

# ---------------- 10
s += [PageBreak(), P('10. The image list, one image at a time', 'h1')]
s += [prompt('How to deliver the images',
 '<b>ONE image per reply.</b> Never a collage, grid, contact sheet or several items in one picture. Every image is its own separate file at full resolution. '
 'Make only the image asked for, then stop. "next" means make the next one on the list; "redo" means make the same one again with the notes given. '
 'Images marked TEXTURE follow the texture rule in section 9.')]
import re as _re
_md = open(ROOT + '/docs/art-briefs/02-gpt-session-round2.md').read()
for _m in _re.finditer(r'^> \*\*(\d+)\. ([^*]+?)\*\* (.+)$', _md, _re.M):
    _txt = _re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', _m.group(3))
    s += [prompt(f'{_m.group(1)}. {_m.group(2).rstrip(".")}', _txt)]

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
    ['Title logo', 'iPLAY CORNHOLE graffiti metal lettering with the play button carved into the P (section 8). On the deck, splash, menus and store.'],
    ['Nameplate', 'iPlay with the play button carved into the P; sound-meter waveform (option 2).'],
    ['Bags', 'The regular iPlay mark only (no words); realistic flat tournament bags.'],
    ['Money', 'No wagers ever, nothing for sale; ads only, never during a match.'],
    ['Video tool', 'Kling for the plates and character clips (a side-by-side test with other tools first).'],
], [1.3 * inch, 5.6 * inch])]
s += [Spacer(1, 10), P('Already built (not part of image work): the game server, rules, ranked play, leaderboards, voice chat, the Unity game logic, sounds, and the LED light patterns. '
        'The images in section 10 are the next step: they turn the plain prototype into the real-looking game.', 'small')]

doc.build(s)
print(OUT)
