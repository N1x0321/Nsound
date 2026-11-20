import Foundation
import AVFoundation

/// Registro nativo para depurar sin Mac: sobrevive a las recargas de la web (que reinician el registro de la página) y a cerrar la app.
/// Solo guarda eventos del sistema (segundo plano, interrupciones de audio, cierre del proceso web); nada de contenido.
enum DiagLog {
    private static let key = "nsound.nativeLog"
    private static let maxLines = 60
    private static let queue = DispatchQueue(label: "nsound.diaglog")
    private static let formatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "HH:mm:ss"; return f
    }()

    static func add(_ text: String) {
        let line = formatter.string(from: Date()) + " " + text
        queue.sync {
            var lines = UserDefaults.standard.stringArray(forKey: key) ?? []
            lines.append(line)
            if lines.count > maxLines { lines.removeFirst(lines.count - maxLines) }
            UserDefaults.standard.set(lines, forKey: key)
        }
    }

    static func recent(_ count: Int) -> [String] {
        queue.sync { Array((UserDefaults.standard.stringArray(forKey: key) ?? []).suffix(count)) }
    }

    /// Estado de la sesión de audio en este instante (¿hay otra app sonando?, ¿qué salida?).
    static func audioState() -> String {
        let s = AVAudioSession.sharedInstance()
        let out = s.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ",")
        return "cat=\(s.category.rawValue) otroAudio=\(s.isOtherAudioPlaying) salida=\(out.isEmpty ? "ninguna" : out)"
    }
}
