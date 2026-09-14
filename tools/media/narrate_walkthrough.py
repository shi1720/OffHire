"""Add disclosed local speech and captions to OffHire's 120-second picture track.
Requires macOS `say` / `afinfo` and FFmpeg. No network requests or phone calls.
"""
from pathlib import Path
import argparse
import json
import math
import re
import subprocess
import textwrap

SCENES = [
    (14, "Off Hire, built by Shivam Gupta, helps contractors close equipment rentals. These actual app screens use synthetic rehearsals. A pickup booking can leave one question unanswered: when does billing end?"),
    (16, "For this scissor lift, the operator reviews the asset, contract and call questions first. The plan asks for a billing cutoff, timezone and reference, then collection separately. Rehearsal mode runs fictional answers without dialing a phone."),
    (18, "The receipt records a September fourteenth, three P M Central cutoff and an off-rent reference. Pickup is tomorrow, eight until noon. The supplier's words remain visible, while official written confirmation is still pending. These are different pieces of evidence."),
    (22, "Now the telehandler. Pickup is booked for eight until noon, but dispatch has not confirmed billing. It stays open. Six scenarios cover confirmation, ambiguity, voicemail, a later correction, unsupported evidence and the wrong asset. A completed call does not automatically become a completed closeout."),
    (17, "If the invoice runs beyond the reported cutoff, Off Hire flags it for finance review. Contract terms can explain the difference. This is a review flag, not proof of an overcharge, a refund or a saving."),
    (15, "A person records physical collection, written confirmation and invoice review separately. Here, the sample site update records a fictional collection. It documents a human observation; it does not change the supplier's billing system."),
    (18, "The ledger keeps four states visible and exports the evidence. Call E is integrated; a real authorized call still needs verification. The proposed pilot is ninety-nine dollars monthly, plus usage. The job is finished. Is the rental?"),
]


def run(args):
    p = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(p.stderr[-5000:] or p.stdout[-5000:])
    return p


def duration(path):
    result = run(['/usr/bin/afinfo', path])
    return float(re.search(r'estimated duration: ([0-9.]+) sec', result.stdout)[1])


def timestamp(seconds):
    ms = round(seconds * 1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True, help='Existing 120-second silent walkthrough MP4')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    parser.add_argument('--voice', default='Samantha', help='Installed macOS voice; never a cloned voice')
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = args.ffmpeg.resolve()
    manifest, clips, captions = [], [], []
    elapsed = 0
    for index, (length, text) in enumerate(SCENES, 1):
        script = args.work / f'{index:02}.txt'
        script.write_text(text)
        spoken = args.work / f'{index:02}.aiff'
        rate = 150
        for attempt in range(4):
            run(['/usr/bin/say', '-v', args.voice, '-r', rate, '-f', script, '-o', spoken])
            seconds = duration(spoken)
            if seconds <= length - 0.8:
                break
            rate = math.ceil(rate * seconds / (length - 0.8)) + 2
        if seconds > length - 0.8:
            raise RuntimeError(f'Scene {index} narration exceeds its picture timing; shorten its script')
        padded = args.work / f'{index:02}.wav'
        run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', spoken,
             '-af', f'aresample=48000,adelay=350,apad,atrim=duration={length}',
             '-ac', '1', '-c:a', 'pcm_s16le', padded])
        clips.append(padded.resolve())
        manifest.append(dict(scene=index, start=elapsed, end=elapsed+length, text=text,
                             voice=args.voice, words_per_minute=rate, spoken_seconds=seconds))
        # Readable two-line optional subtitles; timing follows each synthesized
        # chapter proportionally. This is an editorial caption track, not ASR.
        lines = textwrap.wrap(text.replace('Off Hire', 'OffHire').replace('Call E', 'CALL-E').replace('P M', 'PM'),
                              width=40, break_long_words=False, break_on_hyphens=False)
        chunks = [lines[i:i+2] for i in range(0, len(lines), 2)]
        weight = sum(len(' '.join(c)) for c in chunks)
        offset = elapsed + 0.35
        for chunk in chunks:
            end = offset + seconds * len(' '.join(chunk)) / weight
            captions.append(f'{len(captions)+1}\n{timestamp(offset)} --> {timestamp(end)}\n' + '\n'.join(chunk) + '\n')
            offset = end
        elapsed += length
    concat = args.work / 'audio-concat.txt'
    # Refuse paths that cannot be represented safely in the FFmpeg concat file.
    if any("'" in str(p) or '\n' in str(p) for p in clips):
        raise ValueError('Choose a work directory without apostrophes or newlines')
    concat.write_text(''.join(f"file '{p}'\n" for p in clips))
    wav = args.work / 'narration.wav'
    run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat,
         '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
    srt = args.output.with_suffix('.srt')
    srt.write_text('\n'.join(captions))
    # The existing video discloses synthetic rehearsals throughout. This label
    # identifies the narrator and does not cover the captured application.
    label = args.work / 'voice-label.txt'
    label.write_text('GENERATED\nNARRATION')
    label_path = str(label.resolve())
    if any(c in label_path for c in ["'", ':', '\n']):
        raise ValueError('Choose a work directory safe for FFmpeg filter paths')
    filters = "drawtext=fontfile='/System/Library/Fonts/Supplemental/Arial.ttf':" + \
              f"textfile='{label_path}':expansion=none:fontsize=20:line_spacing=6:fontcolor=0xBECAD2:x=48:y=92"
    run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', args.input, '-i', wav, '-i', srt,
         '-map', '0:v:0', '-map', '1:a:0', '-map', '2:s:0', '-vf', filters,
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
         '-metadata:s:s:0', 'title=English narration', '-t', str(elapsed), '-movflags', '+faststart',
         '-map_metadata', '-1', '-metadata', 'title=OffHire narrated walkthrough — synthetic rehearsal',
         '-metadata', 'comment=Generated macOS narrator. Actual app screenshots with synthetic scenarios. No live CALL-E call is shown or claimed.',
         args.output])
    run([ffmpeg, '-v', 'error', '-i', args.output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'])
    (args.work/'manifest.json').write_text(json.dumps(dict(duration=elapsed, voice=args.voice,
        generated_narration=True, no_live_call=True, scenes=manifest), indent=2))
    print(json.dumps(dict(output=str(args.output), duration=elapsed, scenes=len(manifest),
                          rates=[s['words_per_minute'] for s in manifest], decode='passed')))


if __name__ == '__main__':
    main()
