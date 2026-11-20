import UIKit
import WebKit

/// Contenedor de la interfaz web de NSound. No guarda audio ni vídeo en disco y no modifica la web: solo la carga, mantiene la sesión
/// de audio y hace de puente (`window.webkit.messageHandlers.nsoundAudio`) con la pantalla de bloqueo.
final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {

    private static let defaultsKey = "nsound.startURL"
    private static let handlerName = "nsoundAudio"

    private var webView: WKWebView!
    private let nowPlaying = NowPlayingBridge()
    private let spinner = UIActivityIndicatorView(style: .large)
    private var startURL: URL?
    private var observer: NSObjectProtocol?

    // MARK: - Ciclo de vida de la vista

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.07, green: 0.07, blue: 0.08, alpha: 1)
        buildWebView()
        spinner.color = .white
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)
        NSLayoutConstraint.activate([spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor), spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)])

        nowPlaying.onCommand = { [weak self] command in self?.sendToWeb(command: command) }
        observer = NotificationCenter.default.addObserver(forName: AppDelegate.audioSessionReactivated, object: nil, queue: .main) { [weak self] _ in
            self?.lifecycle("foreground")
        }
        if let url = resolveStartURL() { load(url) } else { askForAddress(message: "Escribe la dirección de tu NSound (por ejemplo https://tu-servidor/).") }
    }

    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }

    override var prefersStatusBarHidden: Bool { false }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: - WebView

    private func buildWebView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsPictureInPictureMediaPlayback = true

        let controller = config.userContentController
        controller.add(WeakScriptHandler(self), name: ViewController.handlerName)
        if injectExperimentalFlags {
            // Marca para la web: solo existe dentro de este contenedor (la web publicada no la tiene).
            let js = "window.NSOUND_WRAPPER = { platform: 'ios', version: 1 }; window.ENABLE_EXPERIMENTAL_PLAYER = true; window.__LS_ENGINES__ = true;"
            controller.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = view.backgroundColor
        web.scrollView.backgroundColor = view.backgroundColor
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { web.isInspectable = true }       // Safari → Desarrollo → iPhone (solo si el Inspector web está activado)
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.topAnchor.constraint(equalTo: view.topAnchor), web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        webView = web
    }

    private var injectExperimentalFlags: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "NSoundInjectExperimentalFlags") as? Bool) ?? true
    }

    // MARK: - Dirección de NSound

    /// Primero la que escribió el usuario (se guarda en el iPhone) y si no, la de Info.plist (`NSoundStartURL`).
    private func resolveStartURL() -> URL? {
        if let saved = UserDefaults.standard.string(forKey: ViewController.defaultsKey), let url = validated(saved) { return url }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "NSoundStartURL") as? String, let url = validated(plist) { return url }
        return nil
    }

    /// https siempre; http solo para pruebas en la red local (localhost, .local o direcciones privadas).
    private func validated(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed), let host = url.host?.lowercased() else { return nil }
        if url.scheme == "https" { return url }
        guard url.scheme == "http" else { return nil }
        if host == "localhost" || host == "127.0.0.1" || host.hasSuffix(".local") || host.hasPrefix("192.168.") || host.hasPrefix("10.") { return url }
        if host.hasPrefix("172."), let second = Int(host.split(separator: ".").dropFirst().first ?? ""), (16...31).contains(second) { return url }
        return nil
    }

    private func load(_ url: URL) {
        startURL = url
        spinner.startAnimating()
        webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
    }

    private func askForAddress(message: String) {
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "Dirección de NSound", message: message, preferredStyle: .alert)
        alert.addTextField { field in
            field.placeholder = "https://…"
            field.keyboardType = .URL
            field.autocapitalizationType = .none
            field.autocorrectionType = .no
            field.text = self.startURL?.absoluteString ?? UserDefaults.standard.string(forKey: ViewController.defaultsKey)
        }
        alert.addAction(UIAlertAction(title: "Abrir", style: .default) { [weak self, weak alert] _ in
            guard let self, let text = alert?.textFields?.first?.text else { return }
            if let url = self.validated(text) {
                UserDefaults.standard.set(url.absoluteString, forKey: ViewController.defaultsKey)
                self.load(url)
            } else {
                self.askForAddress(message: "Dirección no válida. Usa https:// (http:// solo en tu red local).")
            }
        })
        if startURL != nil { alert.addAction(UIAlertAction(title: "Cancelar", style: .cancel)) }
        present(alert, animated: true)
    }

    /// Agitar el teléfono permite cambiar la dirección.
    override var canBecomeFirstResponder: Bool { true }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); becomeFirstResponder() }
    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake { askForAddress(message: "Cambiar la dirección de NSound.") }
    }

    // MARK: - Ciclo de vida (lo llama SceneDelegate)

    /// "background", "foreground" o "active". La web reenvía su estado al volver y la sesión de audio se mantiene activa.
    func lifecycle(_ event: String) {
        guard isViewLoaded, webView != nil else { return }
        let js = "window.NSoundNativeBridge && window.NSoundNativeBridge.onLifecycle(\(jsString(event)))"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - Puente web → nativo

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == ViewController.handlerName, let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        func number(_ key: String) -> Double { (body[key] as? NSNumber)?.doubleValue ?? 0 }
        switch type {
        case "nowPlaying":
            nowPlaying.update(title: body["title"] as? String ?? "", artist: body["artist"] as? String ?? "", album: body["album"] as? String ?? "",
                              artwork: body["artwork"] as? String ?? "", duration: number("duration"), position: number("position"),
                              playing: (body["playing"] as? Bool) ?? false)
        case "state":
            nowPlaying.updateState(position: number("position"), duration: number("duration"), playing: (body["playing"] as? Bool) ?? false)
        case "clear":
            nowPlaying.clear()
        case "ready":
            AppDelegate.activateAudioSession()
        default:
            break
        }
    }

    // MARK: - Puente nativo → web

    private func sendToWeb(command: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(command), let data = try? JSONSerialization.data(withJSONObject: command),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.NSoundNativeBridge && window.NSoundNativeBridge.onCommand(\(json))", completionHandler: nil)
    }

    private func jsString(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8)
        let arr = String(decoding: data, as: UTF8.self)
        return String(arr.dropFirst().dropLast())
    }

    // MARK: - Navegación

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { spinner.stopAnimating() }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }

    private func navigationFailed(_ error: Error) {
        spinner.stopAnimating()
        if (error as NSError).code == NSURLErrorCancelled { return }
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "No se pudo abrir NSound", message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Reintentar", style: .default) { [weak self] _ in if let url = self?.startURL { self?.load(url) } })
        alert.addAction(UIAlertAction(title: "Cambiar dirección", style: .default) { [weak self] _ in self?.askForAddress(message: "Escribe la dirección de tu NSound.") })
        present(alert, animated: true)
    }

    /// Si iOS cierra el proceso de la web por falta de memoria, se vuelve a cargar.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if let url = startURL { load(url) }
    }

    /// Dentro del mismo sitio se navega; los enlaces a otros sitios se abren en Safari. Los marcos (el reproductor de YouTube) siguen libres.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard navigationAction.targetFrame?.isMainFrame != false, let url = navigationAction.request.url else { decisionHandler(.allow); return }
        if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { decisionHandler(.allow); return }
        if let host = startURL?.host, url.host == host { decisionHandler(.allow); return }
        if navigationAction.navigationType == .other && navigationAction.targetFrame?.isMainFrame == true && startURL == nil { decisionHandler(.allow); return }
        if url.scheme == "https" || url.scheme == "http" { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }

    /// `window.open` / enlaces con target=_blank: a Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http" { UIApplication.shared.open(url) }
        return nil
    }
}

/// WKUserContentController retiene a su manejador: este intermediario débil evita que la pantalla nunca se libere.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
