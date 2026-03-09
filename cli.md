# CLI

Create and manage pastes from the terminal with the `mdgist` command-line tool.

```
cat README.md | mdgist
mdgist notes.md
echo '# Hello' | mdgist --url my-doc --password secret
```

## Install

### Homebrew (macOS / Linux)

```
brew install jameslupolt/tap/mdgist
```

### Go

```
go install github.com/jameslupolt/mdgist/cli@latest
```

### Manual Download

Grab the latest binary from [GitHub Releases](https://github.com/jameslupolt/mdgist/releases) and put it in your `PATH`.

## Options

| Flag | Short | Description |
|------|-------|-------------|
| `--url` | `-u` | Custom URL slug |
| `--password` | `-p` | Password-protect the paste |
| `--edit-code` | `-e` | Edit code for edits or deletion |
| `--ttl` | `-t` | Time to live (`1h`, `1d`, `1w`, `30d`) |
| `--history` | | Enable edit history |
| `--delete` | `-d` | Delete a paste by ID |
| `--token` | | Owner token (for deletion) |
| `--server` | `-s` | Server URL |
| `--version` | | Print version |

The default server is `https://mdgist.com`. Override it with `--server` or the `MDGIST_SERVER` environment variable.

## Examples

Paste with a custom URL and 1-day expiry:

```
cat draft.md | mdgist -u meeting-notes -t 1d
```

Password-protected paste with edit code:

```
mdgist secret.md -p hunter2 -e mycode
```

Paste to a self-hosted instance:

```
cat log.md | mdgist -s http://localhost:8000
```

## Deleting Pastes

When you create a paste, an owner token is printed alongside the URL:

```
cat notes.md | mdgist
https://mdgist.com/abc123
owner-token: xYz123...
```

Use the token to delete the paste later:

```
mdgist --delete abc123 --token xYz123...
```

You can also delete with an edit code:

```
mdgist -d abc123 -e myeditcode
```
