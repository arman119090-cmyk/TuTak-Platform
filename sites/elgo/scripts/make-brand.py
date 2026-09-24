"""
Генерирует текстовый логотип ElGo (Cormorant Garamond 600) в виде SVG-контуров,
favicon и OG-изображение. Контуры — чтобы картинки не зависели от шрифтов
системы, где их откроют.

Временный логотип: BRIEF.md, п. 13 — «иначе текстовый логотип ElGo в
Cormorant Garamond». Когда придёт векторный логотип заказчика — заменить
public/logo.svg и перегенерировать PNG.

Запуск: pip install fonttools brotli && python3 scripts/make-brand.py && node scripts/make-brand-png.mjs
"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FS = ROOT / "node_modules" / "@fontsource"
PUB = ROOT / "public"
BUILD = ROOT / "scripts" / ".brand"
BUILD.mkdir(exist_ok=True)

GRAPHITE, STONE, BRASS, MUTED_DARK = "#16161A", "#F2EFEA", "#B8925A", "#CFC9BE"


def text_path(font_file, text, size, x, y, tracking=0.0):
    """Контур строки: базовая линия в (x, y), size — кегль в px."""
    font = TTFont(font_file)
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    hmtx = font["hmtx"]
    kern = {}
    upm = font["head"].unitsPerEm
    scale = size / upm
    d_all = []
    cursor = 0.0
    for ch in text:
        gname = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        tpen = TransformPen(pen, (scale, 0, 0, -scale, x + cursor, y))
        gs[gname].draw(tpen)
        d_all.append(pen.getCommands())
        cursor += hmtx[gname][0] * scale + tracking
    return " ".join(d_all), cursor - tracking


corm = FS / "cormorant-garamond" / "files" / "cormorant-garamond-latin-600-normal.woff2"
onest = FS / "onest" / "files" / "onest-latin-500-normal.woff2"

# 1. Логотип (тёмный текст на прозрачном — для светлых фонов) и светлый вариант.
d, w = text_path(corm, "ElGo", 100, 0, 80)
for name, color in (("logo.svg", GRAPHITE), ("logo-light.svg", STONE)):
    (PUB / name).write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} 104" width="{w:.0f}" height="104">'
        f'<title>ElGo</title><path fill="{color}" d="{d}"/></svg>\n'
    )

# 2. Favicon: заглавная E латунью на графите. На 16–32 px слово «ElGo» не читается.
d, w = text_path(corm, "E", 30, 0, 0)
fx = (32 - w) / 2
d, _ = text_path(corm, "E", 30, fx, 26)
(PUB / "favicon.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    f'<rect width="32" height="32" fill="{GRAPHITE}"/><path fill="{BRASS}" d="{d}"/></svg>\n'
)
d, w = text_path(corm, "E", 150, 0, 0)
d, _ = text_path(corm, "E", 150, (180 - w) / 2, 128)
(BUILD / "apple-touch-icon.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">'
    f'<rect width="180" height="180" fill="{GRAPHITE}"/><path fill="{BRASS}" d="{d}"/></svg>\n'
)

# 3. OG 1200×630: графит, слово ElGo, тонкая латунная линия, подпись.
logo_d, logo_w = text_path(corm, "ElGo", 220, 96, 330)
sub_d, _ = text_path(onest, "CONSTRUCTION  ·  YEREVAN, ARMENIA", 22, 100, 470, tracking=4)
(BUILD / "og.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">'
    f'<rect width="1200" height="630" fill="{GRAPHITE}"/>'
    f'<path fill="{STONE}" d="{logo_d}"/>'
    f'<rect x="100" y="400" width="120" height="2" fill="{BRASS}"/>'
    f'<path fill="{MUTED_DARK}" d="{sub_d}"/>'
    f'<rect x="0" y="622" width="1200" height="8" fill="{BRASS}"/>'
    f'</svg>\n'
)
# 4. Квадратный логотип для schema.org.
d, w = text_path(corm, "ElGo", 150, 0, 0)
d, _ = text_path(corm, "ElGo", 150, (512 - w) / 2, 300)
(BUILD / "logo-square.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">'
    f'<rect width="512" height="512" fill="{GRAPHITE}"/><path fill="{STONE}" d="{d}"/></svg>\n'
)
print("ok")
