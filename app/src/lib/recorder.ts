import { Audio } from 'expo-av';

export const CHUNK_MS = 45000;
export const MAX_SEGMENT_RETRIES = 2;
export const RETRY_DELAY_MS = 1000;

export interface RecordedChunk {
  uri: string;
  startedAt: string;
  endedAt: string;
  index: number;
}

export type ChunkCallback = (chunk: RecordedChunk) => void;
export type RecorderErrorCallback = (message: string) => void;

export interface RecorderLimit {
  maxMs: number;
  // Called after the last chunk was delivered and the recorder stopped itself.
  onLimit: () => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ChunkRecorder {
  private current: Audio.Recording | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopRequested = false;
  private finishing = false;
  private chunkIndex = 0;
  private wallStartMs = 0;
  private onChunk: ChunkCallback | null = null;
  private onError: RecorderErrorCallback | null = null;
  private deadlineMs: number | null = null;
  private onLimit: (() => void) | null = null;

  isRunning(): boolean {
    return this.running;
  }

  async start(
    onChunk: ChunkCallback,
    onError?: RecorderErrorCallback,
    limit?: RecorderLimit,
  ): Promise<void> {
    if (this.running) return;
    this.onChunk = onChunk;
    this.onError = onError ?? null;
    this.onLimit = limit?.onLimit ?? null;
    this.chunkIndex = 0;
    this.stopRequested = false;
    this.finishing = false;

    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Χρειάζεται άδεια μικροφώνου για την καταγραφή.');
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });

    this.running = true;
    // The allowance counts recorded time, so the clock starts after the permission prompt.
    this.deadlineMs = limit ? Date.now() + limit.maxMs : null;
    await this.beginSegment(MAX_SEGMENT_RETRIES);
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.finishing) {
      await sleep(25);
    }
    if (this.current) {
      await this.finishSegment();
    }
    this.onChunk = null;
    this.onError = null;
    this.onLimit = null;
  }

  private async beginSegment(retriesLeft: number): Promise<void> {
    if (!this.running || this.stopRequested) return;
    try {
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      if (this.stopRequested) {
        try {
          await recording.stopAndUnloadAsync();
        } catch {
          // Ignore: the segment never became part of the session.
        }
        return;
      }
      this.current = recording;
      this.wallStartMs = Date.now();
      const untilDeadline =
        this.deadlineMs === null ? CHUNK_MS : Math.max(0, this.deadlineMs - this.wallStartMs);
      this.timer = setTimeout(() => {
        void this.handleSegmentBoundary();
      }, Math.min(CHUNK_MS, untilDeadline));
    } catch (error) {
      if (retriesLeft > 0 && this.running && !this.stopRequested) {
        await sleep(RETRY_DELAY_MS);
        return this.beginSegment(retriesLeft - 1);
      }
      this.running = false;
      this.onError?.(`Η καταγραφή δεν ξεκίνησε: ${errorMessage(error)}`);
    }
  }

  private async handleSegmentBoundary(): Promise<void> {
    if (this.finishing) return;
    await this.finishSegment();
    if (!this.running || this.stopRequested) return;
    // Half a second of slack so a timer firing marginally early cannot start a sliver segment.
    if (this.deadlineMs !== null && Date.now() >= this.deadlineMs - 500) {
      this.running = false;
      const onLimit = this.onLimit;
      this.onChunk = null;
      this.onError = null;
      this.onLimit = null;
      onLimit?.();
      return;
    }
    await this.beginSegment(MAX_SEGMENT_RETRIES);
  }

  private async finishSegment(): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const recording = this.current;
    this.current = null;
    const index = this.chunkIndex;
    const endedMs = Date.now();
    let uri: string | null = null;

    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
        uri = recording.getURI();
      } catch (error) {
        this.onError?.(`Ένα τμήμα δεν ολοκληρώθηκε: ${errorMessage(error)}`);
      }
    }

    const startedAt = new Date(this.wallStartMs).toISOString();
    const endedAt = new Date(endedMs).toISOString();
    this.chunkIndex += 1;
    this.finishing = false;

    if (uri) {
      this.onChunk?.({ uri, startedAt, endedAt, index });
    }
  }
}

export const recorder = new ChunkRecorder();
