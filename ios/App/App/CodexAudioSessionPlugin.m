#import <Capacitor/Capacitor.h>

CAP_PLUGIN(CodexAudioSessionPlugin, "CodexAudioSession",
  CAP_PLUGIN_METHOD(prepareDictationAudioSession, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(finishDictationAudioSession, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(beginVoiceWaitingSession, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(endVoiceWaitingSession, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(beginVoicePlaybackSession, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(endVoicePlaybackSession, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(playVoiceAudioBase64, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(pauseVoicePlayback, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(resumeVoicePlayback, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(seekVoicePlaybackBy, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(getAudioRouteDiagnostics, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(preferBuiltInMicrophone, CAPPluginReturnPromise);
)
