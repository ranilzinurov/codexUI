import AVFoundation
import Capacitor

@objc(CodexAudioSessionPlugin)
public class CodexAudioSessionPlugin: CAPPlugin {
    @objc func prepareDictationAudioSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(
                    .playAndRecord,
                    mode: .spokenAudio,
                    options: [.mixWithOthers, .allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
                )
                try session.setActive(true)
                call.resolve(["ok": true])
            } catch {
                call.reject("Failed to prepare dictation audio session: \(error.localizedDescription)")
            }
        }
    }

    @objc func finishDictationAudioSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
                call.resolve(["ok": true])
            } catch {
                call.reject("Failed to finish dictation audio session: \(error.localizedDescription)")
            }
        }
    }
}
