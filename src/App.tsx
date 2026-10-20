import { useEffect, useRef } from 'react'
import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'
import { Boot } from './ui/Boot'
import { Ignition } from './ui/Ignition'
import { Diagnostics } from './ui/Diagnostics'
import { ActionCard } from './ui/ActionCard'
import { phoneAction, showCard } from './lib/actions'
import { learnFrom, memoryAction, userName } from './lib/memory'
import { offerEmail, offerPdf, parseEmail } from './lib/documents'
import { keepAwake } from './lib/awake'
import { savedPlace, trackLocation, welcome } from './lib/weather'
import { nearbyNote, nearbyRequest } from './lib/places'
import {
  googleCommand,
  googleContext,
  googleNeed,
  googleReady,
  googleReply,
  justConnected,
  refreshGoogleAccount,
  takePendingQuestion,
} from './lib/google'
import { AUDIO_EVENT, spoken, voicePrompt, type VoiceNote } from './lib/voicenote'
import { isScamRequest, openScan, SCAN_EVENT, scamPanel, scamPrompt, scanForScam } from './lib/scam'
import { InfoPanel } from './ui/InfoPanel'
import { WakeVoice } from './ui/WakeVoice'
import { TapToHear } from './ui/TapToHear'
import { Toolbar } from './ui/Toolbar'
import { isLookRequest, PHOTO_EVENT, useLook, type Photo } from './lib/photo'
import {
  closeInfo,
  imageRequest,
  makePanelSplitter,
  mergeInfo,
  parsePanel,
  pictureSubject,
  showInfo,
  useInfoPanel,
  wikiCard,
  wikiImages,
  type GalleryImage,
} from './lib/infoPanel'
import { chartFor, symbolChart } from './lib/charts'
import { useStore } from './store'
import { startVoice, type Voice, type VoiceMode } from './lib/voice'
import { createSpeaker, cycleVoice, currentVoiceName, unlockSpeech, voiceCommand, IOS } from './lib/tts'
import * as sfx from './lib/sfx'
import * as music from './lib/music'
import * as hands from './lib/hands'
import { listenForClap } from './lib/clap'
import * as camera from './lib/camera'
import * as kokoro from './lib/kokoro'
import { DIRECT_BRAIN, TTS_ENGINE } from './config'
import { forTool, attention } from './lib/fillers'
import {
  ask,
  warm,
  interrupt,
  watchServers,
  watchPanels,
  watchBlades,
  watchCapture,
  watchUi,
  watchConnection,
  connectedLabels,
  usingBridge,
  type Media,
  type Msg,
} from './lib/brain'
import { startAnalyser, micLevel } from './lib/audio'
import { probeCapabilities } from './lib/capabilities'
import { hasDirectKey } from './config'

/**
 * The conversation.
 *
 * This used to be a sequential loop — greet, await a capture, await an answer,
 * repeat — with the microphone opened and closed around each step. That shape
 * cannot be interrupted: while it is awaiting the answer, nothing is listening,
 * so there is no way for the user to get a word in.
 *
 * It is an event machine now. The voice loop runs continuously and pushes
 * events at us; every one of them is legal in every phase. Saying anything at
 * all stops him talking, and whatever you say next becomes the new turn.
 */

/** How long to wait for someone to start speaking after he wakes. Generous:
 *  people say his name and *then* think about what they wanted. */
const AWAIT_SPEECH_MS = 14000

/** After an answer, how long the mic stays open for a follow-up before he
 *  drops back to standby. Long enough that you don't have to say the name
 *  again to continue a thought. */
const FOLLOW_UP_MS = 11000

/** crypto.randomUUID needs a secure context, which a LAN address over plain
 *  http is not. Not worth failing a whole turn over an id. */
const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** The same mishearings voice.ts accepts for the wake word — otherwise a turn
 *  that woke her as "tanya" gets that word sent on to the model as a question. */
const NAME = '(?:danya|dania|daniya|daniyah|dhanya|donya|dunya|denya|danja|tanya|tania)'
/** A bare vocative — "Danya", "hey danya" — with nothing asked. */
const BARE_NAME = new RegExp(`^(?:hey|hi|ok|okay|yo)?\\s*${NAME}[\\s,.!?]*$`, 'i')
/** A leading vocative on a real command: "Jarvis, what's the weather". */
const LEADING_NAME = new RegExp(`^(?:hey|hi|ok|okay|yo)?\\s*${NAME}\\b[\\s,.:!?-]*`, 'i')

