/**
 * CallController — WebRTC voice/video call lifecycle.
 *
 * Signalling channel: existing Java WebSocket (via SocketController).
 * Media: Browser WebRTC APIs (RTCPeerConnection, getUserMedia).
 *
 * Message types used (all relayed by Java server):
 *   → call_offer      { to, offer, withVideo }
 *   → call_answer     { to, answer }
 *   → call_ice        { to, candidate }
 *   → call_ended      { to }
 *
 *   ← call_offer      { from, offer, withVideo }
 *   ← call_answer     { from, answer }
 *   ← call_ice        { from, candidate }
 *   ← call_ended      { from }
 */
class CallController {
  /**
   * @param {AuthModel}   authModel
   * @param {CallView}    callView
   * @param {ToastView}   toastView
   */
  constructor(authModel, callView, toastView) {
    this.authModel  = authModel;
    this.callView   = callView;
    this.toastView  = toastView;

    // Filled by wire()
    this.socketCtrl = null;

    // ── Call state ──────────────────────────────────────────────────────
    this._pc            = null;   // RTCPeerConnection
    this._localStream   = null;   // captured microphone / camera
    this._peerUsername  = null;   // who we are calling / being called by
    this._withVideo     = false;
    this._isInitiator   = false;
    this._pendingOffer  = null;   // stored while waiting for user to accept
    this._callStartTime    = null; // when the call was initiated (ms)
    this._callAnsweredTime = null; // when both sides connected (ms)

    // STUN configuration — works for LAN; add TURN for internet
    this._iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this._bindViewEvents();
  }

  /** Inject SocketController after all instances are created. */
  wire(socketCtrl) {
    this.socketCtrl = socketCtrl;
  }

  // ─── View Event Bindings ───────────────────────────────────────────────────

  _bindViewEvents() {
    // Header call buttons
    const voiceBtn = document.getElementById('voice-call-btn');
    const videoBtn = document.getElementById('video-call-btn');
    if (voiceBtn) voiceBtn.addEventListener('click', () => this._onHeaderCallClick(false));
    if (videoBtn) videoBtn.addEventListener('click', () => this._onHeaderCallClick(true));

    // Incoming call banner buttons
    this.callView.acceptCallBtn .addEventListener('click', () => this._onAccept());
    this.callView.declineCallBtn.addEventListener('click', () => this._onDecline());

    // In-call controls
    this.callView.muteBtn  .addEventListener('click', () => this._onToggleMute());
    this.callView.cameraBtn.addEventListener('click', () => this._onToggleCamera());
    this.callView.hangupBtn.addEventListener('click', () => this.endCall());
  }

  _onHeaderCallClick(withVideo) {
    const target = this.socketCtrl?.chatCtrl?.chatModel?.activeChatUser;
    if (!target) {
      this.toastView.show('Open a chat first before calling.', 'error');
      return;
    }
    this.startCall(target, withVideo);
  }

  // ─── Start an Outgoing Call ────────────────────────────────────────────────

  /**
   * Initiates a call to `targetUsername`.
   * @param {string}  targetUsername
   * @param {boolean} withVideo
   */
  async startCall(targetUsername, withVideo) {
    if (this._pc) {
      this.toastView.show('Already in a call.', 'error');
      return;
    }

    this._peerUsername    = targetUsername;
    this._withVideo       = withVideo;
    this._isInitiator     = true;
    this._callStartTime   = Date.now();
    this._callAnsweredTime = null;

    try {
      this._localStream = await this._getMedia(withVideo);
    } catch (e) {
      this.toastView.show('Could not access microphone/camera: ' + e.message, 'error');
      return;
    }

    this.callView.showCallOverlay(targetUsername, withVideo, this._localStream);

    this._pc = this._createPeerConnection();
    this._localStream.getTracks().forEach(t => this._pc.addTrack(t, this._localStream));

    try {
      const offer = await this._pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: withVideo
      });
      await this._pc.setLocalDescription(offer);

