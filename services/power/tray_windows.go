//go:build windows

package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	wmDestroy        = 0x0002
	wmClose          = 0x0010
	wmCommand        = 0x0111
	wmContextMenu    = 0x007B
	wmLButtonUp      = 0x0202
	wmRButtonUp      = 0x0205
	wmApp            = 0x8000
	trayMessage      = wmApp + 1
	nimAdd           = 0x00000000
	nimDelete        = 0x00000002
	nimSetVersion    = 0x00000004
	nifMessage       = 0x00000001
	nifIcon          = 0x00000002
	nifTip           = 0x00000004
	notifyVersion4   = 4
	mfString         = 0x00000000
	mfSeparator      = 0x00000800
	mfGrayed         = 0x00000001
	tpmRightButton   = 0x0002
	tpmReturnCmd     = 0x0100
	swHide           = 0
	idiApplication   = 32512
	idOpen           = 1001
	idNetwork        = 1002
	idToggle         = 1003
	idRestart        = 1004
	idUpdate         = 1005
	idExit           = 1006
	idAcknowledge    = 1008
	idCheckUpdate    = 1009
	mbOK             = 0x00000000
	mbYesNo          = 0x00000004
	mbIconInfo       = 0x00000040
	mbIconError      = 0x00000010
	idYes            = 6
	ofnPathMustExist = 0x00000800
	ofnFileMustExist = 0x00001000
	ofnNoChangeDir   = 0x00000008
	ofnExplorer      = 0x00080000
)

type point struct {
	X int32
	Y int32
}

type wndClassEx struct {
	CbSize     uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSmall  uintptr
}

type notifyIconData struct {
	CbSize           uint32
	Window           uintptr
	ID               uint32
	Flags            uint32
	CallbackMessage  uint32
	Icon             uintptr
	Tip              [128]uint16
	State            uint32
	StateMask        uint32
	Info             [256]uint16
	TimeoutOrVersion uint32
	InfoTitle        [64]uint16
	InfoFlags        uint32
	GuidItem         [16]byte
	BalloonIcon      uintptr
}

type openFileName struct {
	StructSize      uint32
	Owner           uintptr
	Instance        uintptr
	Filter          *uint16
	CustomFilter    *uint16
	MaxCustomFilter uint32
	FilterIndex     uint32
	File            *uint16
	MaxFile         uint32
	FileTitle       *uint16
	MaxFileTitle    uint32
	InitialDir      *uint16
	Title           *uint16
	Flags           uint32
	FileOffset      uint16
	FileExtension   uint16
	DefaultExt      *uint16
	CustomData      uintptr
	Hook            uintptr
	TemplateName    *uint16
	Reserved        uintptr
	ReservedFlags   uint32
	FlagsEx         uint32
}

type trayRuntime struct {
	window     uintptr
	icon       notifyIconData
	ownsIcon   bool
	controller *ServerController
	monitor    *Monitor
	updater    *UpdateManager
}

var currentTray *trayRuntime

var (
	user32                  = syscall.NewLazyDLL("user32.dll")
	kernel32                = syscall.NewLazyDLL("kernel32.dll")
	shell32                 = syscall.NewLazyDLL("shell32.dll")
	comdlg32                = syscall.NewLazyDLL("comdlg32.dll")
	procRegisterClassExW    = user32.NewProc("RegisterClassExW")
	procCreateWindowExW     = user32.NewProc("CreateWindowExW")
	procDefWindowProcW      = user32.NewProc("DefWindowProcW")
	procDestroyWindow       = user32.NewProc("DestroyWindow")
	procGetMessageW         = user32.NewProc("GetMessageW")
	procTranslateMessage    = user32.NewProc("TranslateMessage")
	procDispatchMessageW    = user32.NewProc("DispatchMessageW")
	procPostQuitMessage     = user32.NewProc("PostQuitMessage")
	procLoadIconW           = user32.NewProc("LoadIconW")
	procCreateIconResource  = user32.NewProc("CreateIconFromResourceEx")
	procDestroyIcon         = user32.NewProc("DestroyIcon")
	procCreatePopupMenu     = user32.NewProc("CreatePopupMenu")
	procAppendMenuW         = user32.NewProc("AppendMenuW")
	procTrackPopupMenu      = user32.NewProc("TrackPopupMenu")
	procDestroyMenu         = user32.NewProc("DestroyMenu")
	procGetCursorPos        = user32.NewProc("GetCursorPos")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procMessageBoxW         = user32.NewProc("MessageBoxW")
	procShowWindow          = user32.NewProc("ShowWindow")
	procGetModuleHandleW    = kernel32.NewProc("GetModuleHandleW")
	procShellNotifyIconW    = shell32.NewProc("Shell_NotifyIconW")
	procGetOpenFileNameW    = comdlg32.NewProc("GetOpenFileNameW")
)

