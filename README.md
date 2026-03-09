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
mdgist --delete abc123 --token <owner-token>
```

| Flag | Short | Description |
|------|-------|-------------|
| `--url` | `-u` | Custom URL slug |
| `--password` | `-p` | Password-protect the paste |
| `--edit-code` | `-e` | Edit code for edits or deletion |
| `--ttl` | `-t` | Time to live (`1h`, `1d`, `1w`, `30d`) |
| `--history` | | Enable edit history |
| `--delete` | `-d` | Delete a paste by ID |
| `--token` | | Owner token (for deletion) |
| `--server` | `-s` | Server URL (default: `https://mdgist.com`) |

The server can also be set with the `MDGIST_SERVER` environment variable.

### Deleting Pastes

When you create a paste, an owner token is printed alongside the URL:

```bash
cat notes.md | mdgist
https://mdgist.com/abc123
owner-token: xYz123...
```

Use the token to delete the paste later:

```bash
mdgist --delete abc123 --token xYz123...
```

You can also delete with an edit code:

```bash
mdgist -d abc123 -e myeditcode
```

## License

MIT — see [LICENSE](LICENSE).
