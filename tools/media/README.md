# Reproduce the OffHire rehearsal video

The seven PNGs in `screens/` are actual 1440×1000 captures of the deployed application using fictional rental records. They contain no live CALL-E results. The compositor preserves the app pixels and adds framing, editorial labels and a persistent synthetic-rehearsal disclosure. The narrator uses an installed system voice, never Shivam's identity or a simulated supplier recording.

Requirements: Python 3, FFmpeg with `drawtext` and H.264/AAC support. Narration also requires macOS `say` and `afinfo`. The compositor's font defaults are macOS Arial; override `--font` and `--bold-font` on other platforms. Supply an existing FFmpeg executable; the scripts do not download dependencies, access accounts or make phone calls.

Run from the repository root, replacing the FFmpeg path:

```sh
python3 tools/media/build_walkthrough.py \
  --output outputs/OffHire-Walkthrough-Silent.mp4 \
  --work work/video --ffmpeg /path/to/ffmpeg

python3 tools/media/narrate_walkthrough.py \
  --input outputs/OffHire-Walkthrough-Silent.mp4 \
  --output outputs/OffHire-Narrated-Rehearsal.mp4 \
  --work work/narration --ffmpeg /path/to/ffmpeg
```

Both videos run 120 seconds at 1920×1080. The narrator defaults to Samantha, credits Shivam Gupta as builder, and states that real authorized CALL-E verification remains outstanding. Choose another installed voice with `--voice`. The MP4 includes an optional English subtitle track; an editable SRT is exported alongside it. Caption timing is proportional within each chapter, not speech recognition alignment.

Each script writes a manifest and checks that its completed media decodes. Narration checks speech duration before padding each chapter and targets −16 LUFS / −1.5 dBTP. Watch and listen through the complete output before public upload. Original exported narration has passed technical decoding, level and visual checks; listening quality has not been independently reviewed.

For Shivam's own recording, use [the timed voiceover](../../docs/walkthrough-assembly.md). For an actual authorized phone test and honest conditional narration, use [the recording guide](../../docs/video-script.md). These videos demonstrate rehearsal behavior and cannot establish that a real phone call worked.
