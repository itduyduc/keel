// Keel — the Mac app: a thin native window around the Keel web UI.
//
// The UI is NOT in this binary. The window loads it from the Keel server on
// every launch, so a web deploy reaches all three of us without anyone
// reinstalling. This file owns only what a web page cannot do for itself: a
// real Mac window and menus, Google sign-in through the system's
// authentication session, the clipboard, and links that leave the app.
//
//   server  the ServerURL baked into Info.plist by mac/build-app.sh --server <url>,
//           or `--server <url>` / KEEL_SERVER at launch
//   log     ~/Library/Logs/Keel/keel.log
//   build   bash mac/build-app.sh [dest-dir]

import AppKit
import AuthenticationServices
import WebKit

// MARK: - Diagnostics log

/// Every step that can fail quietly inside a web view — a navigation, a
/// sign-in, a message from the page — leaves a line here, with elapsed
/// seconds and the exact NSError domain and code. Without it a blank window
/// is undebuggable: "the server is down" and "macOS refused the connection"
/// look identical from outside.
enum Log {
    static let path = NSHomeDirectory() + "/Library/Logs/Keel/keel.log"
    static var displayPath: String { (path as NSString).abbreviatingWithTildeInPath }

    private static let queue = DispatchQueue(label: "com.duytran.Keel.log")
    private static let limit = 200_000      // bytes; past this the older half goes
    private static let clock = Date.ISO8601FormatStyle(includingFractionalSeconds: true, timeZone: .current)

    static func write(_ message: String) {
        let line = "\(Date().formatted(clock)) \(message)\n"
        try? FileHandle.standardError.write(contentsOf: Data(line.utf8))
        queue.async { append(line) }
    }

    /// Waits until every line written so far is on disk — for just before exit().
    static func flush() { queue.sync {} }

    private static func append(_ line: String) {
        let fm = FileManager.default
        let url = URL(fileURLWithPath: path)
        if !fm.fileExists(atPath: path) {
            try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            fm.createFile(atPath: path, contents: nil)
        }
        guard let file = try? FileHandle(forWritingTo: url) else { return }
        let size = ((try? file.seekToEnd()) ?? 0) + UInt64(line.utf8.count)
        try? file.write(contentsOf: Data(line.utf8))
        try? file.close()

        // Trim from the front, keeping whole lines.
        guard size > limit, let data = try? Data(contentsOf: url) else { return }
        var tail = data.suffix(limit / 2)
        if let newline = tail.firstIndex(of: 0x0A) { tail = tail[tail.index(after: newline)...] }
        try? tail.write(to: url, options: .atomic)
    }
}

// MARK: - Server

/// Where the UI comes from. The default is baked into the bundle's Info.plist
/// (`ServerURL`, set by mac/build-app.sh --server), so every kind of launch —
/// Spotlight, the Dock, a launchd agent — agrees on it. An environment variable
/// set in one place reaches one kind of launch and not the others.
struct Server {
    static var standard: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "ServerURL") as? String else { return nil }
        return parse(raw)
    }

    let url: URL
    let source: String

    /// `--server <url>`, then KEEL_SERVER, then the bundle's default. An override
    /// that is not an http(s) URL with a host is logged and skipped.
    static func resolve() -> Server? {
        var offered: [(value: String, source: String)] = []
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--server") {
            if i + 1 < args.count { offered.append((args[i + 1], "--server")) }
            else { Log.write("--server was given with no URL — ignored") }
        }
        if let env = ProcessInfo.processInfo.environment["KEEL_SERVER"], !env.isEmpty {
            offered.append((env, "KEEL_SERVER"))
        }
        for choice in offered {
            if let url = parse(choice.value) { return Server(url: url, source: choice.source) }
            Log.write("\(choice.source) \"\(choice.value)\" is not an http(s) URL with a host — ignored")
        }
        if let url = standard { return Server(url: url, source: "Info.plist") }
        return nil
    }

    private static func parse(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https", url.host?.isEmpty == false else { return nil }
        return url
    }

    var host: String? { url.host?.lowercased() }

    func owns(_ host: String?) -> Bool { host?.lowercased() == self.host }

    /// `path` on this server with one query parameter, its value encoded so
    /// nothing in it (`+`, `&`, `=`, `#`…) can change what the URL means.
    func endpoint(_ path: String, _ name: String, _ value: String) -> URL {
        let unreserved = CharacterSet(charactersIn:
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        parts.path += path
        parts.percentEncodedQuery = name + "=" + (value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? "")
        parts.fragment = nil
        return parts.url!
    }
}

