export type XRMode = 'immersive-ar' | 'immersive-vr';

const INIT: XRSessionInit = {
  requiredFeatures: ['local-floor'],
  // Optional so the session still starts with hand tracking off; the start
  // screen warns, since there is nothing to do here without hands.
  optionalFeatures: ['hand-tracking'],
};

/** Passthrough AR on Quest 3, so the virtual table sits in your real room; VR otherwise. */
export async function supportedMode(): Promise<XRMode | null> {
  if (!navigator.xr) return null;
  if (await navigator.xr.isSessionSupported('immersive-ar')) return 'immersive-ar';
  if (await navigator.xr.isSessionSupported('immersive-vr')) return 'immersive-vr';
  return null;
}

export async function requestSession(mode: XRMode): Promise<XRSession> {
  if (!navigator.xr) throw new Error('WebXR is unavailable in this browser.');
  return navigator.xr.requestSession(mode, INIT);
}
