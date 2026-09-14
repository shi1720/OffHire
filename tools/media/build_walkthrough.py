"""Compose seven actual OffHire captures into a disclosed 120-second rehearsal.

Requires FFmpeg with drawtext. Uses installed macOS Arial fonts by default.
No screenshot contents are invented, and no network requests or calls are made.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess

SCENES = [
    ('01-desk', 14, 'The closeout desk: entered rates, not savings'),
    ('02-plan', 16, 'Review the exact asset and the questions before a call'),
    ('03-receipt', 18, 'Capture the billing cutoff and the supplier’s words'),
    ('04-ambiguous', 22, 'Pickup is booked. Billing is still unconfirmed.'),
    ('05-invoice', 17, 'Flag an invoice date difference for finance review'),
    ('06-followthrough', 15, 'Record collection as a separate human observation'),
    ('07-ledger', 18, 'One ledger. Four separate completion states.'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--screens', type=Path, default=Path(__file__).parent / 'screens')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    parser.add_argument('--font', type=Path, default='/System/Library/Fonts/Supplemental/Arial.ttf')
    parser.add_argument('--bold-font', type=Path, default='/System/Library/Fonts/Supplemental/Arial Bold.ttf')
    args = parser.parse_args()
    args.work = args.work.resolve()
    args.work.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for path in [args.work, args.font, args.bold_font]:
        if any(c in str(path) for c in ["'", ':', '\n']):
            raise ValueError('Work and font paths must be safe for FFmpeg filters')

    def run(command, log):
        result = subprocess.run([str(args.ffmpeg.resolve()), '-hide_banner', '-y', *map(str, command)],
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (args.work / log).write_text(result.stdout)
        if result.returncode:
            raise RuntimeError(result.stdout[-4000:])

    def text_filter(name, value, size, x, y, color='white', bold=False):
        path = args.work / f'{name}.txt'
        path.write_text(value)
        font = args.bold_font if bold else args.font
        return f"drawtext=fontfile='{font}':textfile='{path}':expansion=none:fontsize={size}:fontcolor={color}:x={x}:y={y}"

    header = text_filter('header', 'OffHire  /  Screenshot walkthrough', 26, 48, 20, bold=True)
    disclosure = text_filter('disclosure', 'SYNTHETIC REHEARSAL · ACTUAL APP SCREENS', 22, 'w-tw-48', 23, '0xF6CAA8')
    concat, manifest, elapsed = [], [], 0
    for index, (name, duration, caption) in enumerate(SCENES, 1):
        source = args.screens / f'{name}.png'
        target = args.work / f'{name}-composed.png'
        filters = [
            'scale=1382:960:flags=lanczos', 'setsar=1',
            'pad=1920:1080:269:64:color=0x142733', header, disclosure,
            text_filter(f'{name}-number', f'{index:02} / 07', 24, 48, 1038, '0xED5727', True),
            text_filter(f'{name}-caption', caption, 26, 269, 1037),
        ]
        run(['-i', source, '-vf', ','.join(filters), '-frames:v', '1', '-update', '1', target], f'{name}-compose.log')
        concat.extend([f"file '{target}'", f'duration {duration}'])
        manifest.append(dict(source=source.name, start=elapsed, end=elapsed+duration,
                             caption=caption, sha256=hashlib.sha256(source.read_bytes()).hexdigest()))
        elapsed += duration
    concat.append(f"file '{target}'")
    (args.work / 'frames.txt').write_text('\n'.join(concat) + '\n')
    (args.work / 'manifest.json').write_text(json.dumps(dict(duration=elapsed, resolution='1920x1080', fps=25, sources=manifest), indent=2))
    run(['-f', 'concat', '-safe', '0', '-i', args.work / 'frames.txt', '-vf', 'fps=25,format=yuv420p',
         '-t', elapsed, '-an', '-c:v', 'libx264', '-preset', 'medium', '-tune', 'stillimage', '-crf', '18',
         '-movflags', '+faststart', '-map_metadata', '-1',
         '-metadata', 'title=OffHire screenshot walkthrough — synthetic rehearsal',
         '-metadata', 'comment=Actual application screenshots. Synthetic rental data and rehearsal outcomes. No live phone call shown. Silent editorial walkthrough, not a screen recording.',
         args.output], 'encode.log')
    run(['-v', 'error', '-i', args.output, '-f', 'null', '-'], 'decode.log')
    print(json.dumps(dict(output=str(args.output), duration=elapsed, decode='passed')))


if __name__ == '__main__':
    main()
