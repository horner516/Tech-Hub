package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestVersionComparison(t *testing.T) {
	for _, test := range []struct {
		left, right string
		want        int
	}{
		{"2.10.0", "2.9.0", 1},
		{"v3.0.0", "2.10.9", 1},
		{"2.9.0", "2.9.0", 0},
		{"2.8.9", "2.9.0", -1},
	} {
		if got := compareVersions(test.left, test.right); got != test.want {
			t.Fatalf("compareVersions(%q, %q) = %d, want %d", test.left, test.right, got, test.want)
		}
	}
}

func TestSelectUpdateAssetUsesStableWindowsName(t *testing.T) {
	assets := []releaseAsset{{Name: "notes.txt"}, {Name: "Streamline Power Monitor.exe", Digest: "sha256:" + string(make([]byte, 64))}}
	asset, ok := selectUpdateAsset(assets)
	if !ok || asset.Name != "Streamline Power Monitor.exe" {
		t.Fatalf("expected normalized app asset, got %#v", asset)
	}
	if _, ok := selectUpdateAsset([]releaseAsset{{Name: "different.exe"}}); ok {
		t.Fatal("an unrelated executable must not be selected")
	}
}

func TestUpdateDownloadValidation(t *testing.T) {
	if !validSHA256Digest("sha256:029c596ddf5911045c9ed16ab69123a70338a8b015c8de91131a5ed653adcedd") {
		t.Fatal("valid SHA-256 digest was rejected")
	}
	if validSHA256Digest("sha256:not-a-digest") {
		t.Fatal("invalid SHA-256 digest was accepted")
	}
	if !trustedGitHubDownloadURL("https://github.com/horner516/STG-Power-Meter/releases/download/v2.10.0/Streamline-Power-Monitor.exe") {
		t.Fatal("GitHub release URL was rejected")
	}
	if trustedGitHubDownloadURL("https://example.com/update.exe") {
		t.Fatal("non-GitHub update URL was accepted")
	}
}

func TestUpdateCheckReadsLatestGitHubRelease(t *testing.T) {
	manager := newUpdateManager()
	manager.client = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != updateAPIURL || !strings.Contains(request.Header.Get("User-Agent"), "Streamline-Power-Monitor") {
			t.Fatalf("unexpected GitHub request: %s", request.URL)
		}
		body := `{"tag_name":"v99.1.0","name":"Power Monitor 99.1.0","html_url":"https://github.com/horner516/STG-Power-Meter/releases/tag/v99.1.0","draft":false,"prerelease":false,"assets":[{"name":"Streamline-Power-Monitor.exe","browser_download_url":"https://github.com/horner516/STG-Power-Meter/releases/download/v99.1.0/Streamline-Power-Monitor.exe","digest":"sha256:029c596ddf5911045c9ed16ab69123a70338a8b015c8de91131a5ed653adcedd","size":7000000}]}`
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	status, err := manager.Check(context.Background(), true)
	if err != nil || !status.Available || status.LatestVersion != "99.1.0" || status.AssetName != expectedUpdateBinary {
		t.Fatalf("unexpected update status: %#v, %v", status, err)
	}
}

func TestUpdateDownloadVerifiesDigestAndProduct(t *testing.T) {
	payload := append([]byte("MZ"), bytes.Repeat([]byte("Streamline Power Monitor signed release payload"), 50)...)
	digest := fmt.Sprintf("sha256:%x", sha256.Sum256(payload))
	manager := newUpdateManager()
	manager.status = UpdateStatus{
		Repository: updateRepository, CurrentVersion: version, LatestVersion: "99.1.0", Available: true, CanInstall: true,
		assetDownloadURL: "https://github.com/horner516/STG-Power-Meter/releases/download/v99.1.0/Streamline-Power-Monitor.exe",
		assetDigest:      digest, assetSize: int64(len(payload)),
	}
	manager.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(payload)), Header: make(http.Header)}, nil
	})}
	path, err := manager.Download(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	if downloaded, err := os.ReadFile(path); err != nil || !bytes.Equal(downloaded, payload) {
		t.Fatalf("verified update was not staged correctly: %v", err)
	}
}
