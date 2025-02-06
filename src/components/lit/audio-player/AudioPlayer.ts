import { getInstantVolume, getSimpleInstantLUFS } from "@/utils/helpers";
import { LitElement, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";

@customElement("oh-audio-player")
export class AudioPlayer extends LitElement {
  @property()
  src!: string;

  @property()
  audioContext!: AudioContext;

  @query("#audio-file") audio!: HTMLAudioElement;

  private analyser!: AnalyserNode;
  private dataArray!: Uint8Array;
  private bufferLength!: number;

  private getValues() {
    let lufs = null;
    let rms = null;
    if (!this.audio.paused) {
      rms = getInstantVolume(this.bufferLength, this.dataArray, this.analyser);
      lufs = getSimpleInstantLUFS(rms);
    }
    this.dispatchEvent(
      new CustomEvent("volume-change", {
        detail: { rms, lufs },
      })
    );

    requestAnimationFrame(() => this.getValues());
  }

  protected async firstUpdated() {
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;

    const audioSource = this.audioContext.createMediaElementSource(this.audio);
    audioSource.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);

    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    this.getValues();
  }

  render() {
    return html` <audio id="audio-file" controls src="${this.src}"></audio> `;
  }
}
