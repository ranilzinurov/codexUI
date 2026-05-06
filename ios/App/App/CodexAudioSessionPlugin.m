#import <Capacitor/Capacitor.h>

CAP_PLUGIN(CodexAudioSessionPlugin, "CodexAudioSession",
  CAP_PLUGIN_METHOD(prepareDictationAudioSession, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(finishDictationAudioSession, CAPPluginReturnPromise);
)
