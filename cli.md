# CLI

Create pastes from the terminal with the `mdgist` command-line tool.

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
| `--edit-code` | `-e` | Edit code to lock edits |
| `--ttl` | `-t` | Time to live (`1h`, `1d`, `1w`, `30d`) |
| `--history` | | Enable edit history |
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
