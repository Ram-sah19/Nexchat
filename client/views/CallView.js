/**
 * CallView — DOM wrapper for all call UI.
 *
 * Manages three UI states:
 *  1. Idle          — everything hidden
 *  2. Incoming call — banner with caller info + Accept/Decline
 *  3. Active call   — full overlay: remote video, local PiP, controls
 */
class CallView {
  constructor() {
    // ── Incoming call banner ──────────────────────────────────────────
    this.incomingBanner    = document.getElementById('incoming-call-banner');
    this.incomingCallerName = document.getElementById('incoming-caller-name');
    this.incomingCallType  = document.getElementById('incoming-call-type');
    this.acceptCallBtn     = document.getElementById('accept-call-btn');
    this.declineCallBtn    = document.getElementById('decline-call-btn');

    // ── Active call overlay ───────────────────────────────────────────
    this.callOverlay       = document.getElementById('call-overlay');
    this.callPeerName      = document.getElementById('call-peer-name');
    this.callStatus        = document.getElementById('call-status');
    this.callTimer         = document.getElementById('call-timer');
    this.remoteVideo       = document.getElementById('remote-video');
    this.localVideo        = document.getElementById('local-video');
    this.muteBtn           = document.getElementById('call-mute-btn');
    this.cameraBtn         = document.getElementById('call-camera-btn');
    this.hangupBtn         = document.getElementById('call-hangup-btn');

    // ── Header call buttons (injected by ChatView/HTML) ────────────────
    this.voiceCallBtn      = document.getElementById('voice-call-btn');
    this.videoCallBtn      = document.getElementById('video-call-btn');

    this._timerInterval    = null;
    this._seconds          = 0;
    this._isMuted          = false;
    this._isCameraOff      = false;
  }

  // ─── Incoming Call ─────────────────────────────────────────────────────────

  showIncoming(callerName, withVideo) {
    this.incomingCallerName.textContent = callerName;
    this.incomingCallType.textContent   = withVideo ? '📹 Video Call' : '📞 Voice Call';
    this.incomingBanner.classList.remove('hidden');
    this.incomingBanner.classList.add('call-banner-in');
    // Ringtone pulse on the banner
    this.incomingBanner.classList.add('ringing');
  }

  hideIncoming() {
    this.incomingBanner.classList.add('hidden');
    this.incomingBanner.classList.remove('call-banner-in', 'ringing');
  }

  // ─── Active Call Overlay ───────────────────────────────────────────────────

  /**
   * @param {string}      peerName
   * @param {boolean}     withVideo
   * @param {MediaStream} localStream
   */
  showCallOverlay(peerName, withVideo, localStream) {
    this.callPeerName.textContent = peerName;
    this.callStatus.textContent   = 'Connecting…';
    this.callTimer.textContent    = '00:00';
    this._seconds                 = 0;
    this._isMuted                 = false;
    this._isCameraOff             = false;

    // Local preview
    this.localVideo.srcObject = localStream;
    this.localVideo.muted     = true; // avoid echo
    this.localVideo.play().catch(() => {});

    // Show/hide camera button based on call type
    if (withVideo) {
      this.cameraBtn.classList.remove('hidden');
      this.callOverlay.classList.add('video-mode');
    } else {
      this.cameraBtn.classList.add('hidden');
      this.callOverlay.classList.remove('video-mode');
    }

    this.callOverlay.classList.remove('hidden');
    this.callOverlay.classList.add('call-overlay-in');
  }

  /** Attach the remote stream once WebRTC negotiation completes. */
  attachRemoteStream(stream) {
    this.remoteVideo.srcObject = stream;
    this.remoteVideo.play().catch(() => {});
    this.callStatus.textContent = 'Connected';
    this._startTimer();
  }

  hideCallOverlay() {
    this._stopTimer();
    this.callOverlay.classList.add('hidden');
    this.callOverlay.classList.remove('call-overlay-in', 'video-mode');
    this.remoteVideo.srcObject = null;
    this.localVideo.srcObject  = null;
    this.callStatus.textContent = '';
    this.callTimer.textContent  = '';
    // Reset button states
    this._isMuted      = false;
    this._isCameraOff  = false;
    this.muteBtn.classList.remove('active');
    this.cameraBtn.classList.remove('active');
  }

  // ─── Timer ─────────────────────────────────────────────────────────────────

  _startTimer() {
    this._seconds = 0;
    this._timerInterval = setInterval(() => {
      this._seconds++;
      const m = String(Math.floor(this._seconds / 60)).padStart(2, '0');
      const s = String(this._seconds % 60).padStart(2, '0');
      this.callTimer.textContent = `${m}:${s}`;
    }, 1000);
  }

  _stopTimer() {
    clearInterval(this._timerInterval);
    this._timerInterval = null;
  }

  // ─── Toggle Helpers ────────────────────────────────────────────────────────

  toggleMute() {
    this._isMuted = !this._isMuted;
    this.muteBtn.classList.toggle('active', this._isMuted);
    this.muteBtn.title = this._isMuted ? 'Unmute' : 'Mute';
    return this._isMuted;
  }

  toggleCamera() {
    this._isCameraOff = !this._isCameraOff;
    this.cameraBtn.classList.toggle('active', this._isCameraOff);
    this.cameraBtn.title = this._isCameraOff ? 'Turn camera on' : 'Turn camera off';
    return this._isCameraOff;
  }

  // ─── Header call button visibility ────────────────────────────────────────

  showCallButtons() {
    this.voiceCallBtn && this.voiceCallBtn.classList.remove('hidden');
    this.videoCallBtn && this.videoCallBtn.classList.remove('hidden');
  }

  hideCallButtons() {
    this.voiceCallBtn && this.voiceCallBtn.classList.add('hidden');
    this.videoCallBtn && this.videoCallBtn.classList.add('hidden');
  }
}