      this.socketCtrl.send('call_offer', {
        to:        targetUsername,
        offer:     offer,
        withVideo: withVideo
      });
    } catch (e) {
      console.error('[Call] Offer creation failed:', e);
      this.endCall();
    }
  }

  // ─── Incoming: Offer Received ──────────────────────────────────────────────

  /** Called by SocketController when `call_offer` arrives. */
  async handleIncomingOffer(payload) {
    if (this._pc) {
      // Already in a call — auto-decline
      this.socketCtrl.send('call_ended', { to: payload.from });
      return;
    }

    this._peerUsername     = payload.from;
    this._withVideo        = payload.withVideo;
    this._isInitiator      = false;
    this._pendingOffer     = payload.offer;
    this._callStartTime    = Date.now();
    this._callAnsweredTime = null;

    this.callView.showIncoming(payload.from, payload.withVideo);
  }

  // ─── Accept / Decline ─────────────────────────────────────────────────────

  async _onAccept() {
    this.callView.hideIncoming();

    if (!this._pendingOffer) return;

    try {
      this._localStream = await this._getMedia(this._withVideo);
    } catch (e) {
      this.toastView.show('Could not access microphone/camera: ' + e.message, 'error');
      this._cleanup();
      return;
    }

    this.callView.showCallOverlay(this._peerUsername, this._withVideo, this._localStream);

    this._pc = this._createPeerConnection();
    this._localStream.getTracks().forEach(t => this._pc.addTrack(t, this._localStream));

    try {
      await this._pc.setRemoteDescription(new RTCSessionDescription(this._pendingOffer));
      const answer = await this._pc.createAnswer();
      await this._pc.setLocalDescription(answer);

      this.socketCtrl.send('call_answer', {
        to:     this._peerUsername,
        answer: answer
      });
      // Mark as answered from callee side
      this._callAnsweredTime = Date.now();
    } catch (e) {
      console.error('[Call] Answer creation failed:', e);
      this.endCall();
    }

    this._pendingOffer = null;
  }

  _onDecline() {
    this.callView.hideIncoming();
    this.socketCtrl.send('call_ended', { to: this._peerUsername });
    this._cleanup();
  }

  // ─── Incoming: Answer Received ─────────────────────────────────────────────

  /** Called by SocketController when `call_answer` arrives. */
  async handleAnswer(payload) {
    if (!this._pc) return;
    try {
      await this._pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
      // Mark as answered from caller side
      this._callAnsweredTime = Date.now();
    } catch (e) {
      console.error('[Call] setRemoteDescription (answer) failed:', e);
    }
  }

  // ─── Incoming: ICE Candidate ───────────────────────────────────────────────

  /** Called by SocketController when `call_ice` arrives. */
  async handleIceCandidate(payload) {
    if (!this._pc || !payload.candidate) return;
    try {
      await this._pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (e) {
      console.warn('[Call] addIceCandidate failed:', e);
    }
  }

  // ─── Remote Hang-Up ───────────────────────────────────────────────────────

  /** Called by SocketController when `call_ended` arrives. */
  handleRemoteHangup(payload) {
    if (this._pendingOffer && !this._pc) {
      // Caller cancelled before we answered — just dismiss the banner
      this.callView.hideIncoming();
      this.toastView.show(`${payload.from} cancelled the call.`);
      this._cleanup();
      return;
    }
    this.toastView.show(`${payload.from} ended the call.`);
    this._terminateCall();
  }

  // ─── End Call (local hang-up) ──────────────────────────────────────────────

  endCall() {
    if (this._peerUsername) {
      this.socketCtrl.send('call_ended', { to: this._peerUsername });
    }
    this._terminateCall();
  }

  _terminateCall() {
    this._appendCallBubble(); // inject bubble before state is wiped
    this.callView.hideIncoming();
    this.callView.hideCallOverlay();
    this._cleanup();
  }

  _cleanup() {
    if (this._localStream) {
      this._localStream.getTracks().forEach(t => t.stop());
      this._localStream = null;
    }
    if (this._pc) {
      this._pc.close();
      this._pc = null;
    }
    this._peerUsername     = null;
    this._pendingOffer     = null;
    this._isInitiator      = false;
    this._callStartTime    = null;
    this._callAnsweredTime = null;
  }

  // ─── In-Call Controls ──────────────────────────────────────────────────────

  /**
   * Immediately appends a call record bubble to the active chat if the
   * conversation is open with the person we just called/received a call from.
   * Called right before _cleanup() wipes the state.
   */
  _appendCallBubble() {
    if (!this._peerUsername) return;

    // Only show in the chat if it is currently open with this peer
    const chatModel = this.socketCtrl?.chatCtrl?.chatModel;
    const chatView  = this.socketCtrl?.chatView;
    if (!chatView || chatModel?.activeChatUser !== this._peerUsername) return;

    const answered = this._callAnsweredTime !== null;
    const duration = answered
      ? Math.max(0, Math.round((Date.now() - this._callAnsweredTime) / 1000))
      : 0;

    const record = {
      caller:    this._isInitiator ? this.authModel.username : this._peerUsername,
      callee:    this._isInitiator ? this._peerUsername : this.authModel.username,
      type:      this._withVideo ? 'video' : 'voice',
      status:    answered ? 'completed' : 'missed',
      duration:  duration,
      startedAt: this._callStartTime || Date.now()
    };

    chatView.appendCallRecord(record, this.authModel.username);
  }

  _onToggleMute() {
    if (!this._localStream) return;
    const isMuted = this.callView.toggleMute();
    this._localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  }

  _onToggleCamera() {
    if (!this._localStream) return;
    const isCameraOff = this.callView.toggleCamera();
    this._localStream.getVideoTracks().forEach(t => { t.enabled = !isCameraOff; });
  }

  // ─── RTCPeerConnection Factory ─────────────────────────────────────────────

  _createPeerConnection() {
    const pc = new RTCPeerConnection(this._iceConfig);

    // Send our ICE candidates to the peer via WS
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && this._peerUsername) {
        this.socketCtrl.send('call_ice', {
          to:        this._peerUsername,
          candidate: candidate
        });
      }
    };

    // When remote tracks arrive, attach to the remote video element
    pc.ontrack = ({ streams }) => {
      if (streams && streams[0]) {
        this.callView.attachRemoteStream(streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[Call] Connection state:', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.toastView.show('Call connection lost.', 'error');
        this._terminateCall();
      }
    };

    return pc;
  }

  // ─── Media Capture ────────────────────────────────────────────────────────

  async _getMedia(withVideo) {
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: withVideo
        ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
        : false
    });
  }
}