func loadTrayIcon() uintptr {
	data, err := bundledFiles.ReadFile("web/streamline-tray-icon.ico")
	if err != nil || len(data) < 22 || binary.LittleEndian.Uint16(data[0:2]) != 0 || binary.LittleEndian.Uint16(data[2:4]) != 1 {
		return 0
	}
	count := int(binary.LittleEndian.Uint16(data[4:6]))
	for index := 0; index < count; index++ {
		entry := 6 + index*16
		if entry+16 > len(data) {
			break
		}
		size := int(binary.LittleEndian.Uint32(data[entry+8 : entry+12]))
		offset := int(binary.LittleEndian.Uint32(data[entry+12 : entry+16]))
		if size <= 0 || offset < 0 || offset+size > len(data) {
			continue
		}
		icon, _, _ := procCreateIconResource.Call(
			uintptr(unsafe.Pointer(&data[offset])), uintptr(size), 1, 0x00030000, 32, 32, 0,
		)
		if icon != 0 {
			return icon
		}
	}
	return 0
}

func utf16Pointer(value string) *uint16 {
	pointer, _ := syscall.UTF16PtrFromString(value)
	return pointer
}

func copyUTF16(destination []uint16, value string) {
	encoded, _ := syscall.UTF16FromString(value)
	copy(destination, encoded)
}

func messageBox(title, message string, errorStyle bool) {
	style := uintptr(mbOK | mbIconInfo)
	if errorStyle {
		style = mbOK | mbIconError
	}
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(utf16Pointer(message))), uintptr(unsafe.Pointer(utf16Pointer(title))), style)
}

func confirmMessage(title, message string) bool {
	result, _, _ := procMessageBoxW.Call(0, uintptr(unsafe.Pointer(utf16Pointer(message))), uintptr(unsafe.Pointer(utf16Pointer(title))), mbYesNo|mbIconInfo)
	return result == idYes
}

func chooseUpdateExecutable(owner uintptr) string {
	buffer := make([]uint16, 32768)
	dialog := openFileName{
		Owner: owner, File: &buffer[0], MaxFile: uint32(len(buffer)),
		Title:      utf16Pointer("Choose the newer Streamline Power Monitor.exe"),
		DefaultExt: utf16Pointer("exe"), Flags: ofnExplorer | ofnPathMustExist | ofnFileMustExist | ofnNoChangeDir,
	}
	dialog.StructSize = uint32(unsafe.Sizeof(dialog))
	selected, _, _ := procGetOpenFileNameW.Call(uintptr(unsafe.Pointer(&dialog)))
	if selected == 0 {
		return ""
	}
	return syscall.UTF16ToString(buffer)
}

func startUpdate(tray *trayRuntime) error {
	selected := chooseUpdateExecutable(tray.window)
	if selected == "" {
		return nil
	}
	if !confirmMessage("Install Power Monitor update", "Power Monitor will close, install the selected update, preserve your settings, and restart. Continue?") {
		return nil
	}
	return launchUpdateExecutable(tray, selected, false)
}

func launchUpdateExecutable(tray *trayRuntime, selected string, temporary bool) error {
	data, err := os.ReadFile(selected)
	if err != nil {
		return err
	}
	if !bytes.Contains(data, []byte(appName)) {
		return errors.New("the selected file is not a Streamline Power Monitor update")
	}
	target, err := os.Executable()
	if err != nil {
		return err
	}
	selectedPath, _ := filepath.Abs(selected)
	targetPath, _ := filepath.Abs(target)
	if strings.EqualFold(selectedPath, targetPath) {
		return errors.New("choose a newer executable from a different folder")
	}
	arguments := []string{"--apply-update", target}
	if temporary {
		arguments = append(arguments, "--temporary-update")
	}
	command := exec.Command(selected, arguments...)
	command.Dir = filepath.Dir(selected)
	if err := command.Start(); err != nil {
		return err
	}
	_ = tray.controller.Stop()
	tray.monitor.Stop()
	procDestroyWindow.Call(tray.window)
	return nil
}

