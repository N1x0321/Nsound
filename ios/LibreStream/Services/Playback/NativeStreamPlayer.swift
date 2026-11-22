import Foundation
import AVFoundation
import MediaPlayer
import UIKit

/// Reproductor NATIVO para el audio propio («Mi servidor», Navidrome): AVQueuePlayer + AVAudioSession(.playback) +
/// MPRemoteCommandCenter + MPNowPlayingInfoCenter, con «Audio en segundo plano» (UIBackgroundModes → audio).
/// El WebView solo le manda la lista de pistas y recibe el estado: el sonido no depende de la página ni del reproductor de YouTube,
/// así que iOS no lo pausa al bloquear la pantalla o cambiar de app. Solo se usa en la app de pruebas «Motores».
final class NativeStreamPlayer: NSObject {

    struct Track {
        let id: String
        let url: URL
        let title: String
        let artist: String
        let album: String
        let artwork: URL?
        let duration: Double
    }

    /// Eventos hacia la interfaz: nativeState, nativeTrack, nativeEnded, nativeError y remote (play / pause pulsados fuera de la app).
    var onEvent: (([String: Any]) -> Void)?
    /// true mientras este reproductor tiene el mando de la sesión de audio y de la pantalla de bloqueo.
    private(set) var isActive = false

    private let player = AVQueuePlayer()
    private var tracks: [Track] = []
    private var index = 0
    private var repeatMode = "off"
    private var queued: [(item: AVPlayerItem, index: Int)] = []
    private var rebuilding = false
    private var observing = false
    private var commandsConfigured = false
    private var timeObserver: Any?
    private var currentItemObservation: NSKeyValueObservation?
    private var statusObservation: NSKeyValueObservation?
    private var notifications: [NSObjectProtocol] = []
    private var failedItem: AVPlayerItem?
    private var artworkURL: URL?
    private var artwork: MPMediaItemArtwork?
    private var artworkTask: URLSessionDataTask?

