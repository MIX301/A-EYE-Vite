/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';
// PWA: register service worker if available
try {
  // dynamic import optional; vite-plugin-pwa injects virtual module
  // eslint-disable-next-line @typescript-eslint/ban-ts-GB
  // @ts-ignore
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  }).catch(() => {});
} catch {}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() isHolding = false;
  @state() status = '';
  @state() error = '';
  @state() appStopped = false;
  @state() sessionStarted = false;

  private client: GoogleGenAI;
  private sessionPromise?: Promise<Session>;
  // Audio contexts created on user gesture for iOS PWA compatibility
  private inputAudioContext?: AudioContext;
  private outputAudioContext?: AudioContext;
  @state() inputNode?: GainNode;
  @state() outputNode?: GainNode;
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private frameInterval: number;
  private videoElement: HTMLVideoElement;
  private canvasElement: HTMLCanvasElement;
  private framesSent = 0;

  static styles = css`
    :host {
      display: block;
      position: relative;
      width: 100vw;
      height: 100vh;
      min-height: 100dvh;
      background: #000000;
      color: #ffffff;
      overflow: hidden;
    }

    @supports (height: 100dvh) {
      :host {
        height: 100dvh;
      }
    }

    .layout {
      position: relative;
      width: 100%;
      height: 100%;
    }

    #video-background {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 66.667vh;
      object-fit: cover;
    }

    .speak-area {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: calc(33.333vh + env(safe-area-inset-bottom));
      border-top-left-radius: 32px;
      border-top-right-radius: 32px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-bottom: none;
      overflow: hidden;
      background: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(6px);
    }

    .session-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-size: 18px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.92);
      background: linear-gradient(
        180deg,
        rgba(17, 24, 39, 0.6) 0%,
        rgba(15, 23, 42, 0.85) 100%
      );
      pointer-events: none;
      text-align: center;
    }

    gdm-live-audio-visuals-3d {
      display: block;
      width: 100%;
      height: 100%;
      pointer-events: none;
      border-top-left-radius: inherit;
      border-top-right-radius: inherit;
    }

    .speak-button {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding: 24px 24px calc(24px + env(safe-area-inset-bottom));
      color: inherit;
      transition: background 0.2s ease;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    .speak-button:hover,
    .speak-button:focus-visible {
      background: rgba(255, 255, 255, 0.04);
    }

    .speak-button:focus-visible {
      outline: 2px solid rgba(255, 255, 255, 0.25);
      outline-offset: 4px;
    }

    .speak-label {
      font-size: 18px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.92);
      text-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      pointer-events: none;
    }

    .error-banner {
      position: absolute;
      top: calc(env(safe-area-inset-top) + 12px);
      left: 16px;
      right: 16px;
      z-index: 10;
      padding: 12px 16px;
      background: rgba(220, 38, 38, 0.85);
      color: #ffffff;
      border-radius: 12px;
      text-align: center;
      font-size: 14px;
      line-height: 1.4;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(12px);
    }

    .start-button {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 1000;
      padding: 20px 40px;
      background: rgba(255, 255, 255, 0.25);
      color: #ffffff;
      border: 2px solid rgba(255, 255, 255, 0.5);
      border-radius: 16px;
      font-size: 18px;
      font-weight: 500;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.2s ease;
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1);
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      white-space: nowrap;
    }

    .start-button:hover,
    .start-button:focus-visible {
      background: rgba(255, 255, 255, 0.25);
      border-color: rgba(255, 255, 255, 0.5);
      transform: translate(-50%, -50%) scale(1.05);
    }

    .start-button:active {
      transform: translate(-50%, -50%) scale(0.98);
    }

    .start-button:focus-visible {
      outline: 2px solid rgba(255, 255, 255, 0.5);
      outline-offset: 4px;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  protected firstUpdated() {
    this.videoElement = this.shadowRoot!.querySelector('#video-background');
    this.canvasElement = this.shadowRoot!.querySelector('#frame-canvas');
    this.debug(
      `Boot: secure=${window.isSecureContext} ua=${navigator.userAgent}`,
    );
    this.checkPermissions();
    this.addEventListener('click', async () => {
      try {
        if (this.outputAudioContext) {
          await this.outputAudioContext.resume();
        }
        if (this.inputAudioContext) {
          await this.inputAudioContext.resume();
        }
      } catch {}
    });
  }

  private async checkPermissions() {
    const parts: string[] = [];
    const anyNav: any = navigator as any;
    if (anyNav.permissions?.query) {
      try {
        const mic = await anyNav.permissions.query({name: 'microphone'});
        parts.push(`mic=${mic.state}`);
      } catch {}
      try {
        const cam = await anyNav.permissions.query({name: 'camera'});
        parts.push(`cam=${cam.state}`);
      } catch {}
    }
    if (parts.length) this.updateStatus(`Permissions: ${parts.join(' ')}`);
  }

  private debug(_msg: string, _data?: unknown) {
    // Debug logging disabled for production UI clarity.
  }

  private initAudio() {
    if (this.outputAudioContext && this.inputNode) {
      this.nextStartTime = this.outputAudioContext.currentTime;
      this.inputNode.gain.value = 0.0; // Start with mic muted
    }
  }

  private async initClient() {
    if (!process.env.API_KEY || process.env.API_KEY === 'undefined') {
      this.updateError('Missing GEMINI_API_KEY');
    }

    this.client = new GoogleGenAI({apiKey: process.env.API_KEY});

    // Audio contexts and nodes will be created on user gesture
    // Session will be initialized when user starts session
  }

  private initSession(): Promise<Session> {
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    try {
      return this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.debug('Live session opened');
          },
          onmessage: async (message: LiveServerMessage) => {
            this.debug('Live message received');
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio && this.outputAudioContext && this.outputNode) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError('Live error: ' + e.message);
            console.error('Live error event', e);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Live close: ' + e.reason + ' (' + e.code + ')');
            console.warn('Live close', e);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: {
            parts: [
              {
                text: `You are an AI assistant integrated into an application where the main interface is a live camera view. The user interacts with you by pressing and holding a large button at the bottom of the screen. When the button is active, you listen to the user's voice input and provide an answer based on what is visible through the camera.