func installDownloadedUpdate(path string, controller *ServerController, monitor *Monitor) error {
	tray := currentTray
	if tray == nil || tray.controller != controller || tray.monitor != monitor {
		return errors.New("the Windows tray is not ready to install the update")
	}
	return launchUpdateExecutable(tray, path, true)
}

func applyUpdateExecutable(target string, temporary bool) error {
	current, err := os.Executable()
	if err != nil {
		return err
	}
	payload, err := os.ReadFile(current)
	if err != nil {
		return err
	}
	target, err = filepath.Abs(target)
	if err != nil {
		return err
	}
	backup := target + ".previous"
	staged := target + ".updating"
	_ = os.Remove(staged)
	if err := os.WriteFile(staged, payload, 0o755); err != nil {
		return fmt.Errorf("could not prepare update: %w", err)
	}
	_ = os.Remove(backup)
	deadline := time.Now().Add(30 * time.Second)
	for {
		err = os.Rename(target, backup)
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			_ = os.Remove(staged)
			return fmt.Errorf("the running app did not close: %w", err)
		}
		time.Sleep(250 * time.Millisecond)
	}
	if err := os.Rename(staged, target); err != nil {
		_ = os.Rename(backup, target)
		return fmt.Errorf("could not install update: %w", err)
	}
	arguments := []string{}
	if temporary {
		arguments = append(arguments, "--cleanup-update", current)
	}
	command := exec.Command(target, arguments...)
	command.Dir = filepath.Dir(target)
	if err := command.Start(); err != nil {
		_ = os.Remove(target)
		_ = os.Rename(backup, target)
		return fmt.Errorf("the update was installed but could not restart: %w", err)
	}
	_ = os.Remove(backup)
	return nil
}

func removeCompletedUpdater(path string) {
	deadline := time.Now().Add(30 * time.Second)
	for {
		if err := os.Remove(path); err == nil || os.IsNotExist(err) {
			return
		}
		if time.Now().After(deadline) {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func showUpdateFailure(err error) {
	messageBox("Power Monitor update", "The update could not be installed:\n"+err.Error(), true)
}

func appendMenu(menu uintptr, flags uintptr, id uintptr, label string) {
	var labelPointer uintptr
	if label != "" {
		labelPointer = uintptr(unsafe.Pointer(utf16Pointer(label)))
	}
	procAppendMenuW.Call(menu, flags, id, labelPointer)
}

func showTrayMenu(window uintptr) {
	tray := currentTray
	if tray == nil {
		return
	}
	menu, _, _ := procCreatePopupMenu.Call()
	if menu == 0 {
		return
	}
	defer procDestroyMenu.Call(menu)
	appendMenu(menu, mfString, idOpen, "Open dashboard")
	appendMenu(menu, mfString, idNetwork, "Show network address")
	appendMenu(menu, mfSeparator, 0, "")
	if tray.controller.IsRunning() {
		appendMenu(menu, mfString, idToggle, "Stop server")
		appendMenu(menu, mfString, idRestart, "Restart server")
	} else {
		appendMenu(menu, mfString, idToggle, "Start server")
		appendMenu(menu, mfString|mfGrayed, idRestart, "Restart server")
	}
	updateStatus := tray.updater.Status()
	updateLabel := "Check for updates"
	if updateStatus.Available {
		updateLabel = "Update to version " + updateStatus.LatestVersion + "..."
	}
	appendMenu(menu, mfString, idCheckUpdate, updateLabel)
	appendMenu(menu, mfString, idUpdate, "Install update from file...")
	appendMenu(menu, mfSeparator, 0, "")
	appendMenu(menu, mfString, idAcknowledge, "Acknowledge alerts")
	appendMenu(menu, mfSeparator, 0, "")
	appendMenu(menu, mfString, idExit, "Exit Streamline Power Monitor")
	var cursor point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&cursor)))
	procSetForegroundWindow.Call(window)
	command, _, _ := procTrackPopupMenu.Call(menu, tpmRightButton|tpmReturnCmd, uintptr(cursor.X), uintptr(cursor.Y), 0, window, 0)
	handleTrayCommand(command)
}

