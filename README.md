# Free Playlist Finder v0.2

A shareable browser tool that reads a public NetEase Cloud Music playlist and searches the same catalogue for free-playable entries that appear to be the same recording.

## What it does
- Public playlist URL/ID input; no password/Cookie collection.
- Reads the full playlist using trackIds + batched song detail.
- Leaves already-free tracks unchanged.
- For restricted tracks, searches title + artist and checks candidate privileges.
- Conservative automatic matching using title, artist and duration.
- Copies a resulting text playlist or exports CSV.
- It does **not** fetch, proxy, decrypt, download, or unlock paid audio.

## Run locally
Requires Node.js 18+.

    npm start

Open http://localhost:3000

## Deploy
This is a normal Node HTTP app and can be deployed to services that run Node 18+ (Render, Railway, Fly.io, a VPS, etc.). Some serverless/edge hosts may be unsuitable because music-platform upstream endpoints can depend on region/IP and may change.

## Current scope
v0.1 supports NetEase public playlists. QQ Music is intentionally not wired into this first build yet: its public endpoints and playability checks differ and should be tested separately rather than pretending the same privilege rules apply.

## Matching
Auto-match threshold: 0.78. Score = title 48% + artist 38% + duration 14%, with a penalty for an unexpected live/remix/cover marker.

## Important
Unofficial upstream APIs can change. Use this for catalog matching only and respect the music service's terms and regional availability.

## v0.2 test workflow
The app now accepts NetEase mobile share URLs such as:
`https://music.163.com/m/playlist?id=7759581159&creatorId=...`

After analysis, click **导出诊断 JSON**. This contains catalogue metadata, privilege flags, match scores, and top candidates, but no password or Cookie. It is intended for debugging false matches before public deployment.
