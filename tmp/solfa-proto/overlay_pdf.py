#!/usr/bin/env python3
"""annotations.json の階名を元の楽譜PDFに重ね書きし、印刷用PDFを出力する。

座標系: annotations.json は Audiveris が300dpiでラスタライズした画像のピクセル座標。
PDFポイントへは (ページ幅pt / 画像幅px) でスケール変換する。
"""
import json
import sys

import fitz  # PyMuPDF

IMG_W = 2480  # Audiveris 300dpi レンダリングの画像幅 (A4)
FONT_PX = 33  # 画像ピクセル基準のフォントサイズ (≒五線間隔の1.4倍)
COLOR_DIATONIC = (0.70, 0.16, 0.11)   # 幹音: 赤鉛筆
COLOR_CHROMATIC = (0.42, 0.13, 0.75)  # 半音変化: 紫


def main(pdf_path, ann_path, out_path):
    doc = fitz.open(pdf_path)
    anns = json.load(open(ann_path))
    font = fitz.Font('helvetica-bold')

    for a in anns:
        page = doc[a['sheet'] - 1]
        s = page.rect.width / IMG_W
        size = FONT_PX * s
        text = a['syll']
        # 中央揃え: 符頭中心 x にテキスト幅の半分を左へ
        tw = font.text_length(text, fontsize=size)
        x = a['x'] * s - tw / 2
        y = (a['y'] - 8) * s  # 符頭上端の少し上をベースラインに
        page.insert_text(
            (x, y), text, fontsize=size, fontname='hebo',
            color=COLOR_CHROMATIC if len(text) > 1 else COLOR_DIATONIC)

    doc.save(out_path, deflate=True)
    print(f'{len(anns)} annotations -> {out_path}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