func handleTrayCommand(command uintptr) {
	tray := currentTray
	if tray == nil {
		return
	}
	switch command {
	case idOpen:
		if tray.controller.IsRunning() {
			openBrowser(tray.controller.LocalURL())
		} else {
			messageBox(appName, "The server is stopped. Right-click the tray icon and choose Start server.", false)
		}
	case idNetwork:
		addresses := tray.controller.NetworkURLs()
		message := "Other computers on the same private network can open:\n\n" + strings.Join(addresses, "\n")
		if len(addresses) == 0 {
			message = "No active private-network address was found."
		}
		message += "\n\nIf Windows asks, allow Streamline Power Monitor on private networks."
		messageBox("Power Monitor network address", message, false)
	case idToggle:
		if tray.controller.IsRunning() {
			if err := tray.controller.Stop(); err != nil {
				messageBox(appName, "The server could not be stopped:\n"+err.Error(), true)
			}
		} else if err := tray.controller.Start(); err != nil {
			messageBox(appName, "The server could not be started:\n"+err.Error(), true)
		}
	case idRestart:
		if err := tray.controller.Restart(); err != nil {
			messageBox(appName, "The server could not be restarted:\n"+err.Error(), true)
		}
	case idUpdate:
		if err := startUpdate(tray); err != nil {
			messageBox("Power Monitor update", "The update could not be started:\n"+err.Error(), true)
		}
	case idCheckUpdate:
		if tray.controller.IsRunning() {
			openBrowser(tray.controller.LocalURL() + "#updates")
		}
	case idAcknowledge:
		tray.monitor.AcknowledgeAlerts()
	case idExit:
		tray.controller.Stop()
		tray.monitor.Stop()
		procDestroyWindow.Call(tray.window)
	}
}

func windowProcedure(window uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case trayMessage:
		event := uint32(lParam & 0xffff)
		if event == wmRButtonUp || event == wmContextMenu {
			showTrayMenu(window)
		} else if event == wmLButtonUp {
			handleTrayCommand(idOpen)
		}
		return 0
	case wmCommand:
		handleTrayCommand(wParam & 0xffff)
		return 0
	case wmClose:
		procDestroyWindow.Call(window)
		return 0
	case wmDestroy:
		if currentTray != nil {
			procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&currentTray.icon)))
			if currentTray.ownsIcon {
				procDestroyIcon.Call(currentTray.icon.Icon)
			}
		}
		procPostQuitMessage.Call(0)
		return 0
	}
	result, _, _ := procDefWindowProcW.Call(window, uintptr(message), wParam, lParam)
	return result
}

func runTray(controller *ServerController, monitor *Monitor, updater *UpdateManager, startErr error) error {
	instance, _, _ := procGetModuleHandleW.Call(0)
	className := utf16Pointer("StreamlinePowerMonitorTrayWindow")
	icon := loadTrayIcon()
	ownsIcon := icon != 0
	if icon == 0 {
		icon, _, _ = procLoadIconW.Call(0, idiApplication)
	}
	windowClass := wndClassEx{CbSize: uint32(unsafe.Sizeof(wndClassEx{})), WndProc: syscall.NewCallback(windowProcedure), Instance: instance,
		Icon: icon, IconSmall: icon, ClassName: className}
	if registered, _, registerErr := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&windowClass))); registered == 0 {
		return fmt.Errorf("could not register tray window: %v", registerErr)
	}
	window, _, createErr := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(utf16Pointer(appName))),
		0, 0, 0, 0, 0, 0, 0, instance, 0)
	if window == 0 {
		return fmt.Errorf("could not create tray window: %v", createErr)
	}
	procShowWindow.Call(window, swHide)
	tray := &trayRuntime{window: window, ownsIcon: ownsIcon, controller: controller, monitor: monitor, updater: updater}
	tray.icon = notifyIconData{CbSize: uint32(unsafe.Sizeof(notifyIconData{})), Window: window, ID: 1,
		Flags: nifMessage | nifIcon | nifTip, CallbackMessage: trayMessage, Icon: icon}
	copyUTF16(tray.icon.Tip[:], appName)
	if added, _, addErr := procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&tray.icon))); added == 0 {
		return fmt.Errorf("could not add tray icon: %v", addErr)
	}
	tray.icon.TimeoutOrVersion = notifyVersion4
	procShellNotifyIconW.Call(nimSetVersion, uintptr(unsafe.Pointer(&tray.icon)))
	currentTray = tray
	if startErr != nil {
		messageBox(appName, "The server could not start:\n"+startErr.Error()+"\n\nUse the tray menu to try again.", true)
	}
	var message [7]uintptr
	for {
		result, _, getMessageErr := procGetMessageW.Call(uintptr(unsafe.Pointer(&message[0])), 0, 0, 0)
		if int32(result) == -1 {
			return fmt.Errorf("tray message loop failed: %v", getMessageErr)
		}
		if result == 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&message[0])))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&message[0])))
	}
	return nil
}