Your task is to analyze the live camera feed and interpret the user’s spoken request in combination. Always respond with precise, spatially grounded instructions that reference items or locations visible on the screen.

When giving instructions:

Be specific and concise.

Refer to locations using clear spatial language (e.g., “third shelf from the top,” “top right corner,” “behind the red box,” etc.).

Only describe what is visible on the camera or can be reasonably inferred from it.

Do not invent objects or locations that are not present in the scene.

Keep answers straightforward and helpful.

Example:
If the user asks, “Where is the gluten-free bread?” and it is visible through the camera, respond with a description such as:
“The gluten-free bread is on the third shelf from the top, in the top right corner.”

Your goal is to help the user locate objects in the environment accurately and efficiently based on real-time visual input.`,
              },
            ],
          },
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
            // languageCode: 'en-GB'
          },
        },
      });
    } catch (e) {
      console.error(e);
      return Promise.reject(e);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result.split(',')[1]);
        } else {
          reject(new Error('Failed to read blob as base64 string.'));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private async startRecordingWithStream(stream: MediaStream) {
    if (this.isRecording) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    if (!this.inputAudioContext || !this.outputAudioContext || !this.inputNode || !this.outputNode) {
      throw new Error('Audio contexts not initialized');
    }

    if (!this.sessionPromise) {
      this.sessionPromise = this.initSession();
    }

    this.appStopped = false;
    this.framesSent = 0;

    // Ensure audio contexts are resumed and running before using them
    if (this.inputAudioContext.state !== 'running') {
      await this.inputAudioContext.resume();
    }
    if (this.outputAudioContext.state !== 'running') {
      await this.outputAudioContext.resume();
    }

    this.mediaStream = stream;

    this.videoElement.srcObject = this.mediaStream;
    try {
      await this.videoElement.play();
    } catch (e) {
      console.warn('video.play() failed', e);
    }

    const vt = this.mediaStream.getVideoTracks()[0];
    const at = this.mediaStream.getAudioTracks()[0];
    this.updateStatus('Media access granted. v=' + (!!vt) + ' a=' + (!!at));

    // Ensure we have an audio track before proceeding
    if (!at) {
      throw new Error('No audio track available in media stream');
    }

    // Ensure audio track is enabled and ready
    if (!at.enabled) {
      at.enabled = true;
    }

    // Ensure audio track is ready - wait a bit if needed
    let trackReadyState = at.readyState;
    if (trackReadyState !== 'live') {
      // Wait for track to become live (max 1 second)
      let attempts = 0;
      while (trackReadyState !== 'live' && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        trackReadyState = at.readyState;
        attempts++;
      }
      if (trackReadyState !== 'live') {
        throw new Error('Audio track is not live. State: ' + trackReadyState);
      }
    }

    // Create media stream source only after audio context is running
    if (this.inputAudioContext.state === 'running') {
      try {
        this.sourceNode = this.inputAudioContext.createMediaStreamSource(
          this.mediaStream,
        );
        this.sourceNode.connect(this.inputNode);
      } catch (e) {
        throw new Error('Failed to create media stream source: ' + (e as Error).message);
      }
    } else {
      throw new Error('Audio context is not running. State: ' + this.inputAudioContext.state);
    }

    const bufferSize = 4096;
    this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
      bufferSize,
      1,
      1,
    );

    this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
      if (!this.isRecording) return;
      if (!this.isHolding) return;

      const inputBuffer = audioProcessingEvent.inputBuffer;
      const pcmData = inputBuffer.getChannelData(0);
      const srcRate = this.inputAudioContext.sampleRate;
      const downsampleTo16k = (float32: Float32Array, inRate: number) => {
        if (inRate === 16000) return float32;
        const ratio = inRate / 16000;
        const newLen = Math.floor(float32.length / ratio);
        const result = new Float32Array(newLen);
        let idx = 0, pos = 0;
        while (idx < newLen) {
          const nextPos = Math.min(float32.length - 1, (idx + 1) * ratio);
          let sum = 0, count = 0;
          for (let i = pos; i < nextPos; i++) { sum += float32[i]; count++; }
          result[idx++] = sum / Math.max(1, count);
          pos = nextPos;
        }
        return result;
      };
      const mono16k = srcRate === 16000 ? pcmData : downsampleTo16k(pcmData, srcRate);

      const sessionPromise = this.sessionPromise;
      if (!sessionPromise) {
        return;
      }

      sessionPromise
        .then((session) => {
          session.sendRealtimeInput({media: createBlob(mono16k)});
        })
        .catch((e) => this.updateError('Session send failed: ' + e.message));
    };

    this.sourceNode.connect(this.scriptProcessorNode);
    this.scriptProcessorNode.connect(this.inputAudioContext.destination);

    this.frameInterval = window.setInterval(() => {
      if (!this.isRecording) return;
      const context = this.canvasElement.getContext('2d');
      this.canvasElement.width = this.videoElement.videoWidth;
      this.canvasElement.height = this.videoElement.videoHeight;
      context.drawImage(
        this.videoElement,
        0,
        0,
        this.canvasElement.width,
        this.canvasElement.height,
      );
      this.canvasElement.toBlob(
        async (blob) => {
          if (blob) {
            const base64Data = await this.blobToBase64(blob);
            const sessionPromise = this.sessionPromise;
            if (!sessionPromise) {
              return;
            }

            sessionPromise
              .then((session) => {
                session.sendRealtimeInput({
                  media: {data: base64Data, mimeType: 'image/jpeg'},
                });
                this.framesSent++;
                if (this.framesSent % 10 === 0) {
                  this.debug(`Frames sent: ${this.framesSent}`);
                }
              })
              .catch((e) =>
                this.updateError('Session send (image) failed: ' + e.message),
              );
          }
        },
        'image/jpeg',
        0.8,
      );
    }, 500); // 2 frames per second

    this.isRecording = true;
    this.updateStatus('');
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    if (!this.inputAudioContext || !this.outputAudioContext) {
      throw new Error('Audio contexts not initialized');
    }

    await this.inputAudioContext.resume();
    await this.outputAudioContext.resume();

    this.updateStatus('Requesting camera/mic access...');

    try {
      const preferBackCamera = async (): Promise<MediaStream> => {
        const constraints: MediaStreamConstraints = {
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: {
            facingMode: { ideal: 'environment' },
          },
        };
        this.debug('getUserMedia with constraints', constraints);
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          const track = stream.getVideoTracks()[0];
          const settings = track?.getSettings?.() || {} as MediaTrackSettings;
          this.debug('Acquired stream video settings', settings);
          if (settings.facingMode !== 'environment') {
            // Try enumerate fallback to enforce back camera
            const devices = await navigator.mediaDevices.enumerateDevices();
            const back = devices.find(
              (d) => d.kind === 'videoinput' && /back|rear|environment/i.test(d.label),
            );
            if (back) {
              try {
                const enforced = await navigator.mediaDevices.getUserMedia({
                  audio: constraints.audio,
                  video: { deviceId: { exact: back.deviceId } },
                });
                this.debug('Enforced back camera via deviceId', back);
                stream.getTracks().forEach((t) => t.stop());
                return enforced;
              } catch {
                // fall through to original stream
              }
            }
          }
          return stream;
        } catch (e) {
          this.updateError('getUserMedia failed: ' + (e as Error).message);
          const devices = await navigator.mediaDevices.enumerateDevices();
          const back = devices.find(
            (d) => d.kind === 'videoinput' && /back|rear|environment/i.test(d.label),
          );
          if (back) {
            return await navigator.mediaDevices.getUserMedia({
              audio: constraints.audio,
              video: { deviceId: { exact: back.deviceId } },
            });
          }
          throw e;
        }
      };

      const stream = await preferBackCamera();
      await this.startRecordingWithStream(stream);
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('');

    this.isRecording = false;

    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    this.framesSent = 0;
    this.updateStatus('');
  }

  private stopApplication() {
    if (this.appStopped) {
      return;
    }

    this.stopRecording();

    for (const source of this.sources.values()) {
      try {
        source.stop();
      } catch {}
      this.sources.delete(source);
    }

    const sessionPromise = this.sessionPromise;
    this.sessionPromise = undefined;

    sessionPromise
      ?.then((session) => session.close())
      .catch((e) => this.updateError('Session close failed: ' + e.message));

    this.videoElement?.pause();
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    this.appStopped = true;
    this.updateStatus('Session ended');
  }

  private async restartApplication() {
    if (this.isRecording) {
      return;
    }

    this.updateStatus('Restarting session...');
    this.sessionPromise = this.initSession();
    this.appStopped = false;

    try {
      await this.startRecording();
    } catch (error) {
      this.updateError('Restart failed: ' + (error as Error).message);
    }
  }

  private reset() {
    this.sessionPromise?.then((session) => session.close());
    this.sessionPromise = this.initSession();
    this.updateStatus('');
  }

  private async handleStartSession() {
    if (this.sessionStarted) {
      return;
    }
    
    this.sessionStarted = true;
    this.updateStatus('Requesting camera/mic access...');
    
    let stream: MediaStream | null = null;
    
    try {
      // Create audio contexts within user gesture for iOS PWA compatibility
      // This MUST be done synchronously from the event handler
      if (!this.inputAudioContext) {
        this.inputAudioContext = new (window.AudioContext ||
          (window as any).webkitAudioContext)({sampleRate: 16000});
      }
      if (!this.outputAudioContext) {
        this.outputAudioContext = new (window.AudioContext ||
          (window as any).webkitAudioContext)({sampleRate: 24000});
      }
      
      // Create gain nodes if they don't exist
      if (!this.inputNode) {
        this.inputNode = this.inputAudioContext.createGain();
        this.inputNode.gain.value = 0.0; // Start with mic muted
      }
      if (!this.outputNode) {
        this.outputNode = this.outputAudioContext.createGain();
        this.outputNode.connect(this.outputAudioContext.destination);
      }
      
      // Initialize session if not already done
      if (!this.sessionPromise) {
        this.sessionPromise = this.initSession();
      }
      
      // Request permissions directly from user gesture handler
      // This MUST be called synchronously from the event handler on iOS
      const constraints: MediaStreamConstraints = {
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          facingMode: { ideal: 'environment' },
        },
      };
      
      // Call getUserMedia immediately to preserve user gesture context
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Ensure audio contexts are running (they should be already, but check)
      if (this.inputAudioContext.state !== 'running') {
        await this.inputAudioContext.resume();
      }
      if (this.outputAudioContext.state !== 'running') {
        await this.outputAudioContext.resume();
      }
      
      // Small delay to ensure audio contexts are fully ready
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Initialize audio timing
      this.initAudio();
      
      // Now start recording with the stream
      await this.startRecordingWithStream(stream);
    } catch (err) {
      console.error('Error starting session:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.updateError('Failed to access camera/microphone: ' + errorMessage);
      this.sessionStarted = false; // Allow retry on error
      
      // Clean up stream if it was created
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    }
  }

  private async handleHoldStart() {
    if (!this.isRecording) {
      if (this.appStopped) {
        await this.restartApplication();
      } else {
        try {
          await this.startRecording();
        } catch (err) {
          console.error('Error starting recording:', err);
          return;
        }
      }
    }
    
    this.isHolding = true;
    if (this.inputNode) {
      this.inputNode.gain.value = 1.0;
    }
  }

  private handleHoldEnd() {
    this.isHolding = false;
    if (this.inputNode) {
      this.inputNode.gain.value = 0.0;
    }
  }

  render() {
    return html`
      <div class="layout">
        <video
          id="video-background"
          autoplay
          muted
          playsinline
          ?hidden=${this.appStopped}></video>
        <canvas id="frame-canvas" style="display:none"></canvas>
        ${this.error
          ? html`<div class="error-banner" role="alert">${this.error}</div>`
          : null}
        ${!this.sessionStarted
          ? html`
              <button
                class="start-button"
                type="button"
                aria-label="Start Session"
                @click=${this.handleStartSession}
                @touchstart=${(e: TouchEvent) => {
                  e.preventDefault();
                  this.handleStartSession();
                }}>
                Start Session
              </button>
            `
          : null}
        <div class="speak-area">
          ${this.inputNode && this.outputNode
            ? html`<gdm-live-audio-visuals-3d
                .inputNode=${this.inputNode}
                .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>`
            : null}
          ${this.appStopped
            ? html`<div class="session-overlay">Session Ended</div>`
            : null}
          <button
            class="speak-button"
            type="button"
            aria-pressed=${this.isHolding}
            aria-label=${this.isHolding ? 'Release to mute' : 'Hold to speak'}
            @touchstart=${(e: TouchEvent) => {
              e.preventDefault();
              this.handleHoldStart();
            }}
            @touchend=${(e: TouchEvent) => {
              e.preventDefault();
              this.handleHoldEnd();
            }}
            @touchcancel=${(e: TouchEvent) => {
              e.preventDefault();
              this.handleHoldEnd();
            }}
            @mousedown=${(e: MouseEvent) => {
              e.preventDefault();
              this.handleHoldStart();
            }}
            @mouseup=${(e: MouseEvent) => {
              e.preventDefault();
              this.handleHoldEnd();
            }}
            @mouseleave=${(e: MouseEvent) => {
              e.preventDefault();
              this.handleHoldEnd();
            }}>
            <span class="speak-label">
              ${this.isHolding ? 'Release to Mute' : 'Hold to Speak'}
            </span>
          </button>
        </div>
      </div>
    `;
  }
}
