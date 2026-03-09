package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

var version = "dev"

const defaultServer = "https://mdgist.com"

// Allowed TTL values (must match server-side ALLOWED_TTL_VALUES).
var ttlMap = map[string]int{
	"1h":  3_600_000,
	"1d":  86_400_000,
	"1w":  604_800_000,
	"30d": 2_592_000_000,
}

type createRequest struct {
	Paste    string `json:"paste"`
	URL      string `json:"url,omitempty"`
	EditCode string `json:"editCode,omitempty"`
	Password string `json:"password,omitempty"`
	TTL      int    `json:"ttl,omitempty"`
	History  bool   `json:"history,omitempty"`
}

type createResponse struct {
	ID         string `json:"id"`
	URL        string `json:"url"`
	OwnerToken string `json:"ownerToken"`
}

type errorResponse struct {
	Error string `json:"error"`
}

type deleteResponse struct {
	Deleted bool `json:"deleted"`
}

func main() {
	urlFlag := flag.String("url", "", "Custom URL slug")
	password := flag.String("password", "", "Password-protect the paste")
	editCode := flag.String("edit-code", "", "Edit code for edits or deletion")
	ttlFlag := flag.String("ttl", "", "Time to live (1h, 1d, 1w, 30d)")
	history := flag.Bool("history", false, "Enable edit history")
	server := flag.String("server", "", "Server URL (default: $MDGIST_SERVER or "+defaultServer+")")
	showVersion := flag.Bool("version", false, "Print version and exit")
	deleteID := flag.String("delete", "", "Delete a paste by ID")
	ownerToken := flag.String("token", "", "Owner token (for deletion)")

	flag.StringVar(urlFlag, "u", "", "Custom URL slug (shorthand)")
	flag.StringVar(password, "p", "", "Password (shorthand)")
	flag.StringVar(editCode, "e", "", "Edit code (shorthand)")
	flag.StringVar(ttlFlag, "t", "", "TTL (shorthand)")
	flag.StringVar(server, "s", "", "Server URL (shorthand)")
	flag.StringVar(deleteID, "d", "", "Delete paste (shorthand)")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: mdgist [options] [file]\n\n")
		fmt.Fprintf(os.Stderr, "Create a markdown paste and print the URL.\n\n")
		fmt.Fprintf(os.Stderr, "Examples:\n")
		fmt.Fprintf(os.Stderr, "  cat README.md | mdgist\n")
		fmt.Fprintf(os.Stderr, "  mdgist notes.md --ttl 1d\n")
		fmt.Fprintf(os.Stderr, "  echo '# Hello' | mdgist -u my-doc -p secret\n")
		fmt.Fprintf(os.Stderr, "  mdgist --delete abc123 --token <owner-token>\n")
		fmt.Fprintf(os.Stderr, "  mdgist -d abc123 -e <edit-code>\n\n")
		fmt.Fprintf(os.Stderr, "Options:\n")
		flag.PrintDefaults()
	}

	flag.Parse()

	if *showVersion {
		fmt.Println("mdgist " + version)
		return
	}

	serverURL := resolveServer(*server)

	// Delete mode
	if *deleteID != "" {
		if *ownerToken == "" && *editCode == "" {
			fatal(fmt.Errorf("--delete requires --token (owner token) or --edit-code"))
		}
		err := deletePaste(serverURL, *deleteID, *ownerToken, *editCode, *password)
		if err != nil {
			fatal(err)
		}
		fmt.Fprintf(os.Stderr, "Deleted: %s/%s\n", serverURL, *deleteID)
		return
	}

	// Create mode
	paste, err := readInput()
	if err != nil {
		fatal(err)
	}

	ttl, err := parseTTL(*ttlFlag)
	if err != nil {
		fatal(err)
	}

	req := createRequest{
		Paste:    paste,
		URL:      *urlFlag,
		EditCode: *editCode,
		Password: *password,
		TTL:      ttl,
		History:  *history,
	}

	result, err := createPaste(serverURL, req)
	if err != nil {
		fatal(err)
	}

	fmt.Println(serverURL + result.URL)
	if result.OwnerToken != "" {
		fmt.Fprintf(os.Stderr, "owner-token: %s\n", result.OwnerToken)
	}
}

func resolveServer(explicit string) string {
	if explicit != "" {
		return strings.TrimRight(explicit, "/")
	}
	if env := os.Getenv("MDGIST_SERVER"); env != "" {
		return strings.TrimRight(env, "/")
	}
	return defaultServer
}

func readInput() (string, error) {
	if flag.NArg() > 0 {
		data, err := os.ReadFile(flag.Arg(0))
		if err != nil {
			return "", err
		}
		return trimTrailingNewline(string(data)), nil
	}

	stat, _ := os.Stdin.Stat()
	if (stat.Mode() & os.ModeCharDevice) != 0 {
		return "", fmt.Errorf("no input — pipe a file or pass a filename\n  cat file.md | mdgist\n  mdgist file.md")
	}

	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		return "", fmt.Errorf("reading stdin: %w", err)
	}

	s := trimTrailingNewline(string(data))
	if len(s) == 0 {
		return "", fmt.Errorf("empty input")
	}
	return s, nil
}

func trimTrailingNewline(s string) string {
	return strings.TrimRight(s, "\r\n")
}

func parseTTL(raw string) (int, error) {
	if raw == "" {
		return 0, nil
	}
	val, ok := ttlMap[raw]
	if !ok {
		return 0, fmt.Errorf("invalid --ttl %q (use 1h, 1d, 1w, or 30d)", raw)
	}
	return val, nil
}

func createPaste(serverURL string, req createRequest) (*createResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Post(serverURL+"/api/save", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusCreated {
		var e errorResponse
		if json.Unmarshal(respBody, &e) == nil && e.Error != "" {
			return nil, fmt.Errorf("server: %s", e.Error)
		}
		return nil, fmt.Errorf("server returned %d", resp.StatusCode)
	}

	var result createResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}

	return &result, nil
}

func deletePaste(serverURL, id, ownerToken, editCode, password string) error {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("POST", serverURL+"/api/"+id+"/delete", nil)
	if err != nil {
		return err
	}

	if ownerToken != "" {
		req.Header.Set("X-Owner-Token", ownerToken)
	}
	if editCode != "" {
		req.Header.Set("X-Edit-Code", editCode)
	}
	if password != "" {
		req.Header.Set("X-Paste-Password", password)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var e errorResponse
		if json.Unmarshal(respBody, &e) == nil && e.Error != "" {
			return fmt.Errorf("server: %s", e.Error)
		}
		return fmt.Errorf("server returned %d", resp.StatusCode)
	}

	return nil
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "error: %v\n", err)
	os.Exit(1)
}
