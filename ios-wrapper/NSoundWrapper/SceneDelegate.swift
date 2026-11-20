import UIKit

/// Ventana única con la pantalla principal. Reenvía el ciclo de vida para que el audio no se suspenda y la web se entere.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private let controller = ViewController()

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = controller
        window.backgroundColor = UIColor(red: 0.07, green: 0.07, blue: 0.08, alpha: 1)
        window.makeKeyAndVisible()
        self.window = window
    }

    func sceneWillResignActive(_ scene: UIScene) {
        controller.lifecycle("inactive")
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        AppDelegate.activateAudioSession()
        controller.lifecycle("background")
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        AppDelegate.activateAudioSession()
        controller.lifecycle("foreground")
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        AppDelegate.activateAudioSession()
        controller.lifecycle("active")
    }
}
