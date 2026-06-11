import Foundation
import AVFoundation
import Capacitor
import MediaPlayer

@objc(CodexAudioSessionPlugin)
public class CodexAudioSessionPlugin: CAPPlugin {
    private var silentKeepAlivePlayer: AVAudioPlayer?
    private var voiceAudioPlayer: AVAudioPlayer?
    private var voiceAudioFileURL: URL?
    private var waitingSessionActive = false
    private var playbackSessionActive = false
    private var remoteCommandTargets: [Any] = []

    @objc func prepareDictationAudioSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let result = self.configureDictationSession()
            call.resolve(result)
        }
    }

    @objc func finishDictationAudioSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let session = AVAudioSession.sharedInstance()
            do {
                try? session.setPreferredInput(nil)
                try session.setActive(false, options: [.notifyOthersOnDeactivation])
                call.resolve(self.result(ok: true, phase: "dictation_finish"))
            } catch {
                call.resolve(self.result(ok: false, phase: "dictation_finish", error: error))
            }
        }
    }

    @objc func beginVoiceWaitingSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let keepAlive = call.getBool("keepAlive") ?? true
            let result = self.configureWaitingSession(keepAlive: keepAlive)
            call.resolve(result)
        }
    }

    @objc func endVoiceWaitingSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.waitingSessionActive = false
            self.stopSilentKeepAlive()
            let result = self.deactivateIfIdle(phase: "voice_waiting_end")
            call.resolve(result)
        }
    }

    @objc func beginVoicePlaybackSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let duckOthers = call.getBool("duckOthers") ?? true
            let mixWithOthers = call.getBool("mixWithOthers") ?? true
            let result = self.configurePlaybackSession(duckOthers: duckOthers, mixWithOthers: mixWithOthers)
            call.resolve(result)
        }
    }

    @objc func endVoicePlaybackSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.voiceAudioPlayer?.stop()
            self.voiceAudioPlayer = nil
            self.cleanupVoiceAudioFile()
            self.playbackSessionActive = false
            self.disableRemoteCommands()
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            let result = self.deactivateIfIdle(phase: "voice_playback_end")
            call.resolve(result)
        }
    }

    @objc func getAudioRouteDiagnostics(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(self.result(ok: true, phase: "diagnostics"))
        }
    }

    @objc func preferBuiltInMicrophone(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let session = AVAudioSession.sharedInstance()
            let preference = self.preferBuiltInMicrophoneIfAvailable(session: session)
            call.resolve(self.result(ok: preference.ok, phase: "prefer_built_in_microphone", warning: preference.warning))
        }
    }

    @objc func playVoiceAudioBase64(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let base64 = call.getString("base64"), !base64.isEmpty else {
                call.resolve(self.result(ok: false, phase: "voice_native_playback", warning: "Missing voice audio data."))
                return
            }

            guard let audioData = Data(base64Encoded: base64) else {
                call.resolve(self.result(ok: false, phase: "voice_native_playback", warning: "Voice audio data is not valid base64."))
                return
            }

            let duckOthers = call.getBool("duckOthers") ?? true
            let mixWithOthers = call.getBool("mixWithOthers") ?? true
            self.voiceAudioPlayer?.stop()
            self.voiceAudioPlayer = nil
            self.cleanupVoiceAudioFile()
            let sessionResult = self.configurePlaybackSession(duckOthers: duckOthers, mixWithOthers: mixWithOthers)
            guard sessionResult["ok"] as? Bool == true else {
                call.resolve(sessionResult)
                return
            }

            do {
                let contentType = call.getString("contentType")
                let player = try self.makeVoiceAudioPlayer(
                    data: audioData,
                    contentType: contentType
                )
                player.prepareToPlay()
                if player.play() {
                    self.voiceAudioPlayer = player
                    var payload = self.result(ok: true, phase: "voice_native_playback")
                    payload["duration"] = player.duration
                    payload["audioBytes"] = audioData.count
                    payload["contentType"] = contentType ?? ""
                    payload["fileTypeHint"] = self.fileTypeHint(for: contentType, data: audioData) ?? ""
                    call.resolve(payload)
                    return
                }
                call.resolve(self.result(ok: false, phase: "voice_native_playback", warning: "Native voice audio player did not start."))
            } catch {
                self.voiceAudioPlayer = nil
                self.cleanupVoiceAudioFile()
                call.resolve(self.result(ok: false, phase: "voice_native_playback", error: error))
            }
        }
    }

    @objc func pauseVoicePlayback(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let player = self.voiceAudioPlayer else {
                call.resolve(self.result(ok: false, phase: "voice_native_pause", warning: "No active voice audio player."))
                return
            }
            player.pause()
            self.updateNowPlayingInfo(playbackRate: 0.0)
            var payload = self.result(ok: true, phase: "voice_native_pause")
            payload["duration"] = player.duration
            payload["currentTime"] = player.currentTime
            payload["isPlaying"] = player.isPlaying
            call.resolve(payload)
        }
    }

    @objc func resumeVoicePlayback(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let player = self.voiceAudioPlayer else {
                call.resolve(self.result(ok: false, phase: "voice_native_resume", warning: "No active voice audio player."))
                return
            }
            let sessionResult = self.configurePlaybackSession(duckOthers: call.getBool("duckOthers") ?? true, mixWithOthers: call.getBool("mixWithOthers") ?? true)
            guard sessionResult["ok"] as? Bool == true else {
                call.resolve(sessionResult)
                return
            }
            if player.play() {
                self.updateNowPlayingInfo(playbackRate: 1.0)
                var payload = self.result(ok: true, phase: "voice_native_resume")
                payload["duration"] = player.duration
                payload["currentTime"] = player.currentTime
                payload["isPlaying"] = player.isPlaying
                call.resolve(payload)
                return
            }
            call.resolve(self.result(ok: false, phase: "voice_native_resume", warning: "Native voice audio player did not resume."))
        }
    }

    @objc func seekVoicePlaybackBy(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let player = self.voiceAudioPlayer else {
                call.resolve(self.result(ok: false, phase: "voice_native_seek", warning: "No active voice audio player."))
                return
            }
            let deltaSeconds = call.getDouble("seconds") ?? 0
            let nextTime = min(max(0, player.currentTime + deltaSeconds), max(0, player.duration))
            player.currentTime = nextTime
            self.updateNowPlayingInfo(playbackRate: player.isPlaying ? 1.0 : 0.0)
            var payload = self.result(ok: true, phase: "voice_native_seek")
            payload["duration"] = player.duration
            payload["currentTime"] = player.currentTime
            payload["isPlaying"] = player.isPlaying
            call.resolve(payload)
        }
    }

    private func configureDictationSession() -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .spokenAudio,
                options: [.mixWithOthers, .allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try session.setActive(true)
            let preference = preferBuiltInMicrophoneIfAvailable(session: session)
            return result(ok: true, phase: "dictation_prepare", warning: preference.warning)
        } catch {
            return result(ok: false, phase: "dictation_prepare", error: error)
        }
    }

    private func configureWaitingSession(keepAlive: Bool) -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.mixWithOthers, .allowBluetoothA2DP]
            )
            try session.setActive(true)
            waitingSessionActive = true

            var warning: String?
            if keepAlive {
                warning = startSilentKeepAlive()
            } else {
                stopSilentKeepAlive()
            }

            return result(ok: true, phase: "voice_waiting_begin", warning: warning)
        } catch {
            waitingSessionActive = false
            stopSilentKeepAlive()
            return result(ok: false, phase: "voice_waiting_begin", error: error)
        }
    }

    private func configurePlaybackSession(duckOthers: Bool, mixWithOthers: Bool) -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        let preferredOptions = playbackOptions(duckOthers: duckOthers, mixWithOthers: mixWithOthers, allowBluetoothA2DP: true)
        let fallbackOptions = playbackOptions(duckOthers: duckOthers, mixWithOthers: mixWithOthers, allowBluetoothA2DP: false)
        let attempts: [(mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions, label: String)] = [
            (.spokenAudio, preferredOptions, "spoken-audio-preferred"),
            (.spokenAudio, fallbackOptions, "spoken-audio-no-bluetooth-a2dp"),
            (.default, [], "default-minimal")
        ]

        stopSilentKeepAlive()
        var errors: [Error] = []
        var failedLabels: [String] = []
        for attempt in attempts {
            do {
                try session.setCategory(.playback, mode: attempt.mode, options: attempt.options)
                try session.setActive(true)
                playbackSessionActive = true
                setupRemoteCommands()
                updateNowPlayingInfo(playbackRate: 1.0)
                var payload = result(ok: true, phase: "voice_playback_begin")
                if !failedLabels.isEmpty {
                    payload["warning"] = "Playback session fallback used: \(attempt.label) after \(failedLabels.joined(separator: ", "))."
                }
                return payload
            } catch {
                errors.append(error)
                failedLabels.append(attempt.label)
            }
        }

        playbackSessionActive = false
        return result(
            ok: false,
            phase: "voice_playback_begin",
            error: VoicePlaybackError(
                phase: "voice_playback_begin",
                message: "Unable to configure iOS playback audio session.",
                underlyingErrors: errors,
                contentHint: nil,
                byteCount: 0,
                bytePrefix: ""
            )
        )
    }

    private func playbackOptions(duckOthers: Bool, mixWithOthers: Bool, allowBluetoothA2DP: Bool) -> AVAudioSession.CategoryOptions {
        var options: AVAudioSession.CategoryOptions = []
        if allowBluetoothA2DP {
            options.insert(.allowBluetoothA2DP)
        }
        if duckOthers {
            options.insert(.duckOthers)
        } else if mixWithOthers {
            options.insert(.mixWithOthers)
        }
        return options
    }

    private func makeVoiceAudioPlayer(data: Data, contentType: String?) throws -> AVAudioPlayer {
        let hint = fileTypeHint(for: contentType, data: data)
        do {
            return try AVAudioPlayer(data: data, fileTypeHint: hint)
        } catch {
            return try makeVoiceAudioPlayerFromTemporaryFile(data: data, hint: hint, originalError: error)
        }
    }

    private func makeVoiceAudioPlayerFromTemporaryFile(data: Data, hint: String?, originalError: Error) throws -> AVAudioPlayer {
        let extensionName = fileExtension(for: hint)
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("codex-voice-\(UUID().uuidString)")
            .appendingPathExtension(extensionName)
        do {
            try data.write(to: fileURL, options: [.atomic])
            let player = try AVAudioPlayer(contentsOf: fileURL, fileTypeHint: hint)
            voiceAudioFileURL = fileURL
            return player
        } catch {
            try? FileManager.default.removeItem(at: fileURL)
            throw VoicePlaybackError(
                phase: "voice_native_decode",
                message: "Unable to decode voice audio from memory or temp file.",
                underlyingErrors: [originalError, error],
                contentHint: hint,
                byteCount: data.count,
                bytePrefix: hexPrefix(data)
            )
        }
    }

    private func fileTypeHint(for contentType: String?, data: Data) -> String? {
        let normalized = (contentType ?? "").split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch normalized {
        case "audio/mpeg", "audio/mp3":
            return AVFileType.mp3.rawValue
        case "audio/aac", "audio/aacp":
            return "public.aac-audio"
        case "audio/mp4", "audio/x-m4a", "audio/m4a":
            return AVFileType.m4a.rawValue
        case "audio/wav", "audio/wave", "audio/x-wav":
            return AVFileType.wav.rawValue
        case "audio/flac", "audio/x-flac":
            return "org.xiph.flac"
        default:
            if data.starts(with: Data([0x49, 0x44, 0x33])) || data.starts(with: Data([0xff, 0xfb])) || data.starts(with: Data([0xff, 0xf3])) || data.starts(with: Data([0xff, 0xf2])) {
                return AVFileType.mp3.rawValue
            }
            if data.starts(with: Data([0x52, 0x49, 0x46, 0x46])) {
                return AVFileType.wav.rawValue
            }
            return nil
        }
    }

    private func fileExtension(for hint: String?) -> String {
        switch hint {
        case AVFileType.mp3.rawValue:
            return "mp3"
        case "public.aac-audio":
            return "aac"
        case AVFileType.m4a.rawValue:
            return "m4a"
        case AVFileType.wav.rawValue:
            return "wav"
        case "org.xiph.flac":
            return "flac"
        default:
            return "audio"
        }
    }

    private func hexPrefix(_ data: Data, limit: Int = 16) -> String {
        data.prefix(limit).map { String(format: "%02x", $0) }.joined()
    }

    private func cleanupVoiceAudioFile() {
        guard let fileURL = voiceAudioFileURL else {
            return
        }
        try? FileManager.default.removeItem(at: fileURL)
        voiceAudioFileURL = nil
    }

    private func deactivateIfIdle(phase: String) -> [String: Any] {
        if waitingSessionActive || playbackSessionActive {
            return result(ok: true, phase: phase)
        }

        do {
            try? AVAudioSession.sharedInstance().setPreferredInput(nil)
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            return result(ok: true, phase: phase)
        } catch {
            return result(ok: false, phase: phase, error: error)
        }
    }

    private func preferBuiltInMicrophoneIfAvailable(session: AVAudioSession) -> (ok: Bool, warning: String?) {
        guard let inputs = session.availableInputs else {
            return (false, "No available audio inputs for the current session category/mode.")
        }

        guard let builtInMic = inputs.first(where: { $0.portType == .builtInMic }) else {
            return (false, "Built-in microphone is not available in the current audio route.")
        }

        do {
            try session.setPreferredInput(builtInMic)
            let currentInputUsesBuiltInMic = session.currentRoute.inputs.contains { $0.portType == .builtInMic }
            if currentInputUsesBuiltInMic {
                return (true, nil)
            }
            return (true, "Built-in microphone was requested, but iOS has not routed input to it yet.")
        } catch {
            return (false, "Failed to prefer built-in microphone: \(error.localizedDescription)")
        }
    }

    private func startSilentKeepAlive() -> String? {
        if silentKeepAlivePlayer?.isPlaying == true {
            return nil
        }

        do {
            let player = try AVAudioPlayer(data: makeSilentWavData())
            player.numberOfLoops = -1
            player.volume = 0.0
            player.prepareToPlay()
            if player.play() {
                silentKeepAlivePlayer = player
                return nil
            }
            return "Silent keepalive player did not start."
        } catch {
            silentKeepAlivePlayer = nil
            return "Failed to start silent keepalive: \(error.localizedDescription)"
        }
    }

    private func stopSilentKeepAlive() {
        silentKeepAlivePlayer?.stop()
        silentKeepAlivePlayer = nil
    }

    private func setupRemoteCommands() {
        if !remoteCommandTargets.isEmpty {
            return
        }

        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.isEnabled = true
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.isEnabled = true

        remoteCommandTargets.append(commandCenter.playCommand.addTarget { [weak self] _ in
            self?.emitRemoteCommand("play")
            return .success
        })
        remoteCommandTargets.append(commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.emitRemoteCommand("pause")
            return .success
        })
        remoteCommandTargets.append(commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.emitRemoteCommand("toggle")
            return .success
        })
    }

    private func disableRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()
        for target in remoteCommandTargets {
            commandCenter.playCommand.removeTarget(target)
            commandCenter.pauseCommand.removeTarget(target)
            commandCenter.togglePlayPauseCommand.removeTarget(target)
        }
        remoteCommandTargets.removeAll()

        commandCenter.playCommand.isEnabled = false
        commandCenter.pauseCommand.isEnabled = false
        commandCenter.togglePlayPauseCommand.isEnabled = false
    }

    private func emitRemoteCommand(_ command: String) {
        DispatchQueue.main.async {
            self.notifyListeners(
                "voicePlaybackRemoteCommand",
                data: [
                    "command": command,
                    "timestamp": Int(Date().timeIntervalSince1970 * 1000)
                ]
            )
        }
    }

    private func updateNowPlayingInfo(playbackRate: Double) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: "Codex Voice",
            MPMediaItemPropertyArtist: "Codex UI",
            MPNowPlayingInfoPropertyPlaybackRate: playbackRate,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: voiceAudioPlayer?.currentTime ?? 0,
            MPMediaItemPropertyPlaybackDuration: voiceAudioPlayer?.duration ?? 0
        ]
    }

    private func result(ok: Bool, phase: String, error: Error? = nil, warning: String? = nil) -> [String: Any] {
        var payload: [String: Any] = [
            "ok": ok,
            "diagnostics": routeDiagnostics(phase: phase)
        ]

        if let error = error {
            payload["error"] = describe(error: error, fallbackPhase: phase)
            let nsError = error as NSError
            payload["errorDomain"] = nsError.domain
            payload["errorCode"] = nsError.code
        }

        if let warning = warning {
            payload["warning"] = warning
        }

        return payload
    }

    private func routeDiagnostics(phase: String) -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        return [
            "phase": phase,
            "category": session.category.rawValue,
            "mode": session.mode.rawValue,
            "isOtherAudioPlaying": session.isOtherAudioPlaying,
            "secondaryAudioShouldBeSilencedHint": session.secondaryAudioShouldBeSilencedHint,
            "sampleRate": session.sampleRate,
            "preferredSampleRate": session.preferredSampleRate,
            "ioBufferDuration": session.ioBufferDuration,
            "preferredIOBufferDuration": session.preferredIOBufferDuration,
            "preferredInput": portDescription(session.preferredInput),
            "availableInputs": (session.availableInputs ?? []).map { portDescription($0) },
            "currentInputs": session.currentRoute.inputs.map { portDescription($0) },
            "currentOutputs": session.currentRoute.outputs.map { portDescription($0) },
            "waitingSessionActive": waitingSessionActive,
            "playbackSessionActive": playbackSessionActive,
            "silentKeepAliveActive": silentKeepAlivePlayer?.isPlaying == true,
            "remoteCommandsActive": !remoteCommandTargets.isEmpty,
            "backgroundAudioEnabled": backgroundAudioEnabled()
        ]
    }

    private func portDescription(_ port: AVAudioSessionPortDescription?) -> [String: Any] {
        guard let port = port else {
            return [:]
        }

        var payload: [String: Any] = [
            "portName": port.portName,
            "portType": port.portType.rawValue,
            "uid": port.uid
        ]

        if let selectedDataSource = port.selectedDataSource {
            payload["selectedDataSource"] = dataSourceDescription(selectedDataSource)
        }

        if let dataSources = port.dataSources {
            payload["dataSources"] = dataSources.map { dataSourceDescription($0) }
        }

        return payload
    }

    private func dataSourceDescription(_ dataSource: AVAudioSessionDataSourceDescription) -> [String: Any] {
        var payload: [String: Any] = [
            "dataSourceName": dataSource.dataSourceName,
            "dataSourceID": dataSource.dataSourceID
        ]

        if let location = dataSource.location {
            payload["location"] = String(describing: location)
        }

        if let orientation = dataSource.orientation {
            payload["orientation"] = String(describing: orientation)
        }

        if let selectedPolarPattern = dataSource.selectedPolarPattern {
            payload["selectedPolarPattern"] = String(describing: selectedPolarPattern)
        }

        return payload
    }

    private func backgroundAudioEnabled() -> Bool {
        guard let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] else {
            return false
        }
        return modes.contains("audio")
    }

    private func makeSilentWavData(duration: Double = 1.0, sampleRate: UInt32 = 8_000) -> Data {
        let channelCount: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let byteRate = sampleRate * UInt32(channelCount) * UInt32(bitsPerSample / 8)
        let blockAlign = channelCount * (bitsPerSample / 8)
        let sampleCount = UInt32(duration * Double(sampleRate))
        let dataSize = sampleCount * UInt32(blockAlign)
        let riffSize = 36 + dataSize

        var data = Data()
        appendString("RIFF", to: &data)
        appendUInt32(riffSize, to: &data)
        appendString("WAVE", to: &data)
        appendString("fmt ", to: &data)
        appendUInt32(16, to: &data)
        appendUInt16(1, to: &data)
        appendUInt16(channelCount, to: &data)
        appendUInt32(sampleRate, to: &data)
        appendUInt32(byteRate, to: &data)
        appendUInt16(blockAlign, to: &data)
        appendUInt16(bitsPerSample, to: &data)
        appendString("data", to: &data)
        appendUInt32(dataSize, to: &data)
        data.append(Data(repeating: 0, count: Int(dataSize)))
        return data
    }

    private func appendString(_ value: String, to data: inout Data) {
        data.append(contentsOf: value.utf8)
    }

    private func appendUInt16(_ value: UInt16, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { bytes in
            data.append(contentsOf: bytes)
        }
    }

    private func appendUInt32(_ value: UInt32, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { bytes in
            data.append(contentsOf: bytes)
        }
    }

    private func describe(error: Error, fallbackPhase: String? = nil) -> String {
        let nsError = error as NSError
        var parts: [String] = []
        if let playbackError = error as? VoicePlaybackError {
            parts.append(playbackError.errorDescription ?? playbackError.localizedDescription)
        } else if !error.localizedDescription.isEmpty {
            parts.append(error.localizedDescription)
        }
        if let fallbackPhase = fallbackPhase {
            parts.append("phase=\(fallbackPhase)")
        }
        parts.append("domain=\(nsError.domain)")
        parts.append("code=\(nsError.code)")
        return parts.joined(separator: "; ")
    }
}

private struct VoicePlaybackError: LocalizedError {
    let phase: String
    let message: String
    let underlyingErrors: [Error]
    let contentHint: String?
    let byteCount: Int
    let bytePrefix: String

    var errorDescription: String? {
        var parts = [
            message,
            "phase=\(phase)"
        ]
        if let contentHint = contentHint, !contentHint.isEmpty {
            parts.append("hint=\(contentHint)")
        }
        if byteCount > 0 {
            parts.append("bytes=\(byteCount)")
        }
        if !bytePrefix.isEmpty {
            parts.append("prefix=\(bytePrefix)")
        }
        if !underlyingErrors.isEmpty {
            parts.append("underlying=\(underlyingErrors.map { describeUnderlying($0) }.joined(separator: " | "))")
        }
        return parts.joined(separator: "; ")
    }

    private func describeUnderlying(_ error: Error) -> String {
        let nsError = error as NSError
        return "\(error.localizedDescription) [\(nsError.domain) \(nsError.code)]"
    }
}
