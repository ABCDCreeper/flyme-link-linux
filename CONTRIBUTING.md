# Contributing

Thanks for helping! This project is a clean-room-style Linux client for the
Flyme PC Link protocol, so a few rules keep it maintainable.

## Development

```bash
npm ci --ignore-scripts   # usocket's node-gyp step is unnecessary
npm test                  # unit + end-to-end mock tests
node bin/flyme-link.js -v
```

- Node.js ≥ 18, CommonJS modules.
- Add a unit test for every new protocol/clipboard/tray module.
- Keep desktop integration behind small adapters (`src/clipboard/backends/`),
  never poll the clipboard from an external process on GNOME.
- Do not commit `node_modules/`, `dist/` or `build/`.

## Commits

Use Conventional Commits, one small feature per commit:

```
feat(protocol): generate Flyme handshake tokens
fix(tray): keep menu revision monotonic
docs: document the clipboard message envelope
```

## Packaging

```bash
./scripts/build-packages.sh   # deb/rpm/Arch
./scripts/build-tarball.sh    # portable tar.gz
./scripts/build-appimage.sh   # AppImage with bundled Node
```

All downloads (nfpm, Node.js, appimagetool) are checksum-verified in the
scripts; keep it that way when updating versions.

## Protocol changes

Record new observations in `docs/protocol.md`, including the official client
version you inspected and whether the finding was verified on a device.
Strip any account ids, cookies or personal data from logs before sharing.
