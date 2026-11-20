import UIKit
import WebKit

/// Contenedor de la interfaz web de NSound. No guarda audio ni vídeo en disco y no modifica la web: solo la carga, mantiene la sesión
/// de audio y hace de puente (`window.webkit.messageHandlers.nsoundAudio`) con la pantalla de bloqueo.
final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {

    private static let defaultsKey = "nsound.startURL"
    private static let fallbackKey = "nsound.fallbackURL"     // segunda dirección (p. ej. tu PC en casa) si la principal (la nube) no responde
    private static let handlerName = "nsoundAudio"

    private var webView: WKWebView!
    private let nowPlaying = NowPlayingBridge()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let addressButton = UIButton(type: .system)
    private var startURL: URL?
    private var fallbackURL: URL?
    private var triedFallback = false
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

        // Botón siempre visible cuando no hay nada cargado (sin dirección o con error): evita una pantalla negra sin salida
        addressButton.setTitle("Escribir la dirección de NSound", for: .normal)
        addressButton.setTitleColor(.white, for: .normal)
        addressButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        addressButton.backgroundColor = UIColor(white: 1, alpha: 0.14)
        addressButton.layer.cornerRadius = 12
        addressButton.contentEdgeInsets = UIEdgeInsets(top: 12, left: 20, bottom: 12, right: 20)
        addressButton.translatesAutoresizingMaskIntoConstraints = false
        addressButton.isHidden = true
        addressButton.addTarget(self, action: #selector(addressButtonTapped), for: .touchUpInside)
        view.addSubview(addressButton)
        NSLayoutConstraint.activate([addressButton.centerXAnchor.constraint(equalTo: view.centerXAnchor), addressButton.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 40)])

        nowPlaying.onCommand = { [weak self] command in self?.sendToWeb(command: command) }
        observer = NotificationCenter.default.addObserver(forName: AppDelegate.audioSessionReactivated, object: nil, queue: .main) { [weak self] _ in
            self?.lifecycle("foreground")
        }
        if let saved = UserDefaults.standard.string(forKey: ViewController.fallbackKey) { fallbackURL = validated(saved) }
        if let url = resolveStartURL() { load(url) } else { addressButton.isHidden = false }   // el cuadro se presenta en viewDidAppear (aquí la vista aún no está en pantalla)
    }

    @objc private func addressButtonTapped() { askForAddress(message: "Escribe la dirección de tu NSound (por ejemplo https://tu-servidor/).") }

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

        // Segundo plano: eq.js (el mismo de la app de iPhone actual) se inyecta en TODOS los marcos y, en el de YouTube, le dice al reproductor que la
        // página sigue «visible» y descarta los avisos de visibilidad. Sin esto YouTube se pausa solo al salir de la app o bloquear.
        if let eqURL = Bundle.main.url(forResource: "eq", withExtension: "js"), let eqJS = try? String(contentsOf: eqURL, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: eqJS, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }
        if diagnosticsEnabled {
            // Solo observa (no cambia nada): guarda errores de la página y el estado de sus peticiones para «Ver diagnóstico» (agitar el teléfono)
            let diag = "(function(){var d=window.__nsoundDiag={errors:[],fetches:[]};var push=function(a,v){a.push(v);if(a.length>25)a.shift()};"
                + "window.addEventListener('error',function(e){push(d.errors,String(e.message)+' @'+e.lineno)});"
                + "window.addEventListener('unhandledrejection',function(e){push(d.errors,'promesa: '+String(e.reason))});"
                + "var of=window.fetch;if(of){window.fetch=function(u){var s=String((u&&u.url)||u).slice(0,90);return of.apply(this,arguments).then(function(r){push(d.fetches,r.status+' '+s);return r},function(e){push(d.fetches,'ERR '+s+' '+e);throw e})}}})();"
            controller.addUserScript(WKUserScript(source: diag, injectionTime: .atDocumentStart, forMainFrameOnly: true))
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

    private var diagnosticsEnabled: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "NSoundDiagnostics") as? Bool) ?? true
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
        addressButton.isHidden = true
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
            field.text = UserDefaults.standard.string(forKey: ViewController.defaultsKey) ?? self.startURL?.absoluteString
        }
        alert.addTextField { field in
            field.placeholder = "Alternativa si la primera falla (opcional)"
            field.keyboardType = .URL
            field.autocapitalizationType = .none
            field.autocorrectionType = .no
            field.text = UserDefaults.standard.string(forKey: ViewController.fallbackKey)
        }
        alert.addAction(UIAlertAction(title: "Abrir", style: .default) { [weak self, weak alert] _ in
            guard let self, let text = alert?.textFields?.first?.text else { return }
            if let url = self.validated(text) {
                UserDefaults.standard.set(url.absoluteString, forKey: ViewController.defaultsKey)
                let second = alert?.textFields?.dropFirst().first?.text ?? ""
                if let fb = self.validated(second) {
                    UserDefaults.standard.set(fb.absoluteString, forKey: ViewController.fallbackKey); self.fallbackURL = fb
                } else {
                    UserDefaults.standard.removeObject(forKey: ViewController.fallbackKey); self.fallbackURL = nil
                }
                self.triedFallback = false
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
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
        if startURL == nil && presentedViewController == nil {
            askForAddress(message: "Escribe la dirección de tu NSound (por ejemplo https://tu-servidor/).")
        }
    }
    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        guard motion == .motionShake, presentedViewController == nil else { return }
        let menu = UIAlertController(title: "NSound", message: nil, preferredStyle: .alert)
        menu.addAction(UIAlertAction(title: "Cambiar dirección", style: .default) { [weak self] _ in self?.askForAddress(message: "Cambiar la dirección de NSound.") })
        menu.addAction(UIAlertAction(title: "Ver diagnóstico", style: .default) { [weak self] _ in self?.showDiagnostics() })
        menu.addAction(UIAlertAction(title: "Recargar", style: .default) { [weak self] _ in if let url = self?.startURL { self?.load(url) } })
        menu.addAction(UIAlertAction(title: "Cancelar", style: .cancel))
        present(menu, animated: true)
    }

    /// Resumen para depurar sin Mac: página, errores, peticiones, estado del modo experimental y del puente.
    private func showDiagnostics() {
        let js = "JSON.stringify({url:location.href,cookie:document.cookie.length>0,platform:(window.LS&&LS.Native&&LS.Native.platform)||null,flags:[window.NSOUND_WRAPPER?1:0,window.ENABLE_EXPERIMENTAL_PLAYER?1:0,window.__LS_ENGINES__?1:0],yt:!!(window.YT&&YT.Player),"
            + "diag:window.__nsoundDiag||null,exp:(window.NSoundExperimental&&NSoundExperimental.debug)?NSoundExperimental.debug():null,bridge:!!window.NSoundNativeBridge})"
        webView.evaluateJavaScript(js) { [weak self] result, error in
            var web = (result as? String) ?? "Sin respuesta de la página: \(error?.localizedDescription ?? "la web no cargó")"
            if web.count > 1300 { web = String(web.prefix(1300)) + "…" }
            let text = "NATIVO\n" + DiagLog.recent(25).joined(separator: "\n") + "\nahora: " + DiagLog.audioState() + "\n\nWEB\n" + web
            let alert = UIAlertController(title: "Diagnóstico", message: text, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Copiar", style: .default) { _ in UIPasteboard.general.string = text })
            alert.addAction(UIAlertAction(title: "Cerrar", style: .cancel))
            self?.present(alert, animated: true)
        }
    }

    // MARK: - Ciclo de vida (lo llama SceneDelegate)

    /// "background", "foreground" o "active". La web reenvía su estado al volver y la sesión de audio se mantiene activa.
    func lifecycle(_ event: String) {
        guard isViewLoaded, webView != nil else { return }
        let js = "window.NSoundNativeBridge && window.NSoundNativeBridge.onLifecycle(\(jsString(event)))"
        webView.evaluateJavaScript(js, completionHandler: nil)
        if event != "foreground" { resumeBursts() }
    }

    /// Al salir de la app, bloquear o volver, iOS puede pausar el vídeo de YouTube de la web. Se pide reanudar varias veces en los
    /// primeros segundos (la web solo lo hace si sonaba y el usuario no la pausó).
    private var burstToken = 0
    private func resumeBursts() {
        DiagLog.add("pide reanudar (ráfaga de 9)")
        burstToken += 1
        let token = burstToken
        for delay in [0.1, 0.25, 0.4, 0.6, 0.9, 1.3, 2.0, 3.0, 5.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self, self.burstToken == token else { return }
                self.sendToWeb(command: ["cmd": "resume"])
            }
        }
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

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { spinner.stopAnimating(); triedFallback = false }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }

    private func navigationFailed(_ error: Error) {
        spinner.stopAnimating()
        if (error as NSError).code == NSURLErrorCancelled { return }
        if let fb = fallbackURL, !triedFallback, startURL != fb {            // la principal no responde: se prueba la alternativa
            triedFallback = true; load(fb); return
        }
        addressButton.isHidden = false
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "No se pudo abrir NSound", message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Reintentar", style: .default) { [weak self] _ in if let url = self?.startURL { self?.load(url) } })
        alert.addAction(UIAlertAction(title: "Cambiar dirección", style: .default) { [weak self] _ in self?.askForAddress(message: "Escribe la dirección de tu NSound.") })
        present(alert, animated: true)
    }

    /// Si iOS cierra el proceso de la web por falta de memoria, se vuelve a cargar.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        DiagLog.add("¡iOS cerró el proceso de la web! se recarga")
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
