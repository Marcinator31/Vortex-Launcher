#!/usr/bin/env python3
"""
Wallpaper-Nachbearbeitung: echte Minecraft-Aufnahmen (2560x1440) bekommen
einen weichen "Film-Look" -- etwas Kontrast und Farbe, warmer Schein in den
hellen Stellen (Bloom), leichte Vignette, feines Nachschaerfen.

  python3 grade.py ein.png aus.jpg [--warm 0.06] [--bloom 0.22]
  python3 grade.py --panorama ordner_mit_panorama_0..5.png zielordner 1280

Nur Pillow + numpy.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance


def grade(im, warm=0.05, bloom=0.22, vignette=0.28, contrast=1.08, saturation=1.12):
    im = im.convert('RGB')
    w, h = im.size
    # Bloom: helle Stellen weich ausstrahlen lassen
    a = np.asarray(im).astype(np.float32) / 255.0
    lum = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    mask = np.clip((lum - 0.62) / 0.38, 0, 1)[..., None]
    hi = Image.fromarray((np.clip(a * mask, 0, 1) * 255).astype(np.uint8))
    glow = hi.filter(ImageFilter.GaussianBlur(radius=max(w, h) / 90))
    g = np.asarray(glow).astype(np.float32) / 255.0
    a = 1 - (1 - a) * (1 - g * bloom)          # "Screen"-Mischung
    # Kontrast (weiche S-Kurve um die Mitte)
    a = np.clip(0.5 + (a - 0.5) * contrast, 0, 1)
    # Waerme: Rot/Gruen leicht hoch, Blau leicht runter -- vor allem in Mitten/Lichtern
    tone = np.clip(lum[..., None] * 1.2, 0, 1)
    a[..., 0] += warm * 0.9 * tone[..., 0]
    a[..., 1] += warm * 0.35 * tone[..., 0]
    a[..., 2] -= warm * 0.6 * tone[..., 0]
    a = np.clip(a, 0, 1)
    # Vignette
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
    v = 1 - vignette * np.clip((d - 0.35) / 0.65, 0, 1) ** 1.6
    a = a * v[..., None]
    out = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    out = ImageEnhance.Color(out).enhance(saturation)
    out = out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=45, threshold=2))
    return out


def main():
    args = sys.argv[1:]
    if args and args[0] == '--panorama':
        src, dst, size = args[1], args[2], int(args[3]) if len(args) > 3 else 1280
        import os
        os.makedirs(dst, exist_ok=True)
        for i in range(6):
            im = Image.open(f'{src}/panorama_{i}.png').convert('RGB').resize((size, size), Image.LANCZOS)
            # Panorama: nur Farbe/Kontrast, ohne Vignette (Seiten stossen aneinander)
            grade(im, bloom=0.15, vignette=0.0).save(f'{dst}/panorama_{i}.jpg', quality=86, optimize=True, progressive=True)
        return
    src, dst = args[0], args[1]
    kw = {}
    for i, a in enumerate(args):
        if a.startswith('--') and i + 1 < len(args):
            kw[a[2:]] = float(args[i + 1])
    grade(Image.open(src), **kw).save(dst, quality=87, optimize=True, progressive=True)


if __name__ == '__main__':
    main()
