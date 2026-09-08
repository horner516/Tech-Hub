package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	updateRepository     = "horner516/STG-Power-Meter"
	updateAPIURL         = "https://api.github.com/repos/" + updateRepository + "/releases/latest"
	updateCheckInterval  = 24 * time.Hour
	maximumUpdateSize    = 128 * 1024 * 1024
	expectedUpdateBinary = "Streamline-Power-Monitor.exe"
)

type releaseAsset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"browser_download_url"`
	Digest      string `json:"digest"`
	Size        int64  `json:"size"`
}

type githubRelease struct {
	TagName    string         `json:"tag_name"`
	Name       string         `json:"name"`
	HTMLURL    string         `json:"html_url"`
	Body       string         `json:"body"`
	Draft      bool           `json:"draft"`
	Prerelease bool           `json:"prerelease"`
	Assets     []releaseAsset `json:"assets"`
}

type UpdateStatus struct {
	Repository       string `json:"repository"`
	CurrentVersion   string `json:"current_version"`
	LatestVersion    string `json:"latest_version,omitempty"`
	ReleaseName      string `json:"release_name,omitempty"`
	ReleaseURL       string `json:"release_url,omitempty"`
	ReleaseNotes     string `json:"release_notes,omitempty"`
	AssetName        string `json:"asset_name,omitempty"`
	Available        bool   `json:"available"`
	CanInstall       bool   `json:"can_install"`
	Checking         bool   `json:"checking"`
	Downloading      bool   `json:"downloading"`
	CheckedAt        string `json:"checked_at,omitempty"`
	NextCheckAt      string `json:"next_check_at,omitempty"`
	Error            string `json:"error,omitempty"`
	assetDownloadURL string
	assetDigest      string
	assetSize        int64
}

type UpdateManager struct {
	mu         sync.RWMutex
	status     UpdateStatus
	client     *http.Client
	stop       chan struct{}
	stopOnce   sync.Once
	checkEvery time.Duration
}

func newUpdateManager() *UpdateManager {
	return &UpdateManager{
		status: UpdateStatus{Repository: updateRepository, CurrentVersion: version},
		client: &http.Client{
			Timeout: 20 * time.Second,
			CheckRedirect: func(request *http.Request, via []*http.Request) error {
				if len(via) >= 5 || !trustedGitHubDownloadURL(request.URL.String()) {
					return errors.New("update download redirected outside GitHub")
				}
				return nil
			},
		},
		stop:       make(chan struct{}),
		checkEvery: updateCheckInterval,
	}
}

func (manager *UpdateManager) Start() {
	go func() {
		check := func() {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			_, _ = manager.Check(ctx, true)
		}
		check()
		ticker := time.NewTicker(manager.checkEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				check()
			case <-manager.stop:
				return
			}
		}
	}()
}

func (manager *UpdateManager) Stop() {
	manager.stopOnce.Do(func() { close(manager.stop) })
}

func (manager *UpdateManager) Status() UpdateStatus {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	return manager.status
}

func (manager *UpdateManager) Check(ctx context.Context, force bool) (UpdateStatus, error) {
	manager.mu.Lock()
	if manager.status.Checking {
		status := manager.status
		manager.mu.Unlock()
		return status, nil
	}
	if !force && manager.status.CheckedAt != "" {
		checkedAt, _ := time.Parse(time.RFC3339Nano, manager.status.CheckedAt)
		if time.Since(checkedAt) < manager.checkEvery {
			status := manager.status
			manager.mu.Unlock()
			return status, nil
		}
	}
	manager.status.Checking = true
	manager.status.Error = ""
	manager.mu.Unlock()

	status, err := manager.fetchLatest(ctx)
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.status.Checking = false
	now := time.Now().UTC()
	manager.status.CheckedAt = now.Format(time.RFC3339Nano)
	manager.status.NextCheckAt = now.Add(manager.checkEvery).Format(time.RFC3339Nano)
	if err != nil {
		manager.status.Error = err.Error()
		return manager.status, err
	}
	status.CheckedAt = manager.status.CheckedAt
	status.NextCheckAt = manager.status.NextCheckAt
	status.Downloading = manager.status.Downloading
	manager.status = status
	return manager.status, nil
}

func (manager *UpdateManager) fetchLatest(ctx context.Context) (UpdateStatus, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, updateAPIURL, nil)
	if err != nil {
		return UpdateStatus{}, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2026-03-10")
	request.Header.Set("User-Agent", "Streamline-Power-Monitor/"+version)
	response, err := manager.client.Do(request)
	if err != nil {
		return UpdateStatus{}, fmt.Errorf("GitHub could not be reached: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return UpdateStatus{}, errors.New("no published GitHub Release is available yet")
	}
	if response.StatusCode != http.StatusOK {
		return UpdateStatus{}, fmt.Errorf("GitHub returned HTTP %d", response.StatusCode)
	}
	var release githubRelease
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1024*1024))
	if err := decoder.Decode(&release); err != nil {
		return UpdateStatus{}, errors.New("GitHub returned an invalid release description")
	}
	if release.Draft || release.Prerelease {
		return UpdateStatus{}, errors.New("the latest GitHub Release is not a production release")
	}
	latest := cleanVersion(release.TagName)
	if _, ok := parseVersion(latest); !ok {
		return UpdateStatus{}, fmt.Errorf("release tag %q is not a valid version", release.TagName)
	}
	asset, ok := selectUpdateAsset(release.Assets)
	status := UpdateStatus{
		Repository: updateRepository, CurrentVersion: version, LatestVersion: latest,
		ReleaseName: release.Name, ReleaseURL: release.HTMLURL, ReleaseNotes: truncateText(release.Body, 1200),
		Available: compareVersions(latest, version) > 0,
	}
	if !ok {
		if status.Available {
			return status, fmt.Errorf("release %s does not contain %s", latest, expectedUpdateBinary)
		}
		return status, nil
	}
	status.AssetName = asset.Name
	status.assetDownloadURL = asset.DownloadURL
	status.assetDigest = strings.ToLower(strings.TrimSpace(asset.Digest))
	status.assetSize = asset.Size
	status.CanInstall = status.Available && runtime.GOOS == "windows" && validSHA256Digest(status.assetDigest) && trustedGitHubDownloadURL(status.assetDownloadURL)
	if status.Available && !status.CanInstall && runtime.GOOS == "windows" {
		status.Error = "The release was found, but its executable is missing a verifiable SHA-256 digest."
	}
	return status, nil
}

func (manager *UpdateManager) Download(ctx context.Context) (string, error) {
	manager.mu.Lock()
	if manager.status.Downloading {
		manager.mu.Unlock()
		return "", errors.New("an update is already downloading")
	}
	status := manager.status
	if !status.CanInstall {
		manager.mu.Unlock()
		return "", errors.New("no verified update is ready to install")
	}
	manager.status.Downloading = true
	manager.status.Error = ""
	manager.mu.Unlock()
	defer func() {
		manager.mu.Lock()
		manager.status.Downloading = false
		manager.mu.Unlock()
	}()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, status.assetDownloadURL, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "application/octet-stream")
	request.Header.Set("User-Agent", "Streamline-Power-Monitor/"+version)
	response, err := manager.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("the update could not be downloaded: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("the update download returned HTTP %d", response.StatusCode)
	}
	if status.assetSize <= 0 || status.assetSize > maximumUpdateSize {
		return "", errors.New("the release has an invalid executable size")
	}
	file, err := os.CreateTemp("", "Streamline-Power-Monitor-*.exe")
	if err != nil {
		return "", err
	}
	path := file.Name()
	keep := false
	defer func() {
		_ = file.Close()
		if !keep {
			_ = os.Remove(path)
		}
	}()
	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(file, hasher), io.LimitReader(response.Body, maximumUpdateSize+1))
	if err != nil {
		return "", fmt.Errorf("the update download was interrupted: %w", err)
	}
	if written > maximumUpdateSize || written != status.assetSize {
		return "", errors.New("the downloaded executable size does not match the GitHub Release")
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	expected := strings.TrimPrefix(status.assetDigest, "sha256:")
	actual := hex.EncodeToString(hasher.Sum(nil))
	if !strings.EqualFold(actual, expected) {
		return "", errors.New("the downloaded executable failed its SHA-256 integrity check")
	}
	payload, err := os.ReadFile(path)
	if err != nil || len(payload) < 2 || string(payload[:2]) != "MZ" || !bytes.Contains(payload, []byte(appName)) {
		return "", errors.New("the downloaded file is not a valid Streamline Power Monitor executable")
	}
	keep = true
	return path, nil
}

func (manager *UpdateManager) setInstallError(err error) {
	if err == nil {
		return
	}
	manager.mu.Lock()
	manager.status.Error = err.Error()
	manager.mu.Unlock()
}

func selectUpdateAsset(assets []releaseAsset) (releaseAsset, bool) {
	wanted := normalizeAssetName(expectedUpdateBinary)
	for _, asset := range assets {
		if normalizeAssetName(asset.Name) == wanted {
			return asset, true
		}
	}
	return releaseAsset{}, false
}

func normalizeAssetName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(" ", "", "-", "", "_", "")
	return replacer.Replace(value)
}

func validSHA256Digest(value string) bool {
	value = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), "sha256:")
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func trustedGitHubDownloadURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "github.com" || host == "objects.githubusercontent.com" || strings.HasSuffix(host, ".githubusercontent.com")
}

func cleanVersion(value string) string {
	return strings.TrimPrefix(strings.TrimSpace(value), "v")
}

func parseVersion(value string) ([3]int, bool) {
	var parsed [3]int
	parts := strings.Split(cleanVersion(value), ".")
	if len(parts) != 3 {
		return parsed, false
	}
	for index, part := range parts {
		digits := strings.TrimSpace(part)
		if digits == "" {
			return parsed, false
		}
		for position, character := range digits {
			if character < '0' || character > '9' {
				digits = digits[:position]
				break
			}
		}
		number, err := strconv.Atoi(digits)
		if err != nil || number < 0 {
			return parsed, false
		}
		parsed[index] = number
	}
	return parsed, true
}

func compareVersions(left, right string) int {
	leftVersion, leftOK := parseVersion(left)
	rightVersion, rightOK := parseVersion(right)
	if !leftOK || !rightOK {
		return 0
	}
	for index := range leftVersion {
		if leftVersion[index] > rightVersion[index] {
			return 1
		}
		if leftVersion[index] < rightVersion[index] {
			return -1
		}
	}
	return 0
}

func truncateText(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if len(value) <= maximum {
		return value
	}
	return strings.TrimSpace(value[:maximum]) + "…"
}
