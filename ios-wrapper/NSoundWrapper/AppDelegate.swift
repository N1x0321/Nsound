import UIKit
import AVFoundation

/// Arranque de la app y sesión de audio. La categoría `.playback` junto con `UIBackgroundModes → audio` (Info.plist) permite que el
/// sonido siga con la pantalla bloqueada o en otra app.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    /// Se avisa a la pantalla principal de cada cambio de ciclo de vida (para que la web reenvíe su estado).
    static let audioSessionReactivated = Notification.Name("nsound.audioSessionReactivated")

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        DiagLog.add("inicio de la app · " + DiagLog.audioState())
        AppDelegate.activateAudioSession()
        observeAudioSession()
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    /// Categoría de reproducción y sesión activa. Se puede llamar las veces que haga falta.
    @discardableResult
    static func activateAudioSession() -> Bool {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
            return true
        } catch {
            NSLog("NSoundWrapper: no se pudo activar la sesión de audio: \(error.localizedDescription)")
            return false
        }
    }

    private var observers: [NSObjectProtocol] = []

    /// Interrupciones (llamada, Siri, alarma) y cambios de la salida (AirPods, altavoz): se reactiva la sesión al terminar.
    private func observeAudioSession() {
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let kind = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            DiagLog.add("interrupción de audio: " + (kind == .began ? "empieza" : "termina"))
            guard kind == .ended else { return }
            AppDelegate.activateAudioSession()
            NotificationCenter.default.post(name: AppDelegate.audioSessionReactivated, object: nil)
        })
        observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0
            DiagLog.add("cambio de salida de audio (motivo \(reason)) · " + DiagLog.audioState())
        })
        observers.append(nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { _ in
            AppDelegate.activateAudioSession()
            NotificationCenter.default.post(name: AppDelegate.audioSessionReactivated, object: nil)
        })
    }
}
