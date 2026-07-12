#!/usr/bin/env python3
"""annotations.json + BINARY.png から検証用HTMLデモを生成。"""
import base64
import json
import zipfile
from collections import Counter

SCRATCH = '/tmp/claude-1000/-workspace/abd51d9f-6cd3-4465-951c-f93455f0e282/scratchpad'
W, H = 2480, 3507

anns = json.load(open(f'{SCRATCH}/annotations.json'))
omr = zipfile.ZipFile(f'{SCRATCH}/omr_out/IMSLP19716.omr')

skipped = [
    ('1ページ', 'Cantus', '7–8, 13'), ('1ページ', 'Altus', '8'), ('1ページ', 'Tenor', '14'),
]
syl_count = Counter(a['syll'] for a in anns)
chromatic = {k: v for k, v in syl_count.items() if len(k) > 1}

pages_svg = []
for sheet in (1, 2, 3):
    png = base64.b64encode(omr.read(f'sheet#{sheet}/BINARY.png')).decode()
    labels = []
    for a in anns:
        if a['sheet'] != sheet:
            continue
        x = a['x']
        y = a['y'] - 8
        cls = ' class="chr"' if len(a['syll']) > 1 else ''
        labels.append(f'<text x="{x}" y="{y}"{cls}>{a["syll"]}</text>')
    n = sum(1 for a in anns if a['sheet'] == sheet)
    pages_svg.append(f'''
<section class="page-block">
  <div class="page-head"><span class="page-no">{sheet} ページ</span><span class="page-count">{n} 音に階名を付与</span></div>
  <div class="sheet">
    <svg viewBox="0 0 {W} {H}" role="img" aria-label="階名付き楽譜 {sheet}ページ目">
      <image href="data:image/png;base64,{png}" width="{W}" height="{H}"/>
      <g class="solfa">{''.join(labels)}</g>
    </svg>
  </div>
</section>''')

chrom_rows = ''.join(
    f'<tr><td class="syl">{k}</td><td>{ {"de":"ソ♯ ... G♯（doの半音上）","ta":"F♮（tiの半音下）","fe":"C♯（faの半音上）","se":"D♯（soの半音上）"}.get(k,"") }</td><td class="num">{v}</td></tr>'
    for k, v in sorted(chromatic.items(), key=lambda x: -x[1]))

