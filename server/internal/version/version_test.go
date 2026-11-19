package version

import (
	"strings"
	"testing"
)

func TestInfo(t *testing.T) {
	Version, Build, Commit, Date = "1.2.3", "42", "0123456789abcdef", "2026-11-19T00:00:00Z"
	t.Cleanup(func() { Version, Build, Commit, Date = "dev", "0", "unknown", "unknown" })
	i := Get()
	if i.Version != "1.2.3" || i.Build != "42" || i.Go == "" {
		t.Fatalf("%+v", i)
	}
	s := i.String()
	for _, want := range []string{"1.2.3", "build 42", "0123456789ab", "2026-11-19"} {
		if !strings.Contains(s, want) {
			t.Errorf("%q missing %q", s, want)
		}
	}
	if strings.Contains(s, "0123456789abcdef") {
		t.Error("commit should be shortened")
	}
	if shortCommit("abc") != "abc" {
		t.Error("short commits stay as-is")
	}
}
