import Foundation
import AVFoundation

/// Mantiene viva la app en segundo plano con un silencio nativo en bucle (se genera en memoria; no se guarda nada en disco).
/// Motivo: cuando iOS pausa el reproductor de YouTube de la web, la app se queda sin audio y el sistema la suspende a los pocos
/// segundos, así que ni las órdenes de reanudar ni los botones de la pantalla de bloqueo llegan. Con este silencio activo la app
/// sigue ejecutándose y la reanudación puede llegar. Solo suena (en silencio) mientras la app está en segundo plano y la música
/// estaba sonando; se para al volver a primer plano, si el usuario pausa o tras un tope de tiempo.
final class SilentKeeper {
    private var player: AVAudioPlayer?
    private var token = 0
    private let maxSeconds: Double = 30 * 60

    var isActive: Bool { player?.isPlaying == true }

    func start() {
        guard !isActive else { return }
        AppDelegate.activateAudioSession()
        if player == nil { player = SilentKeeper.makePlayer() }
        guard let player else { DiagLog.add("silencio nativo: no se pudo crear"); return }
        player.numberOfLoops = -1
        player.volume = 1
        let ok = player.play()
        DiagLog.add("silencio nativo: " + (ok ? "activo" : "no arrancó"))
        token += 1
        let mine = token
        DispatchQueue.main.asyncAfter(deadline: .now() + maxSeconds) { [weak self] in
            guard let self, self.token == mine else { return }
            self.stop()
        }
    }

    func stop() {
        guard let player, player.isPlaying else { return }
        player.stop()
        token += 1
        DiagLog.add("silencio nativo: parado")
    }

    /// 1 s de silencio, PCM de 8 bits, mono, 8 kHz (el valor 128 es el cero de este formato).
    private static func makePlayer() -> AVAudioPlayer? {
        let sampleRate: UInt32 = 8000
        let samples = Data(repeating: 128, count: Int(sampleRate))
        var wav = Data()
        func append32(_ v: UInt32) { var x = v.littleEndian; withUnsafeBytes(of: &x) { wav.append(contentsOf: $0) } }
        func append16(_ v: UInt16) { var x = v.littleEndian; withUnsafeBytes(of: &x) { wav.append(contentsOf: $0) } }
        wav.append(contentsOf: Array("RIFF".utf8)); append32(36 + UInt32(samples.count))
        wav.append(contentsOf: Array("WAVE".utf8)); wav.append(contentsOf: Array("fmt ".utf8))
        append32(16); append16(1); append16(1); append32(sampleRate); append32(sampleRate); append16(1); append16(8)
        wav.append(contentsOf: Array("data".utf8)); append32(UInt32(samples.count))
        wav.append(samples)
        let p = try? AVAudioPlayer(data: wav, fileTypeHint: AVFileType.wav.rawValue)
        p?.prepareToPlay()
        return p
    }
}
