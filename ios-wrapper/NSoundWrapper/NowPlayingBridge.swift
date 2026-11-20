import Foundation
import MediaPlayer
import UIKit

/// Pantalla de bloqueo y Centro de control: título, artista, carátula, barra de tiempo y botones. Los datos los manda la web
/// (mensaje `nowPlaying` / `state`); los botones vuelven a la web como órdenes. No guarda ni descarga audio: solo la carátula.
final class NowPlayingBridge {
    /// Se llama con ["cmd": "play" | "pause" | "toggle" | "next" | "previous" | "seek", "position": segundos].
    var onCommand: (([String: Any]) -> Void)?

    private var info: [String: Any] = [:]
    private var configured = false
    private var playing = false
    private var artworkURL = ""
    private var artworkObject: MPMediaItemArtwork?
    private var artworkTask: URLSessionDataTask?
    private var targets: [(MPRemoteCommand, Any)] = []

    /// Los comandos se registran la primera vez que llegan datos de la web: si la web no usa el puente, no se toca nada del sistema.
    private func configureCommands() {
        guard !configured else { return }
        configured = true
        let c = MPRemoteCommandCenter.shared()
        func add(_ command: MPRemoteCommand, _ handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
            command.isEnabled = true
            targets.append((command, command.addTarget(handler: handler)))
        }
        add(c.playCommand) { [weak self] _ in self?.send(["cmd": "play"]); return .success }
        add(c.pauseCommand) { [weak self] _ in self?.send(["cmd": "pause"]); return .success }
        add(c.togglePlayPauseCommand) { [weak self] _ in self?.send(["cmd": "toggle"]); return .success }
        add(c.nextTrackCommand) { [weak self] _ in self?.send(["cmd": "next"]); return .success }
        add(c.previousTrackCommand) { [weak self] _ in self?.send(["cmd": "previous"]); return .success }
        add(c.changePlaybackPositionCommand) { [weak self] event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.send(["cmd": "seek", "position": e.positionTime]); return .success
        }
        c.skipForwardCommand.isEnabled = false
        c.skipBackwardCommand.isEnabled = false
    }

    private func send(_ command: [String: Any]) {
        DispatchQueue.main.async { [weak self] in self?.onCommand?(command) }
    }

    func update(title: String, artist: String, album: String, artwork: String, duration: Double, position: Double, playing: Bool) {
        configureCommands()
        self.playing = playing
        var next: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: max(0, position),
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
        ]
        if !album.isEmpty { next[MPMediaItemPropertyAlbumTitle] = album }
        if duration > 0 { next[MPMediaItemPropertyPlaybackDuration] = duration }
        if artwork == artworkURL, let art = artworkObject { next[MPMediaItemPropertyArtwork] = art }
        info = next
        publish()
        loadArtwork(artwork)
    }

    func updateState(position: Double, duration: Double, playing: Bool) {
        guard !info.isEmpty else { return }
        self.playing = playing
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = max(0, position)
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        publish()
    }

    func clear() {
        info = [:]; artworkURL = ""; artworkObject = nil; artworkTask?.cancel()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped
    }

    private func publish() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
    }

    /// Solo se descargan carátulas de los servidores de imágenes de YouTube/Google, por https y con un tope de tamaño.
    private func loadArtwork(_ s: String) {
        guard s != artworkURL else { return }
        artworkURL = s; artworkObject = nil; artworkTask?.cancel()
        guard let url = URL(string: s), url.scheme == "https", let host = url.host?.lowercased(),
              ["ytimg.com", "googleusercontent.com", "ggpht.com"].contains(where: { host == $0 || host.hasSuffix("." + $0) }) else { return }
        artworkTask = URLSession.shared.dataTask(with: URLRequest(url: url, timeoutInterval: 15)) { [weak self] data, _, _ in
            guard let data, data.count < 3_000_000, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, self.artworkURL == s else { return }
                let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.artworkObject = art
                self.info[MPMediaItemPropertyArtwork] = art
                self.publish()
            }
        }
        artworkTask?.resume()
    }

    deinit {
        for (command, target) in targets { command.removeTarget(target) }
    }
}
