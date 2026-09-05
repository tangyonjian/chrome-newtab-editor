# -*- coding: utf-8 -*-
"""
生成扩展图标：暗色圆角底 + 白色字母 T。

字体策略（图标设计标准做法：不同尺寸用不同字重）：
  - 大图标（48/128）：Georgia regular 细体，衬线优雅。
  - 小图标（16/32）：Georgia bold，因为小尺寸下细体笔画不足 1px，
    抗锯齿后会被稀释成灰色；加粗才能保证实心的纯白笔画。

依赖 Pillow（仅「重新生成图标」这个开发操作需要；扩展运行时只加载 PNG，零依赖）。
用法：python generate-icons.py

自定义：
  BG          背景色（RGBA）
  FG          字母颜色（RGBA）
  TEXT        要显示的字母
  FONT_RATIOS 各尺寸的字号占比
  SMALL_BOLD_THRESHOLD 小于等于该尺寸用 bold（默认 32）
"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(BASE, "icons")

BG = (43, 43, 43, 255)       # 暗灰底 #2B2B2B
FG = (255, 255, 255, 255)    # 纯白字母

TEXT = "T"

# 字体候选（regular / bold 两组，按优先级取第一个存在的）
FONT_CANDIDATES = {
    "regular": [
        r"C:\Windows\Fonts\georgia.ttf",     # 衬线，最优雅
        r"C:\Windows\Fonts\times.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
    ],
    "bold": [
        r"C:\Windows\Fonts\georgiab.ttf",    # Georgia Bold
        r"C:\Windows\Fonts\timesbd.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf",
    ],
}

# 各尺寸的字号占图标高度比例
FONT_RATIOS = {
    16: 0.68,
    32: 0.60,
    48: 0.58,
    128: 0.56,
}
DEFAULT_FONT_RATIO = 0.56

# 小于等于该尺寸的图标使用 bold 字重（保证小尺寸下白色笔画清晰）
SMALL_BOLD_THRESHOLD = 32

CORNER_RATIO = 0.20         # 圆角半径 / 图标尺寸


def resolve_font(weight):
    for p in FONT_CANDIDATES[weight]:
        if os.path.exists(p):
            return p
    raise FileNotFoundError("未找到可用字体，请检查 C:\\Windows\\Fonts")


def make_icon(size, out_path):
    bold = size <= SMALL_BOLD_THRESHOLD
    font_path = resolve_font("bold" if bold else "regular")

    # 小图标用更高超采样，改善缩略后的抗锯齿
    supersample = 8 if size <= 16 else 4
    big = size * supersample

    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 圆角底
    radius = int(big * CORNER_RATIO)
    draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=BG)

    # 居中渲染字母（用 textbbox 精确包围盒居中，避免视觉偏移）
    ratio = FONT_RATIOS.get(size, DEFAULT_FONT_RATIO)
    font = ImageFont.truetype(font_path, int(big * ratio))
    bbox = draw.textbbox((0, 0), TEXT, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (big - tw) / 2 - bbox[0]
    y = (big - th) / 2 - bbox[1]
    draw.text((x, y), TEXT, font=font, fill=FG)

    # 缩回目标尺寸
    img = img.resize((size, size), Image.LANCZOS)
    img.save(out_path)
    return "bold" if bold else "regular"


if __name__ == "__main__":
    os.makedirs(ICONS, exist_ok=True)
    for s in (16, 32, 48, 128):
        p = os.path.join(ICONS, "icon-%d.png" % s)
        w = make_icon(s, p)
        print("generated", p, "(%s)" % w)
    print("done")