// MARK: - Window

/// A title-bar double-click maximizes, and the next one puts the window back
/// (Duy, 2026-09-29). macOS's default action filled the screen and then stayed
/// there. Minimize and Do Nothing in System Settings ▸ Desktop & Dock are still
/// honored; only the maximize action becomes a toggle.
final class KeelWindow: NSWindow {
    private var restoreFrame: NSRect?

    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown, event.clickCount == 2, inTitleBar(event.locationInWindow) {
            titleBarDoubleClicked()
            return
        }
        super.sendEvent(event)
    }

    /// Above the page and not on a traffic light. The title text is a control
    /// too, but only buttons are exempt, so a double-click on "Keel" counts.
    private func inTitleBar(_ point: NSPoint) -> Bool {
        guard point.y >= contentLayoutRect.maxY else { return false }
        var view = contentView?.superview?.hitTest(point)
        while let v = view {
            if v is NSButton { return false }
            view = v.superview
        }
        return true
    }

    private func titleBarDoubleClicked() {
        switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
        case "Minimize": performMiniaturize(nil)
        case "None": break
        default: toggleFill()
        }
    }

    private func toggleFill() {
        guard let visible = (screen ?? NSScreen.main)?.visibleFrame else { return }
        let filled = abs(frame.minX - visible.minX) < 2 && abs(frame.minY - visible.minY) < 2
            && abs(frame.width - visible.width) < 2 && abs(frame.height - visible.height) < 2
        if filled {
            // filled some other way (Window ▸ Fill) with nothing to go back to: a sensible middle size
            let back = restoreFrame ?? visible.insetBy(dx: visible.width * 0.12, dy: visible.height * 0.1)
            restoreFrame = nil
            Log.write("title bar double-click: restore to \(Int(back.width))×\(Int(back.height))")
            setFrame(back, display: true, animate: true)
        } else {
            restoreFrame = frame
            Log.write("title bar double-click: fill \(Int(visible.width))×\(Int(visible.height))")
            setFrame(visible, display: true, animate: true)
        }
    }

    /// `--test-titlebar-double-click`: two synthetic double-clicks in the title
    /// bar, the frame logged after each, then exit. One-shot, so it may run
    /// beside the live app.
    func selfTestTitleBarDoubleClick() {
        let size = { (f: NSRect) in "\(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))×\(Int(f.height))" }
        Log.write("test: start \(size(frame)) · visible \(size((screen ?? NSScreen.main)?.visibleFrame ?? .zero))")
        for round in 1...2 {
            let point = NSPoint(x: frame.width / 2, y: frame.height - 10)   // window coordinates, in the bar
            let event = NSEvent.mouseEvent(with: .leftMouseDown, location: point, modifierFlags: [],
                                           timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: windowNumber,
                                           context: nil, eventNumber: 0, clickCount: 2, pressure: 1)!
            sendEvent(event)
            Log.write("test: after double-click \(round): \(size(frame))")
        }
    }
}

