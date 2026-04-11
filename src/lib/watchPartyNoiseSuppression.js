import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'

let rnnoiseBinaryPromise = null

function getAudioContextConstructor() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.AudioContext || window.webkitAudioContext || null
}

async function loadRnnoiseBinary() {
  if (!rnnoiseBinaryPromise) {
    rnnoiseBinaryPromise = loadRnnoise({
      url: rnnoiseWasmUrl,
      simdUrl: rnnoiseSimdWasmUrl,
    }).catch((error) => {
      rnnoiseBinaryPromise = null
      throw error
    })
  }

  return rnnoiseBinaryPromise
}

export async function createNoiseSuppressedMicrophoneSource({ constraints = {} } = {}) {
  const AudioContextConstructor = getAudioContextConstructor()
  if (!AudioContextConstructor) {
    throw new Error('Noise suppression requires Web Audio support in this runtime.')
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Noise suppression requires microphone capture support in this runtime.')
  }

  let audioContext = null
  let inputStream = null
  let sourceNode = null
  let suppressorNode = null
  let destinationNode = null
  let processedTrack = null

  const cleanup = async () => {
    try {
      sourceNode?.disconnect()
    } catch {
      // Best effort cleanup only.
    }

    try {
      suppressorNode?.disconnect()
    } catch {
      // Best effort cleanup only.
    }

    try {
      suppressorNode?.destroy?.()
    } catch {
      // Best effort cleanup only.
    }

    inputStream?.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        // Best effort cleanup only.
      }
    })

    if (processedTrack) {
      try {
        processedTrack.stop()
      } catch {
        // Best effort cleanup only.
      }
    }

    if (audioContext) {
      try {
        await audioContext.close()
      } catch {
        // Best effort cleanup only.
      }
    }
  }

  try {
    audioContext = new AudioContextConstructor({
      sampleRate: 48000,
      latencyHint: 'interactive',
    })

    inputStream = await navigator.mediaDevices.getUserMedia({
      audio: constraints,
    })

    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => {})
    }

    const wasmBinary = await loadRnnoiseBinary()
    await audioContext.audioWorklet.addModule(rnnoiseWorkletUrl)

    sourceNode = audioContext.createMediaStreamSource(inputStream)
    suppressorNode = new RnnoiseWorkletNode(audioContext, {
      maxChannels: 1,
      wasmBinary,
    })
    destinationNode = audioContext.createMediaStreamDestination()

    sourceNode.connect(suppressorNode)
    suppressorNode.connect(destinationNode)

    ;[processedTrack] = destinationNode.stream.getAudioTracks()

    if (!processedTrack) {
      throw new Error('Noise suppression could not create a processed microphone track.')
    }

    processedTrack.enabled = true

    return {
      track: processedTrack,
      cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}
