#!/usr/bin/env python3
"""合唱譜PDFへの移動ド階名自動付与 — プロトタイプ解析部。

入力: Audiveris の出力 (MusicXML .mxl + .omr)
出力: annotations.json — 各音符の {sheet, x, y, syllable} (元画像ピクセル座標)

階名: La基準の移動ド、Tonic sol-fa 略記
  幹音: d r m f s l t / 半音上げ: 母音e (de, re, fe, se, le) / 半音下げ: 母音a (ra, ma, sa, la, ta)
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict

SCRATCH = '/tmp/claude-1000/-workspace/abd51d9f-6cd3-4465-951c-f93455f0e282/scratchpad'
OMR_PATH = f'{SCRATCH}/omr_out/IMSLP19716.omr'
MXL_PATH = f'{SCRATCH}/omr_out/IMSLP19716.mvt2.mxl'

LETTERS = 'CDEFGAB'
BASE_SYLL = ['d', 'r', 'm', 'f', 's', 'l', 't']
SHARP_ORDER = 'FCGDAEB'   # 調号の♯が付く順
FLAT_ORDER = 'BEADGCF'    # 調号の♭が付く順


def do_letter_index(fifths: int) -> int:
    """調号 fifths から長調主音(=do)の幹音インデックス (C=0..B=6)。"""
    return (4 * fifths) % 7


def key_alter(letter: str, fifths: int) -> int:
    """調号下での幹音 letter のダイアトニックな変位 (+1/0/-1)。"""
    if fifths > 0 and letter in SHARP_ORDER[:fifths]:
        return 1
    if fifths < 0 and letter in FLAT_ORDER[:-fifths]:
        return -1
    return 0


def syllable(step: str, alter: int, fifths: int) -> str:
    """音名(step, alter) を調号 fifths のLa基準移動ドで Tonic sol-fa 略記に変換。"""
    degree = (LETTERS.index(step) - do_letter_index(fifths)) % 7
    base = BASE_SYLL[degree]
    delta = alter - key_alter(step, fifths)
    if delta == 0:
        return base
    if delta == 1:
        return base + 'e'   # 半音上げ: de re me fe se le te
    if delta == -1:
        return base + 'a'   # 半音下げ: da ra ma fa sa la ta
    return base + ('+' * delta if delta > 0 else '-' * (-delta))


# ---------------------------------------------------------------- MusicXML 側
def parse_musicxml(path):
    """part id → 小節ごとの音符列 [(step, alter, octave, syllable)]。休符は除外。"""
    z = zipfile.ZipFile(path)
    xml_name = [n for n in z.namelist() if n.endswith('.xml') and 'META' not in n][0]
    root = ET.fromstring(z.read(xml_name))
    parts = {}
    fifths = 0
    for part in root.iter('part'):
        measures = []
        for meas in part.findall('measure'):
            f = meas.find('.//key/fifths')
            if f is not None:
                fifths = int(f.text)
            notes = []
            for note in meas.findall('note'):
                if note.find('rest') is not None or note.find('pitch') is None:
                    continue
                step = note.findtext('pitch/step')
                alter = int(float(note.findtext('pitch/alter') or 0))
                octave = int(note.findtext('pitch/octave'))
                is_chord = note.find('chord') is not None
                notes.append(dict(step=step, alter=alter, octave=octave,
                                  chord=is_chord, syll=syllable(step, alter, fifths)))
            measures.append(notes)
        parts[part.get('id')] = measures
    return parts, fifths


# ---------------------------------------------------------------- .omr 側
CLEF_MIDDLE = {           # 音部記号 → 譜表中線の (幹音idx, octave)
    'TREBLE': (6, 4),         # B4
    'G_CLEF': (6, 4),
    'TREBLE_DOWN_8': (6, 3),  # オクターブ下ト音記号 → B3
    'BASS': (1, 3),           # D3
    'F_CLEF': (1, 3),
    'ALTO': (0, 4),           # C4
    'TENOR': (5, 3),          # A3
}


def parse_movements(omr_path):
    """book.xml から (sheet番号, ページ順序, movement開始フラグ) の列を得る。"""
    z = zipfile.ZipFile(omr_path)
    book = ET.fromstring(z.read('book.xml'))
    pages = []  # (sheet_no, page_index_within_sheet, movement_start)
    for sheet in book.findall('sheet'):
        sn = int(sheet.get('number'))
        for i, page in enumerate(sheet.findall('page')):
            pages.append((sn, i, page.get('movement-start') == 'true'))
    # movement ごとに分割 (最初のページは暗黙に movement 1 の開始)
    movements = []
    for entry in pages:
        if entry[2] or not movements:
            movements.append([])
        movements[-1].append((entry[0], entry[1]))
    return movements


def parse_omr(path):
    """(sheet番号, ページ順序) → システム列。part id (=logical part) 付き。"""
    z = zipfile.ZipFile(path)
    pages = {}
    for name in sorted(n for n in z.namelist() if re.match(r'sheet#\d+/sheet#\d+\.xml', n)):
        sheet_no = int(re.search(r'#(\d+)', name).group(1))
        root = ET.fromstring(z.read(name))
        for page_idx, page in enumerate(root.findall('page')):
            systems = []
            for system in page.findall('system'):
                stacks = [(int(st.get('left')), int(st.get('right')))
                          for st in system.findall('stack')]
                staff_clef = {}
                heads_by_staff = defaultdict(list)
                for inter in system.iter():
                    if inter.tag == 'clef':
                        sid = inter.get('staff')
                        if sid not in staff_clef:
                            staff_clef[sid] = inter.get('kind')
                    elif inter.tag == 'head':
                        b = inter.find('bounds')
                        if b is None:
                            continue
                        heads_by_staff[inter.get('staff')].append(dict(
                            pitch=int(inter.get('pitch')),
                            x=int(b.get('x')), y=int(b.get('y')),
                            w=int(b.get('w')), h=int(b.get('h'))))
                staves = []  # (logical part id, staff情報)
                for part in system.findall('part'):
                    pid = part.get('id')
                    for staff in part.findall('staff'):
                        sid = staff.get('id')
                        staves.append(dict(part=f'P{pid}', id=sid,
                                           clef=staff_clef.get(sid),
                                           heads=sorted(heads_by_staff.get(sid, []),
                                                        key=lambda h: h['x'])))
                systems.append(dict(stacks=stacks, staves=staves))
            pages[(sheet_no, page_idx)] = systems
    return pages


def head_step_octave(head_pitch: int, clef_kind: str):
    """Audiveris の譜表位置(中線=0, 下向き正)から幹音を逆算。"""
    if clef_kind not in CLEF_MIDDLE:
        return None
    mid_idx, mid_oct = CLEF_MIDDLE[clef_kind]
    # 位置は下向きに正 → 音高は逆方向
    abs_idx = (mid_oct * 7 + mid_idx) - head_pitch
    return LETTERS[abs_idx % 7], abs_idx // 7


# ---------------------------------------------------------------- 突き合わせ
def process_movement(mxl_path, target_pages, pages, annotations, report):
    parts, fifths = parse_musicxml(mxl_path)
    measure_cursor = 0  # movement 内の小節番号 (0-based)

    for page_key in target_pages:
        for system in pages[page_key]:
            stacks = system['stacks']
            for staff in system['staves']:
                part_id = staff['part']
                if part_id not in parts:
                    continue
                heads = staff['heads']
                for mi, (left, right) in enumerate(stacks):
                    gm = measure_cursor + mi
                    if gm >= len(parts[part_id]):
                        continue
                    mxl_notes = parts[part_id][gm]
                    m_heads = [h for h in heads if left <= h['x'] + h['w'] / 2 < right]
                    if len(m_heads) != len(mxl_notes):
                        report['mismatched_measures'].append(
                            dict(sheet=page_key[0], part=part_id, measure=gm + 1,
                                 omr=len(m_heads), mxl=len(mxl_notes)))
                        continue
                    for h, n in zip(m_heads, mxl_notes):
                        # サニティチェック: 譜表位置から逆算した幹音と一致するか
                        so = head_step_octave(h['pitch'], staff['clef'])
                        report['checked'] += 1
                        if so is not None and so[0] != n['step']:
                            report['step_mismatch'] += 1
                        annotations.append(dict(
                            sheet=page_key[0], part=part_id, measure=gm + 1,
                            x=h['x'] + h['w'] // 2, y=h['y'], w=h['w'], h=h['h'],
                            step=n['step'], alter=n['alter'], octave=n['octave'],
                            syll=n['syll']))
                        report['matched'] += 1
            measure_cursor += len(stacks)
    print(f"{mxl_path.split('/')[-1]}: key fifths = {fifths}"
          f"  (do = {LETTERS[do_letter_index(fifths)]})")


def main():
    pages = parse_omr(OMR_PATH)
    movements = parse_movements(OMR_PATH)
    annotations = []
    report = dict(matched=0, mismatched_measures=[], step_mismatch=0, checked=0)

    # mvt1 = 分解された第1システム (Cantus/Altus/Tenor m1-7), mvt2 = 本体
    process_movement(f'{SCRATCH}/omr_out/IMSLP19716.mvt1.mxl', movements[0],
                     pages, annotations, report)
    process_movement(MXL_PATH, movements[1], pages, annotations, report)

    with open(f'{SCRATCH}/annotations.json', 'w') as f:
        json.dump(annotations, f, ensure_ascii=False, indent=1)

    print(f"matched notes: {report['matched']}")
    print(f"step cross-check: {report['checked']} checked, {report['step_mismatch']} mismatches")
    print(f"mismatched measures: {len(report['mismatched_measures'])}")
    for mm in report['mismatched_measures'][:10]:
        print('  ', mm)


if __name__ == '__main__':
    main()
