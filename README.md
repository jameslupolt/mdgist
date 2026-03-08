# mdgist

A raw markdown pastebin. Create and share Markdown instantly, with password protection, edit codes, and edit history.

Forked from [kevinfiol/mdbin](https://github.com/kevinfiol/mdbin). Easily and freely self-hostable on Deno Deploy.

[Demo Instance](https://mdgist.com)

## CLI

A cross-platform command-line tool for creating pastes from the terminal.

### Install

Download from [GitHub Releases](https://github.com/jameslupolt/mdgist/releases), or with Go:

```bash
go install github.com/jameslupolt/mdgist/cli@latest
```

### Usage

```bash
cat README.md | mdgist
mdgist notes.md
echo '# Hello' | mdgist --url my-doc --password secret
```

| Flag | Short | Description |
|------|-------|-------------|
| `--url` | `-u` | Custom URL slug |
| `--password` | `-p` | Password-protect the paste |
| `--edit-code` | `-e` | Edit code to lock edits |
| `--ttl` | `-t` | Time to live (`1h`, `1d`, `1w`, `30d`) |
| `--history` | | Enable edit history |
| `--server` | `-s` | Server URL (default: `https://mdgist.com`) |

The server can also be set with the `MDGIST_SERVER` environment variable.

## License

MIT — see [LICENSE](LICENSE).
