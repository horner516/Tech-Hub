//go:build !windows

package main

import "errors"

func runTray(_ *ServerController, _ *Monitor, _ *UpdateManager, _ error) error {
	return errors.New("the system tray is available in the Windows build")
}

func applyUpdateExecutable(_ string, _ bool) error {
	return errors.New("automatic executable updates are available only on Windows")
}

func installDownloadedUpdate(_ string, _ *ServerController, _ *Monitor) error {
	return errors.New("automatic executable updates are available only on Windows")
}

func removeCompletedUpdater(_ string) {}

func showUpdateFailure(_ error) {}
