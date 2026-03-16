/**
 * Text-to-speech utilities wrapping the Web Speech API.
 */

let voicesLoaded = false
let voicesPromise = null

export function getAvailableVoices() {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([])

  const voices = speechSynthesis.getVoices()
  if (voices.length > 0) return Promise.resolve(voices)

  if (voicesPromise) return voicesPromise
  voicesPromise = new Promise(resolve => {
    const handler = () => {
      voicesLoaded = true
      resolve(speechSynthesis.getVoices())
      speechSynthesis.removeEventListener('voiceschanged', handler)
    }
    speechSynthesis.addEventListener('voiceschanged', handler)
    // Fallback if event never fires
    setTimeout(() => {
      if (!voicesLoaded) resolve(speechSynthesis.getVoices())
    }, 1000)
  })
  return voicesPromise
}

export function speak(text, voiceName, volume = 0.7) {
  if (typeof speechSynthesis === 'undefined') return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.volume = volume
  if (voiceName) {
    const voices = speechSynthesis.getVoices()
    const match = voices.find(v => v.name === voiceName)
    if (match) utterance.voice = match
  }
  speechSynthesis.speak(utterance)
}

export function cancelSpeech() {
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel()
  }
}

export const TTS_TEMPLATES = {
  needsInput: (ctx) => `Session ${ctx.projectLabel} needs your input`,
  sessionError: (ctx) => `Session ${ctx.projectLabel} encountered an error`,
  sessionComplete: (ctx) => `Session ${ctx.projectLabel} has completed`,
  newSession: (ctx) => `New session started: ${ctx.projectLabel}`,
  taskUpdate: () => `Task board updated`,
  intelligenceReady: () => `Intelligence analysis ready`,
  sessionUpdate: () => null, // too frequent for TTS
  teamUpdate: () => null,
  historyUpdate: () => null,
}
