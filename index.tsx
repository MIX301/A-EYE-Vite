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
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  }).catch(() => {});
} catch {}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';

  private client: GoogleGenAI;
  private sessionPromise: Promise<Session>;
  // FIX: Cast window to `any` to access prefixed `webkitAudioContext` for older browsers.
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  // FIX: Cast window to `any` to access prefixed `webkitAudioContext` for older browsers.
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
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
    #video-background {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 50vh;
      object-fit: cover;
    }

    gdm-live-audio-visuals-3d {
      display: block;
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 50vh;
    }

    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
      text-shadow: 0 0 4px black;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        backdrop-filter: blur(10px);

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button[disabled] {
        display: none;
      }
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
        await this.outputAudioContext.resume();
        await this.inputAudioContext.resume();
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

  private debug(msg: string, data?: unknown) {
    console.log(`[gdm] ${msg}`, data ?? '');
    this.status = msg;
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    if (!process.env.API_KEY || process.env.API_KEY === 'undefined') {
      this.updateError('Missing GEMINI_API_KEY');
    }

    this.client = new GoogleGenAI({apiKey: process.env.API_KEY});

    this.outputNode.connect(this.outputAudioContext.destination);

    this.sessionPromise = this.initSession();
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

            if (audio) {
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
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Orus'}},
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

  private async startRecording() {
    if (this.isRecording) {
      return;
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

      this.mediaStream = await preferBackCamera();

      this.videoElement.srcObject = this.mediaStream;
      try {
        await this.videoElement.play();
      } catch (e) {
        console.warn('video.play() failed', e);
      }

      const vt = this.mediaStream.getVideoTracks()[0];
      const at = this.mediaStream.getAudioTracks()[0];
      this.updateStatus('Media access granted. v=' + (!!vt) + ' a=' + (!!at));

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 4096;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

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

        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({media: createBlob(mono16k)});
        }).catch((e) => this.updateError('Session send failed: ' + e.message));
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
              this.sessionPromise
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
      this.updateStatus('🔴 Recording... Capturing audio+video');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

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

    this.updateStatus('Recording stopped. Click Start to begin again.');
  }

  private reset() {
    this.sessionPromise?.then((session) => session.close());
    this.sessionPromise = this.initSession();
    this.updateStatus('Session cleared.');
  }

  render() {
    return html`
      <div>
        <video id="video-background" autoplay muted playsinline></video>
        <canvas id="frame-canvas" style="display:none"></canvas>
        <div class="controls">
          <button
            id="resetButton"
            @click=${this.reset}
            ?disabled=${this.isRecording}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 -960 960 960"
              width="40px"
              fill="#ffffff">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
          </button>
          <button
            id="startButton"
            @click=${this.startRecording}
            ?disabled=${this.isRecording}>
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#c80000"
              xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="50" />
            </svg>
          </button>
          <button
            id="stopButton"
            @click=${this.stopRecording}
            ?disabled=${!this.isRecording}>
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#000000"
              xmlns="http://www.w3.org/2000/svg">
              <rect x="0" y="0" width="100" height="100" rx="15" />
            </svg>
          </button>
        </div>

        <div id="status"> ${this.status || this.error} </div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