// MARK: - App

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate,
                         WKUIDelegate, WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {
    private let server: Server
    private var window: NSWindow!
    private var web: WKWebView!

    init(server: Server) {
        self.server = server
        super.init()
    }

    private var version: String { infoString("CFBundleShortVersionString") }
    private var build: String { infoString("CFBundleVersion") }
    private func infoString(_ key: String) -> String {
        Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "?"
    }

    // MARK: Launch, close, reopen

    func applicationDidFinishLaunching(_ notification: Notification) {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        Log.write("app start · version=\(version) (\(build)) · server=\(server.url.absoluteString) [\(server.source)]"
                  + " · macOS \(os.majorVersion).\(os.minorVersion).\(os.patchVersion)")
        NSWindow.allowsAutomaticWindowTabbing = false   // one window: no tab items in View or Window
        buildMenu()
        buildWindow()
        showWindow()
        if CommandLine.arguments.contains("--test-titlebar-double-click"), let w = window as? KeelWindow {
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1))
                w.selfTestTitleBarDoubleClick()
                Log.flush()
                NSApp.terminate(nil)
            }
            return
        }
        web.load(URLRequest(url: server.url))
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    /// Clicking the Dock icon brings back the window the close button hid.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showWindow() }
        return true
    }

    /// Closing hides the window; the page stays loaded and live behind it.
    /// ⌘Q is the only way to quit.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    private func showWindow() {
        window.makeKeyAndOrderFront(nil)
        if #available(macOS 14, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
    }

    /// A sheet on a hidden window is never drawn and never completes, so the
    /// page would wait forever for its answer. Anything that asks shows the
    /// window first (seen in a sibling app).
    private var sheetWindow: NSWindow {
        if !window.isVisible { showWindow() }
        return window
    }

    private func buildWindow() {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "keel")
        config.userContentController.addUserScript(WKUserScript(
            source: "window.keelNative = \(nativeInfo());",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))

        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        // WITHOUT this the panel methods below are never called: alert() shows
        // nothing, confirm() silently returns false, and every "are you sure?"
        // quietly cancels (seen in a sibling app).
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")              // no white flash before the page paints
        if #available(macOS 13.3, *) { web.isInspectable = true }   // Safari ▸ Develop ▸ Keel

        window = KeelWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Keel"
        window.isReleasedWhenClosed = false
        // A REAL title bar, not .fullSizeContentView: with the web view under the
        // title area, title-bar drags and double-click-to-zoom never reach the
        // window. The empty toolbar only gives that bar real height —
        // .unifiedCompact; .unified was too tall and a bare title bar too thin.
        window.titlebarAppearsTransparent = true
        window.toolbar = NSToolbar(identifier: "KeelMain")
        window.toolbarStyle = .unifiedCompact
        window.titlebarSeparatorStyle = .none
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(srgbRed: 0x0F / 255, green: 0x0F / 255, blue: 0x10 / 255, alpha: 1)
        window.minSize = NSSize(width: 900, height: 560)
        window.contentView = web
        // Attaching the toolbar grew the frame for the DEFAULT toolbar style, and
        // .unifiedCompact then handed the spare 58pt to the page (frame 918, page
        // 878: too tall for a 14" laptop). Re-assert the size meant: 1280×820 of
        // page under a 40pt bar, frame 860. Measured, macOS 27.
        window.setContentSize(NSSize(width: 1280, height: 820))
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("KeelMain")   // after center(), so a saved frame wins
    }

    /// `{"platform":"mac","version":"0.1.0"}` — how the page knows it is inside this shell.
    private func nativeInfo() -> String {
        let info = ["platform": "mac", "version": version]
        guard let data = try? JSONSerialization.data(withJSONObject: info, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
    }

    // MARK: Menus
    //
    // The web UI owns ⌘K, ⌘., ⇧⌘., ⇧⌘, and every bare letter — nothing here
    // may bind them, or the menu would swallow the page's shortcut.

    private func buildMenu() {
        let appMenu = NSMenu(title: "Keel")
        item(appMenu, "About Keel", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
        appMenu.addItem(.separator())
        item(appMenu, "Reload", #selector(reloadPage(_:)), "r", target: self)
        appMenu.addItem(.separator())
        item(appMenu, "Hide Keel", #selector(NSApplication.hide(_:)), "h")
        item(appMenu, "Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
        item(appMenu, "Show All", #selector(NSApplication.unhideAllApplications(_:)))
        appMenu.addItem(.separator())
        item(appMenu, "Quit Keel", #selector(NSApplication.terminate(_:)), "q")

        // Text editing inside a WKWebView goes through these: without an Edit
        // menu, ⌘C/⌘V/⌘Z do nothing in the page's fields.
        let edit = NSMenu(title: "Edit")
        item(edit, "Undo", Selector(("undo:")), "z")
        item(edit, "Redo", Selector(("redo:")), "z", [.command, .shift])
        edit.addItem(.separator())
        item(edit, "Cut", #selector(NSText.cut(_:)), "x")
        item(edit, "Copy", #selector(NSText.copy(_:)), "c")
        item(edit, "Paste", #selector(NSText.paste(_:)), "v")
        item(edit, "Paste and Match Style", #selector(NSTextView.pasteAsPlainText(_:)), "v", [.command, .option, .shift])
        item(edit, "Delete", #selector(NSText.delete(_:)))
        item(edit, "Select All", #selector(NSText.selectAll(_:)), "a")

        let view = NSMenu(title: "View")
        item(view, "Actual Size", #selector(actualSize(_:)), "0", target: self)
        item(view, "Zoom In", #selector(zoomIn(_:)), "=", target: self)
        item(view, "Zoom Out", #selector(zoomOut(_:)), "-", target: self)

        let windowMenu = NSMenu(title: "Window")
        item(windowMenu, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
        item(windowMenu, "Zoom", #selector(NSWindow.performZoom(_:)))
        windowMenu.addItem(.separator())
        item(windowMenu, "Bring All to Front", #selector(NSApplication.arrangeInFront(_:)))

        let bar = NSMenu()
        for menu in [appMenu, edit, view, windowMenu] {
            let top = NSMenuItem(title: menu.title, action: nil, keyEquivalent: "")
            top.submenu = menu
            bar.addItem(top)
        }
        NSApp.mainMenu = bar
        NSApp.windowsMenu = windowMenu
    }

    @discardableResult
    private func item(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String = "",
                      _ modifiers: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = target
        return item
    }

    /// reloadFromOrigin, never reload: reload() revalidates and happily reuses
    /// a cached app.js, which is how a ⌘R after a deploy kept showing the old UI.
    /// If nothing ever loaded (the first load failed) there is nothing to
    /// reload, so load the server instead.
    @objc private func reloadPage(_ sender: Any?) {
        if web.backForwardList.currentItem == nil {
            web.load(URLRequest(url: server.url))
        } else {
            web.reloadFromOrigin()
        }
    }

    @objc private func actualSize(_ sender: Any?) { web.pageZoom = 1 }
    @objc private func zoomIn(_ sender: Any?) { setZoom(web.pageZoom + 0.1) }
    @objc private func zoomOut(_ sender: Any?) { setZoom(web.pageZoom - 0.1) }
    private func setZoom(_ zoom: CGFloat) { web.pageZoom = min(2, max(0.5, (zoom * 10).rounded() / 10)) }

    // MARK: Navigation: loads, failures, links

    private var failures = 0
    private var alertUp = false
    private var lastCrash = Date.distantPast

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        failures = 0
        Log.write("loaded \(display(webView.url))")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: any Error) {
        navigationFailed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        navigationFailed(error)
    }

    /// In a sibling app both failure callbacks once swallowed the error, so a window
    /// that would not load said nothing, on screen or in the log. Now: log the
    /// exact error, retry once after 2 s, then say so.
    private func navigationFailed(_ error: any Error) {
        let e = error as NSError
        let failed = e.userInfo[NSURLErrorFailingURLErrorKey] as? URL
        Log.write("load failed: \(display(failed)) — \(e.localizedDescription) [\(e.domain) \(e.code)]")
        // Replaced by a newer load, or stopped by our own policy (a link sent
        // outside, a keel:// URL): nothing is actually broken.
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return }
        // Only failing to reach the Keel server itself is "Can't reach Keel".
        if let host = failed?.host, !server.owns(host) { return }

        let target = failed ?? server.url
        failures += 1
        if failures == 1 {
            Log.write("retrying in 2s")
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(2))
                self?.web.load(URLRequest(url: target))
            }
            return
        }
        failures = 0
        showUnreachable(target, e)
    }

    private func showUnreachable(_ url: URL, _ error: NSError) {
        guard !alertUp else { return }
        alertUp = true
        Log.write("can't reach \(display(url)) after a retry — showing the alert")
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Can't reach Keel"
        alert.informativeText = "\(display(url))\n\(error.localizedDescription)\n\n"
            + "Press ⌘R to try again. Details are in \(Log.displayPath)."
        alert.beginSheetModal(for: sheetWindow) { [weak self] _ in self?.alertUp = false }
    }

    /// The page's process can die (memory pressure, a WebKit crash). Without
    /// this the window just goes blank — and dark, since it draws no background.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let again = Date().timeIntervalSince(lastCrash) < 10
        lastCrash = Date()
        Log.write("web content process ended" + (again ? " again within 10s — not reloading" : " — reloading"))
        if !again { reloadPage(nil) }
    }

    /* Links open OUTSIDE the app. A page asks its UI delegate for a new web view
       when it calls window.open or a target=_blank link is clicked; with no
       answer the click just dies. So the URL goes to the system — the browser
       for another site, Mail for mailto:, Claude and Obsidian for theirs — and
       the answer is nil. The policy check does the same for a plain link that
       would leave the server, so a link in an issue can never replace the app
       with some other web page. (seen in a sibling app) */
    private var lastOpened: (url: URL, at: Date)?

    private func openOutside(_ url: URL) {
        // a target=_blank click can arrive through both delegates: open it once
        if let last = lastOpened, last.url == url, Date().timeIntervalSince(last.at) < 1 { return }
        lastOpened = (url, Date())
        Log.write("open outside: \(url.absoluteString)")
        NSWorkspace.shared.open(url)
    }

    private func leavesTheApp(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "http" || scheme == "https" { return !server.owns(url.host) }
        return ["mailto", "claude", "obsidian"].contains(scheme)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, leavesTheApp(url) { openOutside(url) }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.allow) }
        // Sign-in comes back through ASWebAuthenticationSession, never the page.
        // (The URL is not logged: it may carry a sign-in code.)
        if url.scheme?.lowercased() == "keel" {
            Log.write("ignored a keel:// navigation inside the page")
            return decisionHandler(.cancel)
        }
        if navigationAction.targetFrame == nil || navigationAction.navigationType == .linkActivated,
           leavesTheApp(url) {
            openOutside(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    /// A URL as the log and the alert show it, with any sign-in `code` blanked:
    /// logs get pasted into chats.
    private func display(_ url: URL?) -> String {
        guard let url else { return "(no URL)" }
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = parts.queryItems, items.contains(where: { $0.name == "code" }) else {
            return url.absoluteString
        }
        parts.queryItems = items.map { $0.name == "code" ? URLQueryItem(name: "code", value: "redacted") : $0 }
        return parts.string ?? url.absoluteString
    }

    // MARK: Bridge: window.webkit.messageHandlers.keel.postMessage({action, …})

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        // Only the Keel page itself may drive the shell, never a frame from elsewhere.
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, server.owns(origin.host) else {
            Log.write("bridge: ignored a message from \(origin.protocol)://\(origin.host)"
                      + (message.frameInfo.isMainFrame ? "" : " (a subframe)"))
            return
        }
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else {
            Log.write("bridge: ignored a message with no \"action\"")
            return
        }
        switch action {
        case "signIn":
            startSignIn()
        case "copy":
            guard let text = body["text"] as? String else {
                Log.write("bridge: copy with no \"text\" — ignored")
                return
            }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        default:
            Log.write("bridge: unknown action \"\(action.prefix(80))\" — ignored")
        }
    }

    // MARK: Sign-in (Google, through the system's web authentication session)

    private var authSession: ASWebAuthenticationSession?
    private var authID = UUID()
    private var authStarted = Date()

    /// Opens <server>/auth/google?client=mac in the system's authentication
    /// session. Google refuses to sign in inside an embedded web view, and the
    /// session shares the browser's cookies, so a teammate already signed in
    /// to Google just picks an account. The server ends by redirecting to
    /// keel://auth?code=…, which the session hands back here.
    private func startSignIn() {
        if let running = authSession {
            // A session whose browser tab was simply closed may never call back.
            // A new request replaces it rather than being refused forever.
            Log.write("sign-in: replacing the one still in progress")
            authSession = nil
            running.cancel()
        }
        let id = UUID()
        authID = id
        authStarted = Date()
        let url = server.endpoint("/auth/google", "client", "mac")
        // The handler's thread is not promised, so it hops to the main actor itself.
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "keel") { @Sendable callback, error in
            Task { @MainActor in self.finishSignIn(id, callback, error) }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false   // reuse the browser's Google login
        authSession = session
        Log.write("sign-in: start \(url.absoluteString)")
        if !session.start() {
            authSession = nil
            Log.write("sign-in: start() returned false — nothing was shown")
            signInFailed("Couldn't open the sign-in window.")
        }
    }

    private func finishSignIn(_ id: UUID, _ callback: URL?, _ error: (any Error)?) {
        guard id == authID else { return }   // a session that was already replaced
        authSession = nil
        let elapsed = String(format: "%.1fs", Date().timeIntervalSince(authStarted))

        if let error {
            if let auth = error as? ASWebAuthenticationSessionError, auth.code == .canceledLogin {
                Log.write("sign-in: canceled after \(elapsed)")
                signInFailed("canceled")
            } else {
                let e = error as NSError
                Log.write("sign-in: error after \(elapsed) — \(e.localizedDescription) [\(e.domain) \(e.code)]")
                signInFailed(e.localizedDescription)
            }
            return
        }

        let items = callback.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems } ?? []
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
            let reason = items.first(where: { $0.name == "error" })?.value ?? "The sign-in reply had no code."
            Log.write("sign-in: no code after \(elapsed) — \(reason)")
            signInFailed(reason)
            return
        }
        Log.write("sign-in: finished in \(elapsed) — exchanging the code")
        web.load(URLRequest(url: server.endpoint("/auth/exchange", "code", code)))
        showWindow()
    }

    /// Tells the page, which may be showing "Signing in…". The reason goes
    /// through JSON so no quote or newline in an error message can break the script.
    private func signInFailed(_ reason: String) {
        let literal = (try? JSONEncoder().encode(reason)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"error\""
        web.evaluateJavaScript("window.keelSignInFailed && window.keelSignInFailed(\(literal))",
                               completionHandler: nil)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        sheetWindow
    }

    // MARK: Panels the page asks for
    //
    // WKWebView draws no alert(), confirm(), prompt() or file picker of its own;
    // the host app must. Without these, confirm() silently returns false and
    // every "Delete?" quietly does nothing (seen in a sibling app).

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: sheetWindow) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: sheetWindow) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: sheetWindow) { response in
            completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }

    /// `<input type="file">` — without this, clicking it does nothing at all.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: sheetWindow) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }
}

// MARK: - One copy, always

/* This runs first, before NSApplication or any window exists. A second copy
   would be a second window, a second signed-in session and a second set of
   polls against the server. LaunchServices refuses to open an app that is
   already open, but only for Spotlight, Finder and the Dock — `open -n`, a
   direct exec and an Xcode run walk straight past it. So: another live
   process under our bundle id → raise it and exit.

   A one-shot `--flag` launch (none exist yet; any added later is exempt for
   free) may run beside the live app. `--server <url>` is NOT one of those —
   it only says where a normal launch points, so it gets the check. */
let isOneShotLaunch = CommandLine.arguments.dropFirst().contains { $0.hasPrefix("--") && $0 != "--server" }
if !isOneShotLaunch, let mine = Bundle.main.bundleIdentifier {
    let mypid = ProcessInfo.processInfo.processIdentifier
    if let first = NSRunningApplication.runningApplications(withBundleIdentifier: mine)
        .first(where: { $0.processIdentifier != mypid && !$0.isTerminated }) {
        Log.write("another copy is running (pid \(first.processIdentifier)) — raising it and exiting")
        Log.flush()
        first.activate(options: [.activateAllWindows]); exit(0)
    }
}

guard let server = Server.resolve() else {
    // A bundle built without --server, and no override given: nothing to load.
    Log.write("no server: Info.plist has no ServerURL and neither --server nor KEEL_SERVER was given")
    Log.flush()
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let alert = NSAlert()
    alert.messageText = "No server configured"
    alert.informativeText = "Build the app with  bash mac/build-app.sh --server https://your.tracker  or launch it with --server <url>."
    alert.runModal()
    exit(1)
}
let delegate = AppDelegate(server: server)
let app = NSApplication.shared
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
