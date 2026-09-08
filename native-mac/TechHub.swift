import AppKit
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private var process: Process?
    private var polling: Timer?
    private var port = 8700
    private var quitting = false
    private let support = ProcessInfo.processInfo.environment["TECH_HUB_DATA_DIR"].map { URL(fileURLWithPath: $0) } ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Tech Hub")
    func applicationDidFinishLaunching(_ notification: Notification) {
        if NSRunningApplication.runningApplications(withBundleIdentifier: "show.stg.techhub").count > 1 { NSApp.terminate(nil); return }
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "TH"
        item.button?.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .bold)
        item.button?.toolTip = "Tech Hub"
        rebuild("Starting services…")
        do {
            try FileManager.default.createDirectory(at: support.appendingPathComponent("logs"), withIntermediateDirectories: true)
            if let data = try? Data(contentsOf: support.appendingPathComponent("config.json")), let config = try? JSONSerialization.jsonObject(with: data) as? [String:Any], let saved = config["adminPort"] as? Int { port = saved }
            guard let resources = Bundle.main.resourceURL else { throw NSError(domain:"TechHub",code:1) }
            let task = Process()
            task.executableURL = resources.appendingPathComponent("node")
            task.arguments = [resources.appendingPathComponent("hub/server.cjs").path]
            var environment = ProcessInfo.processInfo.environment
            environment["TECH_HUB_RESOURCES"] = resources.path
            environment["TECH_HUB_DATA_DIR"] = support.path
            environment["TECH_HUB_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
            task.environment = environment
            let logURL = support.appendingPathComponent("logs/hub.log")
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
            let log = try FileHandle(forWritingTo: logURL); try log.seekToEnd()
            task.standardOutput = log; task.standardError = log
            task.terminationHandler = { [weak self] _ in DispatchQueue.main.async { guard let self, !self.quitting else { return }; self.rebuild("Hub stopped — open logs"); self.polling?.invalidate() } }
            try task.run(); process = task
            polling = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refresh() }
            refresh()
        } catch { rebuild("Unable to start — open logs"); let alert = NSAlert(); alert.messageText = "Tech Hub could not start"; alert.informativeText = error.localizedDescription; alert.runModal() }
    }
    private func rebuild(_ status: String) {
        let menu = NSMenu()
        let label = NSMenuItem(title: status, action:nil,keyEquivalent:""); label.isEnabled=false; menu.addItem(label)
        menu.addItem(.separator())
        for (title, action) in [("Open Master Page", #selector(openMaster)),("Open Configuration Folder",#selector(openConfig)),("Open Logs",#selector(openLogs)),("Downloads & Updates",#selector(openUpdates))] {
            let row = NSMenuItem(title:title,action:action,keyEquivalent:""); row.target=self;menu.addItem(row)
        }
        menu.addItem(.separator())
        let quit = NSMenuItem(title:"Quit Tech Hub",action:#selector(quit),keyEquivalent:"q");quit.target=self;menu.addItem(quit);item.menu=menu
    }
    private func refresh() {
        guard process?.isRunning == true else { return }
        var request = URLRequest(url:URL(string:"http://127.0.0.1:\(port)/api/status")!);request.timeoutInterval=2
        URLSession.shared.dataTask(with:request) { [weak self] data, _, _ in
            guard let self else { return }
            let json = data.flatMap { try? JSONSerialization.jsonObject(with:$0) as? [String:Any] }
            let services = json?["services"] as? [[String:Any]]
            let count = services?.filter { $0["state"] as? String == "running" }.count
            DispatchQueue.main.async { if !self.quitting { self.rebuild(count.map { "\($0) of 3 services online · :\(self.port)" } ?? "Starting or unavailable — open logs") } }
        }.resume()
    }
    @objc private func openMaster() { NSWorkspace.shared.open(URL(string:"http://127.0.0.1:\(port)")!) }
    @objc private func openConfig() { NSWorkspace.shared.open(support) }
    @objc private func openLogs() { NSWorkspace.shared.open(support.appendingPathComponent("logs")) }
    @objc private func openUpdates() { NSWorkspace.shared.open(URL(string:"https://github.com/horner516/Tech-Hub/releases/latest")!) }
    @objc private func quit() { NSApp.terminate(nil) }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        quitting=true;polling?.invalidate()
        guard let process, process.isRunning else { return .terminateNow }
        process.terminate()
        DispatchQueue.global().async { process.waitUntilExit(); DispatchQueue.main.async { sender.reply(toApplicationShouldTerminate:true) } }
        return .terminateLater
    }
}
let application=NSApplication.shared
let delegate=AppDelegate()
application.delegate=delegate
application.setActivationPolicy(.accessory)
application.run()