export default function App() {
  const store = useStore
  const phase = useStore((s) => s.phase)
  const history = useRef<Msg[]>([])
  const speaker = useRef<ReturnType<typeof createSpeaker> | null>(null)
  const voice = useRef<Voice | null>(null)

  /**
   * Monotonic turn counter. Every await in a turn checks it on the way out:
   * if it has moved, that turn was superseded by a barge-in and must not touch
   * the phase, the speaker, or the busy state on its way to the floor.
   */
  const turn = useRef(0)
  const booting = useRef(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const voicePoll = useRef<ReturnType<typeof setInterval> | null>(null)

  // -- helpers --------------------------------------------------------------

  const clearIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = null
  }

  const silence = () => {
    speaker.current?.cancel()
    speaker.current = null
  }

  const goDormant = () => {
    clearIdle()
    silence()
    turn.current++
    const s = store.getState()
    s.setCaption('')
    s.setActiveTool(null)
    music.working(false)
    music.duck(false)
    sfx.duck(false)
    s.setPhase('dormant')
  }

  /** Open the mic and wait. `window` is how long before he gives up. */
  const listen = (window: number) => {
    clearIdle()
    const s = store.getState()
    s.setCaption('')
    s.setPhase('listening')
    sfx.play('listen')
    idleTimer.current = setTimeout(goDormant, window)
  }

  // -- one turn -------------------------------------------------------------

  /**
   * `exact`, when given, is sent to the model as it is, in place of what was
   * said, and skips everything worked out on the device (phone actions, charts,
   * pictures) — for pasted text such as a message to check for scams, which
   * must never be acted on.
   */
  const respond = async (said: string, image?: Media, exact?: string): Promise<void> => {
    const mine = ++turn.current
    const stale = () => mine !== turn.current

    clearIdle()
    const s = store.getState()
    // Last turn's panels and blades go now, before the new answer starts
    // putting its own up. Anything the model marked sticky survives.
    s.clearPanels()
    s.clearBlades()
    s.setCaption('')
    s.pushTurn({ id: newId(), role: 'user', text: said })
    s.setPhase('thinking')
    closeInfo()

    const spk = createSpeaker()
    speaker.current = spk
    sfx.duck(true)
    music.duck(true)

    // Memory ("my name is…", "remember that…") and phone actions ("call Ali",
    // "open Instagram", …) are answered here on the device: instant, no model
    // call, and phone actions always sit behind a button to tap.
    const remembered = exact === undefined ? (memoryAction(said) ?? voiceCommand(said)) : null
    if (remembered) store.getState().setVoice(currentVoiceName())
    // "What am I looking at?" with no photo yet: iOS only opens the camera
    // from a tap, so light up the camera button and ask for one.
    const wantsLook = exact === undefined && !image && !usingBridge && isLookRequest(said)
    if (wantsLook) useLook.setState({ pending: said })
    // "Is this a scam?" with nothing to check: open the paste box.
    const wantsScan = exact === undefined && !image && !usingBridge && isScamRequest(said)
    if (wantsScan) openScan()
    // Gmail and Calendar: "connect Google", or a question that needs them while
    // signed out, gets a Connect button; the question is asked again after.
    const gCommand = exact === undefined && !usingBridge ? googleCommand(said) : null
    const gNeed = exact === undefined && !usingBridge && !image && !gCommand ? googleNeed(said) : null
    const gLocal = gCommand || (gNeed && !googleReady()) ? googleReply(gCommand, gNeed ? said : undefined) : null
    const local = remembered
      ? { say: remembered, card: undefined }
      : wantsLook
        ? { say: 'Sure! Tap the camera button up top and take a photo, or pick a screenshot.', card: undefined }
        : wantsScan
          ? { say: 'Sure. Paste the message, email or link in the box, then tap Check it.', card: undefined }
          : gLocal
            ? gLocal
            : exact === undefined
              ? phoneAction(said)
              : null
    if (local) {
      if (local.card) showCard(local.card)
      s.pushTurn({ id: newId(), role: 'jarvis', text: local.say })
      s.setPhase('speaking')
      spk.say(local.say)
      await spk.end().catch(() => {})
      if (stale()) return
      speaker.current = null
      sfx.duck(false)
      music.duck(false)
      listen(FOLLOW_UP_MS)
      return
    }

    // Signed in and the question needs Gmail or Calendar: read them first, so
    // the answer is about the real inbox and the real week.
    const googleNote = gNeed && googleReady() ? await googleContext(gNeed) : ''
    if (stale()) return

    const turnId = newId()
    let started = false
    let filled = false

    // "Who is…", "tell me about…", "show me a picture of…": fetch a Wikipedia
    // picture and summary alongside the answer. Free, and shown the moment it
    // arrives; a panel the model writes later keeps the picture.
    let wiki: Awaited<ReturnType<typeof wikiCard>> = null

    // "Bitcoin chart", "price of gold": a live chart goes up at once, and the
    // model is told it is there so its analysis is about that market.
    // "Cafes near me", "nearest pharmacy": a Maps button at once, and the model
    // is told where the user is so it names real places there. No encyclopedia
    // picture or chart for these.
    const nearby = usingBridge || exact !== undefined ? null : nearbyRequest(said)
    const place = savedPlace()
    if (nearby) {
      showCard({
        title: `📍 ${nearby.label} near you`,
        detail: `${place ? `Around ${place}. ` : ''}Photos, reviews, opening hours and directions are in Maps.`,
        href: nearby.maps,
        button: 'Google Maps',
        extra: { label: 'Apple Maps', href: nearby.apple },
        keep: true,
      })
    }

    const chart = usingBridge || exact !== undefined || nearby ? null : chartFor(said)
    if (chart) {
      showInfo({
        title: `${chart.label} · live chart`,
        lines: [],
        chart: { url: chart.url, label: chart.label, link: chart.link, embeddable: chart.embeddable },
      })
    }
    // A site said without https:// ("summarise bbc.com") becomes a full link,
    // which is what lets the model's URL tool open and read it.
    const sites = [...said.matchAll(/\b(?<!@)((?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|co|lk|in|uk|my|edu|gov|news|app|dev|info|me|tv)(?:\/[^\s]*)?)\b/gi)]
      .map((m) => m[1])
      .filter((s) => !/^https?:\/\//i.test(s))
    const prompt =
      exact ??
      (chart ? `${said}\n\n[A live ${chart.label} chart (${chart.symbol}) is on the user's screen now.]` : said) +
        (nearby ? `\n\n${nearbyNote(nearby, place)}` : '') +
        (googleNote ? `\n\n${googleNote}` : '') +
        (sites.length ? `\n\n[Links: ${sites.map((s) => `https://${s.replace(/^www\./i, 'www.')}`).join(' ')}]` : '')

    // "Show me pictures of…", "what does … look like": a gallery from
    // Wikimedia Commons, up as soon as it arrives. The model can ask for one
    // too, with an IMAGES: line in its panel (handled after the answer).
    const addGallery = (query: string) => {
      const title = query.replace(/^\w/, (c) => c.toUpperCase())
      // Openverse's photos arrive later; add them only if the panel is still up.
      const more = (gallery: GalleryImage[]) => {
        if (!stale() && useInfoPanel.getState().panel) mergeInfo({ gallery, galleryQuery: query }, title)
      }
      void wikiImages(query, 6, more).then((gallery) => {
        if (!gallery.length || stale()) return
        mergeInfo({ gallery, galleryQuery: query }, title)
      })
    }
    const imagesFor = usingBridge || chart || nearby || exact !== undefined ? null : imageRequest(said)
    if (imagesFor) addGallery(imagesFor)

    const subject = usingBridge || chart || nearby || imagesFor || exact !== undefined ? null : pictureSubject(said)
    if (subject) {
      void wikiCard(subject).then((card) => {
        if (!card || stale()) return
        wiki = card
        const current = useInfoPanel.getState().panel
        showInfo(current ? { ...current, image: current.image ?? card.image, source: current.source ?? card.source } : card)
      })
    }

    // The model's on-screen panel arrives inline between markers; this keeps it
    // out of the voice and the transcript.
    const splitter = makePanelSplitter()
    const speakDelta = (delta: string) => {
      if (!delta || stale()) return
      if (!started) {
        started = true
        store.getState().setPhase('speaking')
        store.getState().setActiveTool(null)
        music.working(false)
        store.getState().pushTurn({ id: turnId, role: 'jarvis', text: '' })
      }
      store.getState().appendToLastTurn(delta)
      spk.push(delta)
    }

    try {
      const { text } = await ask(prompt, history.current, {
        // Code she ran, its output, and charts it drew: straight to the panel.
        onArtifact: (a) => {
          if (stale()) return
          const current = useInfoPanel.getState().panel
          if (a.code) {
            mergeInfo({ code: current?.code ? `${current.code}\n\n${a.code}` : a.code, ran: true })
          } else if (a.output !== undefined) {
            mergeInfo({ output: current?.output ? `${current.output}\n${a.output}` : a.output })
          } else if (a.image) {
            mergeInfo({ images: [a.image] })
          } else if (a.sources) {
            mergeInfo({ sources: a.sources }, 'From the web')
          }
        },
        onText: (raw) => {
          if (stale()) return
          const delta = splitter.push(raw)
          if (!delta) return
          if (!started) {
            started = true
            store.getState().setPhase('speaking')
            // The answer arriving is what ends the tool phase — a timer would
            // clear the readout while a slow tool was still running.
            store.getState().setActiveTool(null)
            music.working(false)
            store.getState().pushTurn({ id: turnId, role: 'jarvis', text: '' })
          }
          store.getState().appendToLastTurn(delta)
          spk.push(delta)
        },
        onTool: (name) => {
          if (stale()) return
          // Only claim the tooling phase while he has nothing to say yet.
          // Setting it unconditionally pinned the machine in 'tooling' for the
          // rest of any answer that called a tool after it started talking,
          // which also broke the reactor's lip-sync for the remainder.
          if (!started) store.getState().setPhase('tooling')
          store.getState().setActiveTool(name)
          sfx.play('tool')
          music.working(true)
          // Say something the moment work starts — a tool can take ten seconds
          // and silence that long reads as a crash. Once per turn only; a
          // chain of five tools shouldn't produce five apologies.
          if (!filled && !started) {
            filled = true
            spk.say(forTool(name))
          }
        },
      }, image)

      if (stale()) return

      speakDelta(splitter.end())
      const panel = parsePanel(splitter.panel())
      if (panel) {
        // The model's title and points, over whatever is already up: the live
        // chart, the picture, code it actually ran and that code's output.
        const card = wiki as Awaited<ReturnType<typeof wikiCard>>
        const current = useInfoPanel.getState().panel
        showInfo({
          ...current,
          title: panel.title,
          lines: panel.lines,
          code: current?.code ?? panel.code,
          ran: current?.code ? current.ran : false,
          image: current?.image ?? card?.image,
          source: current?.source ?? card?.source,
        })
        if (panel.imageQuery && !imagesFor) addGallery(panel.imageQuery)
        // The model named a market ("CHART: MYX:MAYBANK", any exchange in the
        // world): put its chart up, unless one is already showing.
        if (panel.chartSymbol && !useInfoPanel.getState().panel?.chart) {
          const c = symbolChart(panel.chartSymbol)
          mergeInfo({ chart: { url: c.url, label: c.label, link: c.link, embeddable: c.embeddable } })
        }
      }

      // A document she wrote becomes a PDF; an email she drafted opens in the
      // user's own mail app. Nothing leaves the phone until they tap.
      const doc = splitter.pdf()
      const mail = parseEmail(splitter.email())
      if (doc) void offerPdf(doc, mail)
      else if (mail) offerEmail(mail)

      // What she noticed worth remembering about the user. Never from pasted
      // text (a message checked for scams is someone else's words).
      if (exact === undefined) learnFrom(splitter.memory())

      // The bridge keeps conversation state in its own session, so history is
      // only threaded through on the direct path.
      // The photo itself is not kept — only that one was shown — so the
      // history stays small enough to send with every question.
      if (!usingBridge) {
        // A checked message is kept whole, so "what should I reply?" works next.
        // The photo or recording itself is not kept, only that one was shared.
        const shared = !image ? '' : typeof image === 'string' ? '[showed a photo] ' : '[shared a recording] '
        history.current.push({ role: 'user', content: `${shared}${exact ?? said}` })
        history.current.push({ role: 'assistant', content: text || '…' })
        if (history.current.length > 30) {
          history.current = history.current.slice(-30)
        }
      }

      await spk.end()
      if (stale()) return
      sfx.play('done')
    } catch (err) {
      if (stale()) return
      console.error(err)
      sfx.play('error')
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      store.getState().setError(message)
      // Say it as well. A voice assistant whose only error is a line of small
      // print looks exactly like one that is not working at all.
      spk.say(
        /limit|429/i.test(message)
          ? "I've reached my free limit for now. Try again in a minute."
          : "Sorry, I couldn't get an answer just now. Please try again.",
      )
      await spk.end().catch(() => {})
    } finally {
      if (!stale()) {
        speaker.current = null
        sfx.duck(false)
        music.duck(false)
        store.getState().setActiveTool(null)
        music.working(false)
        // Stay open. Having to say his name again to add one more sentence is
        // the difference between a conversation and a vending machine.
        listen(FOLLOW_UP_MS)
      }
    }
  }

  // -- voice events ---------------------------------------------------------

  /** What the voice loop should do with what it hears, derived from phase. */
  const mode = (): VoiceMode => {
    switch (store.getState().phase) {
      case 'offline':
      case 'boot':
        return 'deaf'
      case 'dormant':
        return 'wake'
      case 'waking':
      case 'listening':
        return 'command'
      default:
        return 'guard' // thinking, tooling, speaking
    }
  }

  const onWake = (trailing: string) => {
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot') return

    store.getState().setError(null)
    sfx.play('wake')

    // "Jarvis, what's happening in AI this week" in one breath. Waiting for a
    // greeting he didn't need is the most common way an assistant wastes time.
    if (trailing) {
      void respond(trailing)
      return
    }

    store.getState().setPhase('waking')

    // Answer to his name. Deliberately NOT awaited any more: the microphone is
    // already open and the echo filter knows his voice, so the user can talk
    // straight over the greeting instead of waiting it out.
    const greeting = createSpeaker()
    speaker.current = greeting
    greeting.say(attention())
    void greeting.end()

    listen(AWAIT_SPEECH_MS)
  }

  /**
   * Someone started talking. This is the whole point of the rewrite: he stops,
   * immediately, whatever he was doing.
   */
  const onSpeechStart = () => {
    clearIdle()
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot' || phase === 'dormant') return

    const wasBusy =
      phase === 'thinking' || phase === 'tooling' || phase === 'speaking'

    silence()
    if (wasBusy) {
      // Abandon the answer in flight. The turn counter moves in respond()'s
      // replacement; bumping it here covers the case where nothing replaces it.
      turn.current++
      interrupt()
      store.getState().setActiveTool(null)
      music.working(false)
      sfx.duck(false)
      music.duck(false)
    }
    store.getState().setPhase('listening')
  }

  const onUtterance = (text: string) => {
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot' || phase === 'dormant') return

    // People keep using his name as a vocative once they're already talking to
    // him. Strip it rather than sending "jarvis" to the model as a question.
    if (BARE_NAME.test(text)) {
      listen(AWAIT_SPEECH_MS)
      return
    }
    const said = text.replace(LEADING_NAME, '').trim()
    if (!said) {
      listen(AWAIT_SPEECH_MS)
      return
    }

    void respond(said)
  }

  const onPartial = (text: string) => {
    store.getState().setCaption(text)
  }

  const onVoiceError = (message: string) => {
    store.getState().setError(message)
  }

  // -- power on -------------------------------------------------------------

  const powerOn = async () => {
    // The ignition button and the space bar can both land here, and the phase
    // only moves after the first await — so without this a double press boots
    // twice, arming two voice loops and two download polls.
    if (booting.current) return
    booting.current = true

    try {
      await ignite()
    } catch (err) {
      // The guard must not outlive a failed boot. Audio unlock can be refused,
      // the microphone prompt dismissed, the bridge unreachable at the wrong
      // moment — and with the flag still latched the ignition button was dead
      // for the rest of the page, recoverable only by reloading. Reset it and
      // put the button back so the user can simply press it again.
      booting.current = false
      console.error('[jarvis] power-up failed:', err)
      store.getState().setPhase('offline')
      store
        .getState()
        .setError(
          err instanceof Error
            ? `Power-up failed: ${err.message}`
            : 'Power-up failed. Click to try again.',
        )
    }
  }

  const ignite = async () => {
    const s = store.getState()

    // Must happen inside the click handler — browsers won't start an
    // AudioContext or speech synthesis without a user gesture. Speech first,
    // before any await: iOS only counts it while still inside the tap.
    unlockSpeech()
    // Keep the phone from auto-locking, which would pause her, while she's open.
    keepAwake()
    // And follow where she is, so she always knows the place and its weather.
    trackLocation()
    await sfx.unlockAudio()
    sfx.play('boot')
    // The score. Must be started from inside this click handler for the same
    // reason as the rest of the audio.
    music.enable()
    music.playBoot()
    music.startAmbient()

    s.setPhase('boot')

    watchServers((servers) => store.getState().setConnected(servers))
    watchPanels((panel) => store.getState().pushPanel(panel))
    watchBlades((blade) => store.getState().pushBlade(blade))

    /**
     * JARVIS asking to see something.
     *
     * Announced on screen for as long as it takes, with whatever he said he was
     * looking for. The camera's own light is on too, but a hardware light that
     * appears with no explanation is exactly the thing that makes people
     * distrust an assistant — so the interface says it before they have to ask.
     */
    watchCapture(async (req) => {
      const note =
        req.mode === 'watch'
          ? req.when === 'past'
            ? req.reason || 'reviewing the last few seconds'
            : `${req.reason || 'watching'} · ${req.seconds}s`
          : req.reason || 'taking a look'
      store.getState().setLooking(note)

      // The past is only available if something has been remembering it, and
      // that only happens while the camera is on screen. Answering plainly
      // beats opening the camera and recording the next few seconds instead,
      // which is a different question from the one that was asked.
      if (req.mode === 'watch' && req.when === 'past' && camera.bufferedSeconds() < 1) {
        store.getState().setLooking(null)
        return {
          error:
            'There is no recent footage — the camera has to be open on screen ' +
            'for me to remember what just happened. Ask me to open the camera, ' +
            'and I can watch from then on.',
        }
      }

      // Held for the whole capture. Without this the stream can be torn down by
      // whoever else was using it half way through a six-second watch.
      let held = false
      try {
        await camera.holdCamera()
        held = true
        if (req.mode === 'look') return camera.grabFrame()
        if (req.when === 'past') {
          const grid = camera.recentGrid(req.seconds, 9)
          return grid ?? { error: 'There is not enough recent footage to review.' }
        }
        return await camera.watchAhead(req.seconds, 9)
      } catch (err) {
        return {
          error:
            (err as DOMException)?.name === 'NotAllowedError'
              ? 'The camera is not permitted, so I cannot see anything.'
              : `The camera could not be read: ${(err as Error)?.message ?? err}`,
        }
      } finally {
        if (held) camera.releaseCamera()
        store.getState().setLooking(null)
      }
    })

    // The interface is JARVIS's to drive. These arrive out of band, pushed
    // mid-turn the way panels are, so a command can retint the reactor or put
    // something into orbit while he is still speaking the sentence about it.
    watchUi((op, args) => {
      const s = store.getState()
      const a = (args ?? {}) as Record<string, never>
      switch (op) {
        case 'patch':
          s.applyUi(args)
          break
        case 'orbit':
          if (a.action === 'add') s.addOrbit(args)
          else if (a.action === 'remove') s.removeOrbit(String(a.id))
          else s.clearOrbits()
          break
        case 'effect':
          s.fireEffect(a.kind)
          break
        case 'reset':
          s.resetUi()
          break
        case 'screen':
          s.clearScreen(a.what ?? 'all')
          break
        default:
          console.warn('[jarvis] unknown ui op:', op, args)
      }
    })
    // In bridge mode the conversation lives in the agent session, which is tied
    // to the socket — so a drop silently wipes his memory while the transcript
    // on screen still shows it. Better to say so than to let him quietly forget.
    watchConnection((state) => {
      if (state === 'lost') {
        store.getState().setError('Bridge connection lost — reconnecting.')
      } else if (state === 'reconnected') {
        store
          .getState()
          .setError('Bridge reconnected. The previous conversation was not kept.')
      }
    })
    const warming = warm().catch((err: Error) => s.setError(err.message))

    if (!usingBridge && !hasDirectKey()) {
      s.setError(
        'No API key — set VITE_ANTHROPIC_API_KEY or VITE_GEMINI_API_KEY in .env.local.',
      )
    }

    // Pull the neural voice down during the boot sequence so the first
    // "Hey Jarvis" isn't waiting on an 86MB download. Deliberately not awaited
    // — if it's slow, JARVIS comes up on the system voice and swaps over the
    // moment the model is ready.
    if (TTS_ENGINE === 'kokoro') {
      void kokoro.load()
      voicePoll.current = setInterval(() => {
        const p = kokoro.loadProgress()
        if (kokoro.isReady() || kokoro.isUnavailable()) {
          store.getState().setBootNote('')
          if (voicePoll.current) clearInterval(voicePoll.current)
          voicePoll.current = null
        } else if (p > 0 && p < 1) {
          store.getState().setBootNote(`voice ${Math.round(p * 100)}%`)
        }
      }, 200)
    }

    // Long enough for the four-beat start-up sequence in Boot.tsx to play —
    // status bar, rings, suit schematic, reactor power-up — before the live
    // interface takes over. Kept a touch under the boot cue so the music is
    // still rising as the reactor lands.
    await new Promise((r) => setTimeout(r, 9200)) // boot sequence
    await warming
    store.getState().setConnected(connectedLabels())
    store.getState().setVoice(currentVoiceName())

    // The analyser is what makes the reactor pulse with your voice. It needs a
    // getUserMedia stream; speech recognition does not, and gets its own. So a
    // failure here costs the animation and nothing else — saying "voice input
    // is unavailable" was both alarming and untrue.
    // Not on iOS: there the speech recogniser needs the microphone to itself,
    // and a second capture stream both stops it hearing and mutes Danya.
    try {
      if (!IOS) await startAnalyser()
    } catch {
      console.warn(
        '[jarvis] no microphone stream — the reactor will not pulse with your ' +
          'voice. Speech recognition is unaffected.',
      )
    }

    // Ask the bridge which speech engines exist before the loop starts, so the
    // first turn already uses ElevenLabs when a key is present and the browser
    // fallback when it is not — no flag, no reload.
    await probeCapabilities()

    // One voice loop, started once, running until the page closes.
    voice.current = await startVoice({
      mode,
      onWake,
      onSpeechStart,
      onPartial,
      onUtterance,
      onError: onVoiceError,
    })

    store.getState().setPhase('dormant')

    // Signed in to Google: learn who, for the SYSTEMS list and the card below.
    if (googleReady()) {
      void refreshGoogleAccount().then(() => store.getState().setConnected(connectedLabels()))
    }
    // Just back from Google's sign-in page: say so, then ask the question that
    // sent them there.
    if (justConnected()) {
      void refreshGoogleAccount().then((who) =>
        showCard({
          title: '✅ Google connected',
          detail: `${who ? `${who.name} (${who.email})` : 'Your account'}. Gmail and Calendar, read-only.`,
        }),
      )
    }
    const pending = takePendingQuestion()
    if (pending) {
      void respond(pending)
      return
    }

    // Online: say hello like JARVIS would — by name, with the time of day and
    // the weather where you are. Made here, so it is instant and costs nothing.
    const hello = createSpeaker()
    speaker.current = hello
    hello.say(welcome(userName()))
    void hello.end()
  }

  // -- clap to start --------------------------------------------------------

  /**
   * A clap brings him up, as an alternative to the button.
   *
   * Only while the ignition screen is showing, and torn down the moment he
   * boots — the microphone is about to belong to the voice loop, and two
   * analysers arguing over the same stream is how you get an assistant that
   * hears half of what you say.
   *
   * Deliberately silent about failure. If the microphone is refused, or has not
   * been granted yet, the button is still right there; announcing an error
   * about a feature nobody asked for would be worse than quietly doing without.
   */
  useEffect(() => {
    if (phase !== 'offline') return
    let live: { stop: () => void } | null = null
    let gone = false
    void listenForClap(() => {
      if (!gone) void powerOn()
    }).then((l) => {
      if (gone) l.stop()
      else live = l
    })
    return () => {
      gone = true
      live?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // -- level pump + keys ----------------------------------------------------

  useEffect(() => {
    let raf = 0

    const pump = () => {
      const st = store.getState()
      // While speaking, follow JARVIS's own output rather than the mic, so the
      // orb lip-syncs instead of reacting to room noise.
      const lvl =
        st.phase === 'speaking' && speaker.current
          ? speaker.current.level()
          : micLevel()
      st.setLevel(lvl)
      raf = requestAnimationFrame(pump)
    }
    pump()

    // Start a turn without the wake word — Space on a keyboard, a tap on the
    // background on a phone, which has no Space bar.
    const talk = () => {
      unlockSpeech()
      const phase = store.getState().phase
      if (phase === 'offline') {
        void powerOn()
      } else if (phase === 'boot') {
        /* ignore — the boot sequence owns the phase until it finishes */
      } else if (
        phase === 'thinking' ||
        phase === 'tooling' ||
        phase === 'speaking'
      ) {
        onSpeechStart()
        listen(AWAIT_SPEECH_MS)
      } else {
        onWake('')
      }
    }

    // Only taps on the 3D scene itself, so buttons and panels keep working.
    const onTap = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      if (!(e.target instanceof HTMLCanvasElement)) return
      talk()
    }

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // V auditions the next British voice installed on this machine. Which
      // ones exist varies per Mac, so hearing them beats trusting a ranking.
      // Bare V only — ⌘V and ⌃V are paste, and swallowing those was rude.
      if (
        e.key === 'v' &&
        !e.repeat &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault()
        const name = cycleVoice()
        store.getState().setVoice(name)
        silence()
        const demo = createSpeaker()
        speaker.current = demo
        demo.say(`Voice set to ${name.replace(/\(.*?\)/g, '').trim()}. At your service, sir.`)
        void demo.end()
        return
      }

      // G puts the camera on and starts tracking hands. Off by default and
      // never implicit: a webcam that turns itself on because an interface
      // thought it might be useful is not a trade anyone agreed to.
      if (e.key === 'g' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        const on = store.getState().gestures
        if (on) {
          hands.disableHands()
          store.getState().setGestures(false)
        } else {
          store.getState().setError(null)
          void hands
            .enableHands()
            .then(() => store.getState().setGestures(true))
            .catch((err: Error) => {
              store.getState().setGestures(false)
              store
                .getState()
                .setError(
                  err?.name === 'NotAllowedError'
                    ? 'Camera access denied — gesture control is unavailable.'
                    : `Gesture control failed to start: ${err?.message ?? err}`,
                )
            })
        }
        return
      }

      // T speaks a fixed line, bypassing the wake word, the recogniser and the
      // model entirely. When "I can't hear him" is the report, this is the one
      // keypress that separates a broken voice engine from a broken voice loop
      // — and it prints the verdict rather than making you infer it.
      if (e.key === 't' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        silence()
        const t = createSpeaker()
        speaker.current = t
        t.say('Audio test. If you can hear this, speech output is working, sir.')
        void t.end().then(() => {
          const d = (window as unknown as Record<string, Record<string, unknown>>).__tts
          console.info('[jarvis] audio test →', d)
          if (d && d.started === 0 && d.rescued === 0) {
            store.getState().setError(
              `No sound produced. engine=${d.engine} voice=${d.voice} error=${d.lastError || 'none'}`,
            )
          }
        })
        return
      }

      // Escape stands the whole thing down — the one thing the old build had
      // no key for at all.
      if (e.key === 'Escape') {
        e.preventDefault()
        if (store.getState().phase !== 'offline') goDormant()
        return
      }

      // Space starts a turn without the wake word. Worth using while filming so
      // a missed wake word doesn't cost a take.
      if (e.code !== 'Space' || e.repeat) return
      e.preventDefault()
      talk()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onTap)

    // A photo from the camera button: show it, and ask about it. respond()
    // clears the panel synchronously first, so the photo goes up after it.
    const onPhoto = (e: Event) => {
      const photo = (e as CustomEvent<Photo>).detail
      void respond(photo.question, photo.base64)
      showInfo({ title: 'Your photo', lines: [], image: photo.dataUrl })
    }
    window.addEventListener(PHOTO_EVENT, onPhoto)

    // Pasted into the scam checker: the quick check on the phone goes up at
    // once, then the model checks the web and gives the verdict over it.
    const onScan = (e: Event) => {
      const text = (e as CustomEvent<string>).detail
      const report = scanForScam(text)
      const preview = text.replace(/\s+/g, ' ').slice(0, 90)
      void respond(`Is this a scam? “${preview}${text.length > 90 ? '…' : ''}”`, undefined, scamPrompt(text, report))
      showInfo(scamPanel(report))
    }
    window.addEventListener(SCAN_EVENT, onScan)

    // A voice note or recording from the 🎧 button. Its words are someone
    // else's, so like a checked message it goes as an exact prompt: no phone
    // actions, nothing learned from it. Only Gemini can listen.
    const onAudio = (e: Event) => {
      const note = (e as CustomEvent<VoiceNote>).detail
      if (DIRECT_BRAIN !== 'gemini') {
        showCard({ title: 'Voice notes need a Gemini key', detail: 'Claude’s API can’t listen to audio. Add a free Gemini key to use this.' })
        return
      }
      void respond(`🎧 ${note.name}`, { data: note.data, mime: note.mime }, voicePrompt(note))
      showInfo({
        title: `🎧 Listening to ${note.name}…`,
        lines: [
          note.seconds ? `${spoken(note.seconds)} long.` : '',
          note.trimmed ? 'It is long, so Danya is listening to the first 7 minutes.' : '',
          'Writing out who said what, the mood, a summary and a scam check.',
        ].filter(Boolean),
      })
    }
    window.addEventListener(AUDIO_EVENT, onAudio)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onTap)
      window.removeEventListener(PHOTO_EVENT, onPhoto)
      window.removeEventListener(SCAN_EVENT, onScan)
      window.removeEventListener(AUDIO_EVENT, onAudio)
      clearIdle()
      if (voicePoll.current) clearInterval(voicePoll.current)
      voice.current?.stop()
      speaker.current?.cancel()
      // The camera must not outlive the page that turned it on.
      hands.disableHands()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <Scene />
      <Hud />
      <Boot />
      <Diagnostics />
      <ActionCard />
      <InfoPanel />
      <WakeVoice />
      <TapToHear />
      <Toolbar />
      <Ignition onStart={() => void powerOn()} />
    </>
  )
}
