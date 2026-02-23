import { Writable } from 'node:stream';

export interface StreamingCallbacks {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface StreamingBridge {
  stdout?: Writable;
  stderr?: Writable;
}

export function createStreamingBridge(callbacks: StreamingCallbacks): StreamingBridge {
  const bridge: StreamingBridge = {};
  if (callbacks.onStdout) {
    bridge.stdout = new Writable({
      write(chunk, _encoding, callback) {
        callbacks.onStdout!(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
        callback();
      },
    });
  }
  if (callbacks.onStderr) {
    bridge.stderr = new Writable({
      write(chunk, _encoding, callback) {
        callbacks.onStderr!(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
        callback();
      },
    });
  }
  return bridge;
}
