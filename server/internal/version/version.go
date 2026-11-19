// Package version holds build metadata injected at link time:
//
//	go build -ldflags "-X github.com/lobojoel2003/Kitcount/server/internal/version.Version=1.0.0 ..."
package version

import "runtime"

var (
	// Version is the semantic version of the release (from the VERSION file).
	Version = "dev"
	// Build is the monotonically increasing CI build number.
	Build = "0"
	// Commit is the git commit the binary was built from.
	Commit = "unknown"
	// Date is the UTC build timestamp (RFC 3339).
	Date = "unknown"
	// Source is where users of this network service can obtain its source
	// code, as the AGPL-3.0 (section 13) requires.
	Source = "https://github.com/lobojoel2003/Kitcount"
)

// Info is the JSON shape returned by /healthz and `kitcount-server version`.
type Info struct {
	Version string `json:"version"`
	Build   string `json:"build"`
	Commit  string `json:"commit"`
	Date    string `json:"date"`
	Go      string `json:"go"`
	Source  string `json:"source"`
}

// Get returns the current build information.
func Get() Info {
	return Info{Version: Version, Build: Build, Commit: Commit, Date: Date, Go: runtime.Version(), Source: Source}
}

// String renders a one-line human readable version.
func (i Info) String() string {
	return "kitcount-server " + i.Version + " (build " + i.Build + ", " + shortCommit(i.Commit) + ", " + i.Date + ", " + i.Go + ")"
}

func shortCommit(c string) string {
	if len(c) > 12 {
		return c[:12]
	}
	return c
}