html = f'''<title>階名オーバーレイ・プロトタイプ — O magnum mysterium</title>
<style>
:root {{
  --bg: #f6f5f2; --ink: #201d19; --muted: #6f6a61; --line: #dcd8d0;
  --card: #ffffff; --accent: #b3372e; --accent-soft: #f3e3e1;
}}
@media (prefers-color-scheme: dark) {{
  :root {{ --bg: #1a1917; --ink: #e9e6e0; --muted: #9b968c; --line: #38352f;
           --card: #232119; --accent: #d96a5f; --accent-soft: #3a2523; }}
}}
:root[data-theme="dark"] {{ --bg: #1a1917; --ink: #e9e6e0; --muted: #9b968c; --line: #38352f;
  --card: #232119; --accent: #d96a5f; --accent-soft: #3a2523; }}
:root[data-theme="light"] {{ --bg: #f6f5f2; --ink: #201d19; --muted: #6f6a61; --line: #dcd8d0;
  --card: #ffffff; --accent: #b3372e; --accent-soft: #f3e3e1; }}

body {{ background: var(--bg); color: var(--ink); margin: 0;
  font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
  line-height: 1.65; }}
main {{ max-width: 1080px; margin: 0 auto; padding: 40px 20px 80px; }}
h1 {{ font-family: "Iowan Old Style", Palatino, "Palatino Linotype", Georgia, serif;
  font-size: 1.9rem; margin: 0 0 4px; text-wrap: balance; }}
.sub {{ color: var(--muted); margin: 0 0 28px; }}
.eyebrow {{ text-transform: uppercase; letter-spacing: .12em; font-size: .72rem;
  color: var(--accent); font-weight: 600; margin-bottom: 10px; }}

.stats {{ display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 14px; }}
.stat {{ background: var(--card); border: 1px solid var(--line); border-radius: 6px;
  padding: 12px 18px; flex: 1 1 150px; }}
.stat b {{ display: block; font-size: 1.5rem; font-variant-numeric: tabular-nums; }}
.stat span {{ color: var(--muted); font-size: .8rem; }}
.note {{ background: var(--accent-soft); border-radius: 6px; padding: 12px 16px;
  font-size: .88rem; margin: 0 0 34px; }}
.note b {{ color: var(--accent); }}

.cols {{ display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 40px; }}
@media (max-width: 700px) {{ .cols {{ grid-template-columns: 1fr; }} }}
.panel {{ background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 14px 18px; }}
.panel h2 {{ font-size: .95rem; margin: 0 0 8px; }}
.panel table {{ border-collapse: collapse; width: 100%; font-size: .85rem; }}
.panel td {{ padding: 3px 6px; border-top: 1px solid var(--line); }}
.panel .syl {{ color: var(--accent); font-weight: 700; }}
.panel .num {{ text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }}

.page-block {{ margin-bottom: 44px; }}
.page-head {{ display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }}
.page-no {{ font-weight: 600; }}
.page-count {{ color: var(--muted); font-size: .85rem; font-variant-numeric: tabular-nums; }}
.sheet {{ background: #fff; border: 1px solid var(--line); border-radius: 4px;
  box-shadow: 0 1px 6px rgba(0,0,0,.08); overflow: hidden; }}
.sheet svg {{ display: block; width: 100%; height: auto; }}
.solfa text {{ fill: #b3372e; font-family: Verdana, "DejaVu Sans", sans-serif;
  font-size: 33px; font-weight: 700; text-anchor: middle; }}
.solfa text.chr {{ fill: #8e2de2; }}
footer {{ color: var(--muted); font-size: .8rem; border-top: 1px solid var(--line); padding-top: 14px; }}
</style>
<main>
<div class="eyebrow">プロトタイプ検証</div>
<h1>移動ド階名の自動付与 — O magnum mysterium (Victoria)</h1>
<p class="sub">スキャンPDF → Audiveris (OMR) → 階名計算 → 元の版面へオーバーレイ。La基準・Tonic sol-fa 略記、do = G（調号 ♯1）。<span style="color:#b3372e;font-weight:700">赤 = 幹音</span>・<span style="color:#8e2de2;font-weight:700">紫 = 半音変化</span></p>

<div class="stats">
  <div class="stat"><b>{len(anns)}</b><span>階名を付与した音符</span></div>
  <div class="stat"><b>0 / 784</b><span>音高照合ミスマッチ（.omr座標 × MusicXML）</span></div>
  <div class="stat"><b>5</b><span>音符数不一致でスキップした小節</span></div>
</div>

<div class="note"><b>既知の欠落:</b> 1ページ目の第1システムはインチピット（左端の原典記譜）の影響で4本の独立した譜表として誤認識され、別楽章として復元処理した。スキップした小節: Cantus 7–8・13、Altus 8、Tenor 14（連桁内の音符数が MusicXML と不一致）。これらの音符には階名が付いていない。</div>

<div class="cols">
  <div class="panel">
    <h2>半音変化の階名（出現数）</h2>
    <table>{chrom_rows}</table>
  </div>
  <div class="panel">
    <h2>読み方</h2>
    <table>
      <tr><td class="syl">d r m f s l t</td><td>幹音（do = G、主音 A は「l」…La基準）</td></tr>
      <tr><td class="syl">〜e</td><td>半音上げ（de, re, fe, se, le）</td></tr>
      <tr><td class="syl">〜a</td><td>半音下げ（ra, ma, la, ta）</td></tr>
    </table>
  </div>
</div>

{''.join(pages_svg)}

<footer>楽譜: Tomás Luis de Victoria «O magnum mysterium», ed. Nancho Alvarez (IMSLP #19716, パブリックドメイン) ・ 画像は Audiveris の二値化出力 ・ 2026-07-12</footer>
</main>
'''
open(f'{SCRATCH}/solfa_demo.html', 'w').write(html)
print('written', len(html), 'bytes')