    // MARK: - Registro de tiempos (diagnóstico del hueco entre pistas)
    private let t0 = CACurrentMediaTime()
    private var endedAt: Double?
    private var itemBorn: [ObjectIdentifier: Double] = [:]
    private var itemObs: [ObjectIdentifier: NSKeyValueObservation] = [:]
    private static let logURL: URL? = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("nativo-tiempos.log")
    private func ms() -> Double { ((CACurrentMediaTime() - t0) * 1000).rounded() }
    /// Una línea por suceso: «[ms desde el arranque] texto». Sale por NSLog (Consola del Mac) y se guarda en Documentos/nativo-tiempos.log.
    private func log(_ text: String) {
        let line = "[\(Int(ms()))ms] \(text)"
        NSLog("NSOUND-NATIVO %@", line)
        guard let url = NativeStreamPlayer.logURL, let data = (line + "\n").data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(data); try? h.close() }
        else { try? data.write(to: url) }
    }

    override init() {
        super.init()
        player.automaticallyWaitsToMinimizeStalling = true
        player.actionAtItemEnd = .advance
    }

    // MARK: - API para la interfaz

    /// Carga la lista y empieza en `index`. Sustituye a lo que sonara antes.
    func load(tracks: [Track], index: Int, position: Double, repeatMode: String, autoplay: Bool) {
        guard !tracks.isEmpty, tracks.indices.contains(index) else { return }
        self.tracks = tracks
        self.index = index
        self.repeatMode = ["off", "all", "one"].contains(repeatMode) ? repeatMode : "off"
        log("LOAD pistas=\(tracks.count) index=\(index) pos=\(position) repeat=\(self.repeatMode)")
        activateSession()
        configureCommands()
        observe()
        isActive = true
        rebuild(at: position, play: autoplay)
    }

    func play() {
        guard isActive else { return }
        activateSession()
        player.play()
        updateNowPlaying()
        emitState()
    }

    func pause() {
        guard isActive else { return }
        player.pause()
        updateNowPlaying()
        emitState()
    }

    func seek(to seconds: Double) {
        guard isActive else { return }
        let target = CMTime(seconds: max(0, seconds), preferredTimescale: 600)
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            DispatchQueue.main.async {
                self?.updateNowPlaying()
                self?.emitState()
            }
        }
    }

    func setRepeat(_ mode: String) {
        guard isActive else { return }
        repeatMode = ["off", "all", "one"].contains(mode) ? mode : "off"
        player.actionAtItemEnd = repeatMode == "one" ? .none : .advance
        // La cola de espera depende del modo: se vuelve a calcular la pista siguiente (la actual no se toca)
        if let current = player.currentItem {
            let rest = player.items().filter { $0 !== current }
            rebuilding = true
            rest.forEach { player.remove($0) }
            queued = queued.filter { $0.item === current }
            rebuilding = false
            enqueueNext()
        }
    }

    func stop() {
        rebuilding = true
        player.pause()
        player.removeAllItems()
        queued.removeAll()
        itemObs.removeAll(); itemBorn.removeAll()
        rebuilding = false
        isActive = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped
    }

    func next() {
        guard isActive else { return }
        let n: Int? = index + 1 < tracks.count ? index + 1 : (repeatMode == "all" ? 0 : nil)
        guard let target = n else {                      // fin de la lista: se para, como con la cola de la app
            player.pause()
            updateNowPlaying()
            emitState()
            onEvent?(["type": "remote", "cmd": "pause"])
            return
        }
        index = target
        rebuild(at: 0, play: true)
    }

    func previous() {
        guard isActive else { return }
        if player.currentTime().seconds > 3 || (index == 0 && repeatMode != "all") { seek(to: 0); return }
        index = index > 0 ? index - 1 : tracks.count - 1
        rebuild(at: 0, play: true)
    }

    // MARK: - Cola

    private func rebuild(at position: Double, play: Bool) {
        rebuilding = true
        player.pause()
        player.removeAllItems()
        queued.removeAll()
        itemObs.removeAll(); itemBorn.removeAll()
        append(index)
        player.actionAtItemEnd = repeatMode == "one" ? .none : .advance
        if position > 0 {
            player.seek(to: CMTime(seconds: position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        }
        rebuilding = false
        enqueueNext()
        failedItem = nil
        if play { player.play() }
        updateNowPlaying()
        onEvent?(["type": "nativeTrack", "index": index])
        emitState()
    }

    private func append(_ i: Int) {
        guard tracks.indices.contains(i) else { return }
        let asset = AVURLAsset(url: tracks[i].url)
        asset.loadValuesAsynchronously(forKeys: ["playable", "duration"]) {}   // cabeceras y duración ya pedidas: al llegar su turno no hay espera
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = 30
        queued.append((item: item, index: i))
        let key = ObjectIdentifier(item)
        itemBorn[key] = ms()
        log("COLA pista=\(i) «\(tracks[i].title)» encolada")
        itemObs[key] = item.observe(\.status, options: [.new]) { [weak self] it, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                let born = self.itemBorn[key] ?? self.ms()
                let name = it.status == .readyToPlay ? "LISTA" : (it.status == .failed ? "FALLO \(it.error?.localizedDescription ?? "")" : "?")
                self.log("ITEM \(name) tras \(Int(self.ms() - born))ms desde encolada")
            }
        }
        player.insert(item, after: nil)
    }

    private func nextIndex(after i: Int) -> Int? {
        if repeatMode == "one" { return nil }
        if i + 1 < tracks.count { return i + 1 }
        return repeatMode == "all" ? 0 : nil
    }

    /// Mantiene siempre la pista siguiente ya cargada en la cola: el paso de una a otra no deja hueco.
    private func enqueueNext() {
        // Actual + dos por delante: la segunda ya va descargando mientras suena la primera
        var guardCount = 0
        while player.items().count < 3, guardCount < 3 {
            guardCount += 1
            let last = queued.last?.index ?? index
            guard let n = nextIndex(after: last) else { break }
            append(n)
        }
    }

    // MARK: - Observación

    private func observe() {
        guard !observing else { return }
        observing = true
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            self?.tick()
        }
        currentItemObservation = player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
            let handle: () -> Void = { self?.currentItemChanged() }
            if Thread.isMainThread { handle() } else { DispatchQueue.main.async(execute: handle) }
        }
        statusObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            DispatchQueue.main.async {
                let st = p.timeControlStatus == .playing ? "SONANDO" : (p.timeControlStatus == .paused ? "PAUSA" : "ESPERANDO(\(p.reasonForWaitingToPlay?.rawValue ?? "?"))")
                var extra = ""
                if p.timeControlStatus == .playing, let e = self?.endedAt, let n = self?.ms() { extra = "  ← HUECO desde fin de pista anterior: \(Int(n - e))ms"; self?.endedAt = nil }
                self?.log("ESTADO \(st)\(extra)")
                self?.updateNowPlaying()
                self?.emitState()
            }
        }
        let nc = NotificationCenter.default
        notifications.append(nc.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] note in
            self?.endedAt = self?.ms()
            self?.log("FIN de pista (DidPlayToEnd)")
            self?.itemEnded(note.object as? AVPlayerItem)
        })
        notifications.append(nc.addObserver(forName: .AVPlayerItemPlaybackStalled, object: nil, queue: .main) { [weak self] _ in
            self?.log("ATASCO (PlaybackStalled): se quedó sin datos")
        })
        notifications.append(nc.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: nil, queue: .main) { [weak self] note in
            guard let self = self, let item = note.object as? AVPlayerItem, self.queued.contains(where: { $0.item === item }) else { return }
            self.failed(item.error?.localizedDescription ?? "No se pudo leer el audio")
        })
        notifications.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let self = self, self.isActive,
                  let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let kind = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if kind == .ended {
                let opts = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt).map { AVAudioSession.InterruptionOptions(rawValue: $0) }
                self.activateSession()
                if opts?.contains(.shouldResume) == true { self.player.play() }
            }
            self.updateNowPlaying()
            self.emitState()
        })
        notifications.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            guard let self = self, self.isActive,
                  let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
            self.player.pause()                           // auriculares desconectados
            self.onEvent?(["type": "remote", "cmd": "pause"])
        })
    }

    private func currentItemChanged() {
        guard isActive, !rebuilding else { return }
        guard let item = player.currentItem else {      // se acabó la lista
            isActive = false
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            onEvent?(["type": "nativeEnded"])
            return
        }
        guard let entry = queued.first(where: { $0.item === item }) else { return }
        let ready = item.status == .readyToPlay
        let buf = item.loadedTimeRanges.first.map { Int(CMTimeGetSeconds($0.timeRangeValue.duration)) } ?? 0
        log("CAMBIO de pista → \(entry.index) lista=\(ready) búfer=\(buf)s")
        let alive = player.items()
        queued = queued.filter { q in alive.contains(where: { $0 === q.item }) }
        if entry.index != index {
            index = entry.index
            updateNowPlaying()
            onEvent?(["type": "nativeTrack", "index": index])
        }
        enqueueNext()
    }

    private func itemEnded(_ item: AVPlayerItem?) {
        guard isActive, let item = item, queued.contains(where: { $0.item === item }) else { return }
        if repeatMode == "one" {                        // repetir la canción: vuelve a empezar la misma
            player.seek(to: .zero)
            player.play()
            emitState()
        }
    }

    private func failed(_ message: String) {
        log("ERROR \(message)")
        onEvent?(["type": "nativeError", "message": message, "index": index])
    }

    private func tick() {
        guard isActive else { return }
        if let item = player.currentItem, item.status == .failed, failedItem !== item {
            failedItem = item
            failed(item.error?.localizedDescription ?? "No se pudo leer el audio")
        }
        emitState()
    }

    private func currentDuration() -> Double {
        if let d = player.currentItem?.duration.seconds, d.isFinite, d > 0 { return d }
        return tracks.indices.contains(index) ? tracks[index].duration : 0
    }

    private func emitState() {
        guard isActive else { return }
        let t = player.currentTime().seconds
        onEvent?(["type": "nativeState", "playing": player.timeControlStatus != .paused, "time": t.isFinite ? max(0, t) : 0, "duration": currentDuration()])
    }

    // MARK: - AVAudioSession

    private func activateSession() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default)
        try? s.setActive(true)
    }

    // MARK: - MPRemoteCommandCenter

    private func configureCommands() {
        guard !commandsConfigured else { return }
        commandsConfigured = true
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.isEnabled = true
        c.playCommand.addTarget { [weak self] _ in self?.command("play") ?? .commandFailed }
        c.pauseCommand.isEnabled = true
        c.pauseCommand.addTarget { [weak self] _ in self?.command("pause") ?? .commandFailed }
        c.togglePlayPauseCommand.isEnabled = true
        c.togglePlayPauseCommand.addTarget { [weak self] _ in self?.command("toggle") ?? .commandFailed }
        c.nextTrackCommand.isEnabled = true
        c.nextTrackCommand.addTarget { [weak self] _ in self?.command("next") ?? .commandFailed }
        c.previousTrackCommand.isEnabled = true
        c.previousTrackCommand.addTarget { [weak self] _ in self?.command("prev") ?? .commandFailed }
        c.changePlaybackPositionCommand.isEnabled = true
        c.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self = self, let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            guard self.isActive else { return .noActionableNowPlayingItem }
            let position = e.positionTime
            DispatchQueue.main.async { self.seek(to: position) }
            return .success
        }
    }

    private func command(_ name: String) -> MPRemoteCommandHandlerStatus {
        guard isActive else { return .noActionableNowPlayingItem }   // no es lo que suena: lo atiende quien corresponda
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.isActive else { return }
            switch name {
            case "play":
                self.play()
                self.onEvent?(["type": "remote", "cmd": "play"])
            case "pause":
                self.pause()
                self.onEvent?(["type": "remote", "cmd": "pause"])
            case "toggle":
                let cmd = self.player.timeControlStatus == .paused ? "play" : "pause"
                if cmd == "play" { self.play() } else { self.pause() }
                self.onEvent?(["type": "remote", "cmd": cmd])
            case "next": self.next()
            default: self.previous()
            }
        }
        return .success
    }

    // MARK: - MPNowPlayingInfoCenter

    private func updateNowPlaying() {
        guard isActive, tracks.indices.contains(index) else { return }
        let t = tracks[index]
        let elapsed = player.currentTime().seconds
        let paused = player.timeControlStatus == .paused
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: t.title,
            MPMediaItemPropertyArtist: t.artist,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed.isFinite ? max(0, elapsed) : 0,
            MPNowPlayingInfoPropertyPlaybackRate: paused ? 0.0 : 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        if !t.album.isEmpty { info[MPMediaItemPropertyAlbumTitle] = t.album }
        let d = currentDuration()
        if d > 0 { info[MPMediaItemPropertyPlaybackDuration] = d }
        if let art = artwork, artworkURL == t.artwork { info[MPMediaItemPropertyArtwork] = art }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = paused ? .paused : .playing
        loadArtwork(t.artwork)
    }

    /// Solo se descarga la carátula que la interfaz envía desde el propio servidor de Nsound (se comprueba antes de crear la pista).
    private func loadArtwork(_ url: URL?) {
        if url == artworkURL { return }
        artworkURL = url
        artwork = nil
        artworkTask?.cancel()
        guard let url = url else { return }
        artworkTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self = self, let data = data, data.count < 3_000_000, let image = UIImage(data: data) else { return }
            let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                guard self.artworkURL == url else { return }
                self.artwork = art
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = art
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
        artworkTask?.resume()
    }
}
